// ==========================
// Relabel High/Low — isi ulang actual_next_high/low untuk data LAMA
// ==========================
//
// Dipakai SEKALI (atau beberapa kali sampai backlog habis) setelah kolom
// actual_next_high, actual_next_low, max_gain_from_open_pct ditambahkan ke
// tabel scan_history. Baris yang sudah dilabel SEBELUM kolom ini ada tidak
// otomatis terisi — endpoint ini yang menyusulinya secara retroaktif.
//
// Beda dengan api/label-outcomes.js (yang ambil "candle paling baru" karena
// dijalankan sehari setelah scan): di sini kita perlu candle di TANGGAL
// SPESIFIK di masa lalu, jadi harus dicari dari histori harga, bukan cuma
// ambil elemen terakhir.
//
// Cara pakai:
//   GET /api/relabel-high-low                -> proses 15 emiten pertama yang masih kurang
//   GET /api/relabel-high-low?maxKode=30      -> proses lebih banyak sekaligus
//   GET /api/relabel-high-low?kode=BBCA       -> proses SATU emiten tertentu saja
//
// Jalankan berkali-kali (refresh / panggil ulang) sampai response
// "remainingKode: 0" — satu kali panggil sengaja dibatasi jumlah emiten
// (bukan jumlah baris) supaya tidak timeout, karena tiap emiten perlu 1x
// fetch ke Yahoo Finance yang makan waktu beberapa ratus ms.
//
// UPDATE 7 Agustus 2026 — digabung dengan backfill session_gain_score
// (bukan file endpoint baru, supaya jumlah serverless function tidak
// nambah lagi dari 12 dan kena limit Vercel Hobby seperti insiden
// sebelumnya, lihat catatan di api/dashboard-data.js):
//   GET /api/relabel-high-low?target=session-gain          -> backfill session_gain_score 2000 baris pertama
//   GET /api/relabel-high-low?target=session-gain&limit=500 -> batasi jumlah per panggilan
// Mode ini TIDAK fetch Yahoo Finance sama sekali (semua input
// calculateSessionGainScore sudah ada di baris itu sendiri), jadi jauh
// lebih cepat dan terpisah total dari logic high/low di bawah — lihat
// handler target === "session-gain" di awal handler().
//
// UPDATE 15 Agustus 2026 — gabungan ketiga (alasan sama: batas 12
// serverless function Vercel Hobby, tidak bikin file endpoint baru):
//   GET /api/relabel-high-low?target=opportunity              -> backfill next_day_opportunity_* 2000 baris pertama
//   GET /api/relabel-high-low?target=opportunity&limit=500     -> batasi jumlah per panggilan
// UPDATE 15 Agustus 2026 — sinkronisasi scorer aktif untuk Riwayat AI:
//   GET /api/relabel-high-low?target=model-sync&date=2026-08-13
//   GET /api/relabel-high-low?target=model-sync&date=2026-08-13&kode=BBCA
// Mode ini menghitung ulang score/signal dan Next-Day Opportunity dari
// snapshot fitur yang sudah tersimpan, tanpa fetch Yahoo. Dipakai setelah
// logic scorer berubah agar histori tanggal lama tidak tetap memakai score lama.
//
// Backfill untuk baris LAMA (sebelum migration 2026-08-09) yang belum
// punya next_day_opportunity_label/score/setup/eligible. Sama seperti
// session-gain: TIDAK fetch Yahoo/candle sama sekali — semua input
// calculateNextDayOpportunity() sudah tersimpan sebagai kolom di baris
// itu sendiri, KECUALI marketTrend yang dihitung ulang dari
// close/sma20/sma50/ema9/ema20/macd (juga sudah tersimpan). Lihat
// getRowsMissingOpportunity() di services/dataLogService.js untuk daftar
// kolom lengkap & alasannya.

import { getRowsMissingHighLow, getRowsMissingSessionGain, getRowsMissingOpportunity, getRowsForModelSync, updateLabel, getScannedKodeForDate, logScanSnapshots } from "../services/dataLogService.js";
import { getStockData, getIntradayPeakTime } from "../services/stockService.js";
import { calculateSessionGainScore } from "../engine/sessionGainScore.js";
import { calculateNextDayOpportunity } from "../engine/nextDayOpportunity.js";
import { getMarketTrend } from "../engine/verdict.js";
import { calculateScore, recommendation, hasStrongBuyConfirmation } from "../engine/scorer.js";
import { applyRegimeAdjustment } from "../engine/marketRegime.js";
import { analyzeStock } from "../engine/analyzer.js";
import { resolveUniverse } from "../config/universe.js";
import { isTradingDay } from "../config/tradingCalendar.js";
import { getGapCalibrationMap } from "../services/gapCalibrationService.js";
import { buildSnapshotRow } from "../services/snapshotBuilder.js";

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 6; // lebih rendah dari label-outcomes.js (12) karena range=1y lebih berat

// Toleransi selisih harga open saat mencocokkan candle histori dengan
// actual_next_open yang sudah tersimpan — HANYA dipakai sebagai PENANDA
// (bukan penghalang tulis), untuk kasus ekstrem yang di luar batas ARA/ARB
// wajar (indikasi kemungkinan candle salah tanggal / stock split belum
// disesuaikan). Sebelumnya di-set 3% dan dipakai untuk SKIP baris — ternyata
// findNextTradingDayCandle() sudah pasti benar mengambil hari bursa
// berikutnya (loncat weekend/libur otomatis dari urutan tanggal candle),
// jadi selisih di bawah batas ARA/ARB itu 99% cuma gap harga wajar
// (terutama saham recehan di bawah Rp500 yang gampang gap >3% sehari),
// bukan bug. Menahan tulis di situ menyebabkan banyak baris valid
// permanen tidak terisi. Sekarang dinaikkan ke 20% dan sifatnya cuma
// FLAG untuk dicek manual — data tetap ditulis.
const OPEN_MATCH_TOLERANCE_PCT = 20;

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { error: e.message };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, next)
  );

  return results;
}

// Cari candle histori pertama yang tanggalnya SETELAH scan_date — itulah
// hari berikutnya secara perdagangan (sudah otomatis lompat weekend/libur
// karena candle memang cuma ada di hari bursa buka).
function findNextTradingDayCandle(candles, scanDate) {
  for (const c of candles) {
    if (c.date.slice(0, 10) > scanDate) {
      return c;
    }
  }
  return null;
}

// Backfill session_gain_score — lihat catatan "UPDATE 7 Agustus 2026" di
// atas. Terpisah total dari logic high/low di bawah (tidak ada fetch
// eksternal), jadi bisa proses per BARIS langsung, bukan per kode.
async function handleSessionGainBackfill(req, res) {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 2000;
  const rows = await getRowsMissingSessionGain({ limit });

  if (rows.length === 0) {
    return res.status(200).json({
      success: true,
      message: "Tidak ada baris lama yang perlu di-backfill — semua sudah punya session_gain_score.",
      processed: 0,
      remaining: 0
    });
  }

  const results = await runPool(
    rows,
    async (row) => {
      // Sama seperti finalSessionGain di analyzer.js: saham illiquid
      // (saham beku/floor price) langsung 0/SANGAT RENDAH, konsisten
      // dengan baris baru dari scan normal.
      if (row.illiquid) {
        await updateLabel(row.id, { session_gain_score: 0, session_gain_label: "SANGAT RENDAH" });
        return { id: row.id, ok: true };
      }

      const result = calculateSessionGainScore({
        signal: row.signal,
        score: row.score,
        volumeAccelerating: row.volume_accelerating,
        volumeSignal: row.volume_signal,
        volumeRatio: row.volume_ratio,
        gapOutlook: row.gap_outlook,
        rsLabel: row.rs_label
      });

      await updateLabel(row.id, {
        session_gain_score: result.sessionGainScore,
        session_gain_label: result.label
      });

      return { id: row.id, ok: true };
    },
    20 // tidak ada fetch eksternal, aman concurrency lebih tinggi dari relabel high/low
  );

  const ok = results.filter((r) => r && r.ok).length;
  const failed = results
    .map((r, i) => (r && r.error ? { id: rows[i].id, error: r.error } : null))
    .filter(Boolean);

  return res.status(200).json({
    success: true,
    processed: ok,
    failedCount: failed.length,
    failed: failed.slice(0, 10),
    remaining: rows.length - ok,
    hint: rows.length === limit
      ? "Batch ini penuh sampai limit — mungkin masih ada baris lagi, panggil ulang endpoint ini dengan target=session-gain."
      : undefined
  });
}

// Rekonstruksi isBreakout dari breakout_level yang sudah tersimpan —
// lihat engine/indicators/breakout.js: level cuma "BREAKOUT" atau
// "STRONG_BREAKOUT" ketika brokeLevel && volumeRatio>=1.5 (persis
// definisi isBreakout), jadi tidak perlu volume_ratio lagi di sini.
function reconstructIsBreakout(breakoutLevel) {
  return breakoutLevel === "BREAKOUT" || breakoutLevel === "STRONG_BREAKOUT";
}

// Backfill next_day_opportunity_* — lihat catatan "UPDATE 15 Agustus
// 2026" di atas. Murni hitung ulang dari kolom yang sudah ada, tidak ada
// fetch eksternal, jadi bisa proses per baris langsung dengan
// concurrency tinggi (sama seperti session-gain).
async function handleModelSync(req, res) {
  const scanDate = req.query.date;
  const kode = req.query.kode ? req.query.kode.toUpperCase() : null;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 5000;

  if (!scanDate && !kode) {
    return res.status(400).json({
      success: false,
      message: "Wajib isi ?date=YYYY-MM-DD atau ?kode=KODE. Untuk sinkronisasi tanggal 13 Agustus gunakan ?date=2026-08-13."
    });
  }

  const rows = await getRowsForModelSync({ scanDate, kode, limit });
  if (!rows.length) {
    return res.status(200).json({ success: true, processed: 0, message: "Tidak ada data yang cocok." });
  }

  const results = await runPool(rows, async (row) => {
    const marketTrend = getMarketTrend({
      close: row.close,
      sma20: row.sma20,
      sma50: row.sma50,
      ema9: row.ema9,
      ema20: row.ema20,
      macd: { macd: row.macd }
    });

    const volume = { ratio: row.volume_ratio, signal: row.volume_signal };
    const breakout = {
      level: row.breakout_level,
      distancePercent: row.breakout_distance_pct,
      isBreakout: row.breakout_level === "BREAKOUT" || row.breakout_level === "STRONG_BREAKOUT"
    };
    const volumeAcceleration = {
      slopePercent: row.volume_accel_slope_pct,
      accelerating: row.volume_accelerating
    };
    const relativeStrength = { label: row.rs_label };
    const exhaustion = { exhaustionScore: row.exhaustion_score };
    const distribution = { distributionScore: row.distribution_score };

    const data = {
      close: row.close,
      sma20: row.sma20,
      sma50: row.sma50,
      ema9: row.ema9,
      ema20: row.ema20,
      rsi: row.rsi,
      macd: { macd: row.macd },
      volume,
      riskReward: row.risk_reward,
      breakout,
      closingStrength: row.closing_strength,
      volumeAcceleration,
      relativeStrength,
      exhaustion,
      distribution
    };

    const score = calculateScore(data);
    const strongBuyConfirmed = hasStrongBuyConfirmation({ breakout, volume, rsi: row.rsi });
    let signal = recommendation(score);
    if (signal === "STRONG BUY" && !strongBuyConfirmed) signal = "BUY";
    if (row.illiquid) signal = "TIDAK LIKUID";

    const scoreAdjusted = applyRegimeAdjustment(score, row.market_regime_score);

    const opportunity = calculateNextDayOpportunity({
      score,
      volume,
      volumeAcceleration,
      breakout,
      relativeStrength,
      exhaustion,
      distribution,
      liquidity: { illiquid: Boolean(row.illiquid) },
      riskReward: row.risk_reward,
      closingStrength: row.closing_strength,
      marketTrend,
      rsi: row.rsi,
      macd: { macd: row.macd },
      dailyChangePercent: row.daily_change_pct
    });

    await updateLabel(row.id, {
      score,
      signal,
      strong_buy_confirmed: strongBuyConfirmed,
      score_adjusted: scoreAdjusted,
      next_day_opportunity_score: opportunity.opportunityScore,
      next_day_opportunity_label: opportunity.opportunityLabel,
      next_day_opportunity_setup: opportunity.coreSetup,
      next_day_opportunity_eligible: opportunity.eligible,
      next_day_entry_quality_score: opportunity.entryQualityScore,
      next_day_entry_quality_label: opportunity.entryQualityLabel,
      next_day_chase_risk: opportunity.chaseRisk,
      next_day_entry_decision: opportunity.entryDecision,
      next_day_entry_eligible: opportunity.entryEligible
    });

    return {
      id: row.id,
      kode: row.kode,
      scan_date: row.scan_date,
      oldScore: row.score ?? null,
      score,
      oldSignal: row.signal ?? null,
      signal,
      oldOpportunityScore: null,
      opportunityScore: opportunity.opportunityScore,
      opportunityLabel: opportunity.opportunityLabel
    };
  }, 20);

  const failed = results.map((r, i) => r?.error ? { id: rows[i].id, error: r.error } : null).filter(Boolean);
  const ok = results.filter(r => r && !r.error);
  const changedScore = ok.filter(r => Number(r.oldScore) !== Number(r.score)).length;
  const changedSignal = ok.filter(r => r.oldSignal !== r.signal).length;

  return res.status(200).json({
    success: true,
    processed: ok.length,
    failedCount: failed.length,
    changedScore,
    changedSignal,
    failed: failed.slice(0, 20),
    date: scanDate ?? null,
    kode: kode ?? null,
    sample: ok.slice(0, 10),
    hint: "Riwayat AI sekarang membaca nilai yang sudah disinkronkan dari scorer aktif."
  });
}

async function handleOpportunityBackfill(req, res) {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 2000;
  const rows = await getRowsMissingOpportunity({ limit });

  if (rows.length === 0) {
    return res.status(200).json({
      success: true,
      message: "Tidak ada baris lama yang perlu di-backfill — semua sudah punya next_day_opportunity_label.",
      processed: 0,
      remaining: 0
    });
  }

  const results = await runPool(
    rows,
    async (row) => {
      // marketTrend tidak pernah disimpan sebagai kolom sendiri — hitung
      // ulang dari indikator yang sudah ada (sama persis inputnya dengan
      // getMarketTrend() di engine/analyzer.js).
      const marketTrend = getMarketTrend({
        close: row.close,
        sma20: row.sma20,
        sma50: row.sma50,
        ema9: row.ema9,
        ema20: row.ema20,
        macd: { macd: row.macd }
      });

      const opportunity = calculateNextDayOpportunity({
        score: row.score,
        volume: { ratio: row.volume_ratio },
        volumeAcceleration: { slopePercent: row.volume_accel_slope_pct },
        breakout: {
          isBreakout: reconstructIsBreakout(row.breakout_level),
          distancePercent: row.breakout_distance_pct
        },
        relativeStrength: { label: row.rs_label },
        exhaustion: { exhaustionScore: row.exhaustion_score },
        distribution: { distributionScore: row.distribution_score },
        liquidity: { illiquid: row.illiquid },
        riskReward: row.risk_reward,
        closingStrength: row.closing_strength,
        marketTrend,
        rsi: row.rsi,
        macd: { macd: row.macd },
        dailyChangePercent: row.daily_change_pct
      });

      await updateLabel(row.id, {
        next_day_opportunity_score: opportunity.opportunityScore,
        next_day_opportunity_label: opportunity.opportunityLabel,
        next_day_opportunity_setup: opportunity.coreSetup,
        next_day_opportunity_eligible: opportunity.eligible,
        next_day_entry_quality_score: opportunity.entryQualityScore,
        next_day_entry_quality_label: opportunity.entryQualityLabel,
        next_day_chase_risk: opportunity.chaseRisk,
        next_day_entry_decision: opportunity.entryDecision,
        next_day_entry_eligible: opportunity.entryEligible
      });

      return { id: row.id, ok: true };
    },
    20 // tidak ada fetch eksternal, aman concurrency lebih tinggi dari relabel high/low
  );

  const ok = results.filter((r) => r && r.ok).length;
  const failed = results
    .map((r, i) => (r && r.error ? { id: rows[i].id, error: r.error } : null))
    .filter(Boolean);

  return res.status(200).json({
    success: true,
    processed: ok,
    failedCount: failed.length,
    failed: failed.slice(0, 10),
    remaining: rows.length - ok,
    hint: rows.length === limit
      ? "Batch ini penuh sampai limit — mungkin masih ada baris lagi, panggil ulang endpoint ini dengan target=opportunity."
      : undefined
  });
}

// ==========================
// Backfill Gap — isi ulang scan_history untuk tanggal yang KOSONG total
// ==========================
//
// Beda dengan mode di atas (high-low/session-gain/opportunity/model-sync):
// mode-mode itu MELENGKAPI baris yang SUDAH ada tapi kurang beberapa kolom.
// Mode ini dipakai kalau baris untuk satu scan_date TIDAK ADA SAMA SEKALI
// (kasus bug 'entryTimingConflict' Agustus 2026 — lihat riwayat chat/commit
// api/scan.js). Menjalankan ulang pipeline yang sama persis dengan
// api/scan.js (analyzeStock + buildSnapshotRow), tapi candle di-potong
// sampai tanggal target, jadi hasilnya SAMA seperti kalau scan beneran
// dijalankan di tanggal itu — bukan cuma copy data hari ini.
//
// KETERBATASAN (best-effort, dicatat apa adanya, bukan bug):
//   - market_regime / market_regime_score pakai nilai netral (null / 50),
//     BUKAN kondisi macro riil di tanggal itu — snapshot macro historis
//     tidak disimpan per-tanggal di macroDataService.js saat ini.
//   - gap_calibration pakai peta kalibrasi TERKINI (bukan yang berlaku
//     persis di tanggal itu), karena gapCalibrationService.js juga tidak
//     menyimpan versi historis per-tanggal.
//   Dua hal di atas TIDAK mempengaruhi indikator teknikal/skor utama
//   (RSI, MACD, breakout, dst — semua dihitung dari candle historis asli),
//   cuma mempengaruhi 2 kolom itu saja.
//   - Kode yang tidak punya candle persis di tanggal target (suspend,
//     IPO belakangan, delisting) otomatis di-skip, dicatat di 'skipped'.
//   - Label next-day (gap_up_realized, actual_next_open/close/high/low,
//     dst) TIDAK diisi di sini — otomatis akan kekejar sendiri oleh cron
//     api/label-outcomes.js & api/label-outcomes-close.js yang sudah ada
//     (keduanya jalan berbasis "scan_date belum dilabel PALING LAMA",
//     bukan "kemarin", jadi tanggal backfill lama ikut kepungut).
//
// Cara pakai (ulangi sampai remainingKode: 0, lalu pindah ke tanggal lain):
//   GET /api/relabel-high-low?target=backfill-gap&date=2026-08-14&manual=1
//   GET /api/relabel-high-low?target=backfill-gap&date=2026-08-14&maxKode=20&manual=1
//   GET /api/relabel-high-low?target=backfill-gap&date=2026-08-14&kode=BBCA&manual=1
async function handleBackfillGap(req, res) {
  const scanDate = req.query.date;

  if (!scanDate || !/^\d{4}-\d{2}-\d{2}$/.test(scanDate)) {
    return res.status(400).json({
      success: false,
      message: "Parameter ?date=YYYY-MM-DD wajib diisi, contoh: ?date=2026-08-14"
    });
  }

  if (!isTradingDay(scanDate) && req.query.force !== "true") {
    return res.status(200).json({
      success: true,
      skipped: true,
      message: `${scanDate} bukan hari bursa (weekend/libur) — tidak perlu backfill. Tambahkan &force=true kalau memang sengaja.`
    });
  }

  const singleKode = req.query.kode ? req.query.kode.toUpperCase() : null;
  const maxKode = req.query.maxKode ? parseInt(req.query.maxKode, 10) : 20;

  // Universe sama seperti scan.js (dinamis dari DB kalau ada, fallback
  // statis kalau tidak).
  const { list: UNIVERSE, sectorOf, marketCapOf } = await resolveUniverse();

  // Skip kode yang sudah ada barisnya di tanggal ini, supaya panggilan
  // ulang (lanjutan setelah kena maxKode) tidak insert dobel.
  const alreadyScanned = new Set(await getScannedKodeForDate(scanDate));

  const remaining = singleKode
    ? [singleKode]
    : UNIVERSE.filter((k) => !alreadyScanned.has(k));

  const kodesToProcess = remaining.slice(0, maxKode);

  if (kodesToProcess.length === 0) {
    return res.status(200).json({
      success: true,
      message: `Semua kode untuk ${scanDate} sudah ter-backfill.`,
      date: scanDate,
      remainingKode: 0
    });
  }

  // IHSG historis, dipotong sampai scanDate — dipakai bareng untuk semua
  // kode di batch ini (1x fetch, bukan per-kode), sama pola cache-nya
  // dengan getIhsgCloses() di marketService.js tapi versi ber-tanggal.
  const ihsgClosesUpToDate = await fetchIhsgClosesUpTo(scanDate);

  // Best-effort — lihat catatan keterbatasan di atas fungsi ini.
  const gapCalibrationMap = await getGapCalibrationMap();

  const results = await runPool(
    kodesToProcess,
    async (kode) => {
      const stockData = await getStockData(kode, "1y");
      const candles = truncateCandlesUpTo(stockData.candles, scanDate);

      if (candles.length === 0) {
        return { kode, skipped: "tidak ada candle sebelum tanggal ini" };
      }

      const lastCandle = candles[candles.length - 1];
      if (lastCandle.date.slice(0, 10) !== scanDate) {
        return {
          kode,
          skipped: `tidak ada candle persis di ${scanDate} (kemungkinan suspend/belum listing/delisting)`
        };
      }

      const truncatedStockData = {
        kode: stockData.kode,
        candles,
        closePrices: candles.map((c) => c.close),
        volumes: candles.map((c) => c.volume),
        priceSource: lastCandle.source,
        latestSource: lastCandle.source,
        latestDate: lastCandle.date,
        ihsgCloses: ihsgClosesUpToDate,
        sector: sectorOf(kode),
        gapCalibration: gapCalibrationMap
      };

      const hasil = analyzeStock(truncatedStockData);

      hasil.sector = sectorOf(kode);
      hasil.marketCap = marketCapOf(kode) ?? null;

      // Macro historis tidak tersedia — nilai netral, lihat catatan di
      // atas fungsi ini.
      hasil.marketRegime = null;
      hasil.marketRegimeScore = 50;
      hasil.scoreAdjusted = applyRegimeAdjustment(hasil.score, 50);

      if (!hasil.nextDayOpportunity || typeof hasil.nextDayOpportunity !== "object") {
        hasil.nextDayOpportunity = null;
      }

      return { kode, row: buildSnapshotRow(hasil, scanDate) };
    },
    CONCURRENCY
  );

  const rowsToSave = results.filter((r) => r && r.row).map((r) => r.row);
  const skipped = results.filter((r) => r && r.skipped).map((r) => ({ kode: r.kode, reason: r.skipped }));
  const errored = results.filter((r) => r && r.error).map((r) => ({ error: r.error }));

  const logResult = await logScanSnapshots(rowsToSave);

  return res.status(200).json({
    success: true,
    date: scanDate,
    processed: kodesToProcess.length,
    saved: logResult.logged,
    saveError: logResult.error ?? null,
    skipped,
    errors: errored,
    remainingKode: remaining.length - kodesToProcess.length
  });
}

// Fetch IHSG (^JKSE) historis dan potong sampai dateStr — versi ber-tanggal
// dari getIhsgCloses() di marketService.js (yang selalu "sampai sekarang",
// tidak bisa dipotong ke tanggal lampau). Dipakai KHUSUS oleh backfill di
// atas supaya relativeStrength.vsIhsg tidak "mengintip" data masa depan.
async function fetchIhsgClosesUpTo(dateStr) {
  try {
    const url =
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=1y&interval=1d";
    const response = await fetch(url);

    if (!response.ok) return null;

    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const closesRaw = result.indicators?.quote?.[0]?.close || [];
    const closes = [];

    for (let i = 0; i < timestamps.length; i++) {
      const ts = Number(timestamps[i]);
      const c = closesRaw[i];
      if (!Number.isFinite(ts) || c === null || c === undefined) continue;

      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      if (date > dateStr) break; // stop persis sebelum "masa depan" dari sudut pandang tanggal backfill

      closes.push(c);
    }

    return closes.length > 0 ? closes : null;
  } catch (e) {
    console.error("fetchIhsgClosesUpTo error:", e.message);
    return null;
  }
}

// candles diasumsikan sudah urut naik berdasarkan tanggal (sama seperti
// asumsi findNextTradingDayCandle() di atas).
function truncateCandlesUpTo(candles, dateStr) {
  const idx = candles.findIndex((c) => c.date.slice(0, 10) > dateStr);
  return idx === -1 ? candles : candles.slice(0, idx);
}

export default async function handler(req, res) {
  try {
    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${process.env.CRON_SECRET}` && !req.query.manual) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Tambahkan ?manual=1 kalau menjalankan manual dari browser."
        });
      }
    }

    if (req.query.target === "session-gain") {
      return await handleSessionGainBackfill(req, res);
    }

    if (req.query.target === "opportunity") {
      return await handleOpportunityBackfill(req, res);
    }

    if (req.query.target === "model-sync") {
      return await handleModelSync(req, res);
    }

    if (req.query.target === "backfill-gap") {
      return await handleBackfillGap(req, res);
    }

    const singleKode = req.query.kode ? req.query.kode.toUpperCase() : null;
    const maxKode = req.query.maxKode ? parseInt(req.query.maxKode, 10) : 15;

    const rows = await getRowsMissingHighLow({ limit: 5000 });

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Tidak ada baris lama yang perlu di-relabel — semua sudah punya high/low.",
        remainingRows: 0,
        remainingKode: 0
      });
    }

    // Kelompokkan per kode supaya 1x fetch candle history dipakai untuk
    // semua baris emiten itu (bisa puluhan baris per kode).
    const byKode = {};
    for (const r of rows) {
      (byKode[r.kode] ||= []).push(r);
    }

    const allKodes = Object.keys(byKode);
    const kodesToProcess = singleKode
      ? allKodes.filter((k) => k === singleKode)
      : allKodes.slice(0, maxKode);

    if (kodesToProcess.length === 0) {
      return res.status(200).json({
        success: true,
        message: singleKode
          ? `Kode ${singleKode} tidak ada di antrean relabel (mungkin sudah selesai atau tidak ada baris belum dilabel).`
          : "Tidak ada kode untuk diproses.",
        remainingRows: rows.length,
        remainingKode: allKodes.length
      });
    }

    const results = await runPool(
      kodesToProcess,
      async (kode) => {
        // range=1y supaya cukup jauh ke belakang untuk data lama; kalau
        // proyek sudah jalan lebih dari setahun, ganti ke "2y" di sini.
        const stockData = await getStockData(kode, "1y");
        const candles = stockData.candles; // sudah urut naik berdasarkan tanggal

        const kodeRows = byKode[kode];
        let labeled = 0;
        let flagged = 0;
        let notFound = 0;
        const flaggedExamples = [];

        for (const row of kodeRows) {
          const candle = findNextTradingDayCandle(candles, row.scan_date);

          if (!candle) {
            notFound++;
            continue;
          }

          // Sanity check: open candle yang ketemu harus cocok dengan
          // actual_next_open yang sudah tersimpan dari labeling sebelumnya.
          // Bedanya dengan versi lama: sekarang ini CUMA PENANDA (flag),
          // bukan penghalang — baris tetap dilabel walau selisihnya besar,
          // supaya data valid tidak nyangkut permanen di antrean. Baris
          // dengan selisih >20% (di luar batas ARA/ARB wajar) dicatat di
          // flaggedExamples untuk dicek manual (kemungkinan stock split).
          const isFlagged =
            row.actual_next_open != null &&
            Math.abs(candle.open - row.actual_next_open) / row.actual_next_open * 100 > OPEN_MATCH_TOLERANCE_PCT;

          if (isFlagged) {
            flagged++;
            if (flaggedExamples.length < 3) {
              flaggedExamples.push({
                scan_date: row.scan_date,
                expected_open: row.actual_next_open,
                found_open: candle.open,
                found_date: candle.date.slice(0, 10)
              });
            }
          }

          const maxGainFromOpenPct = Number(
            (((candle.high - candle.open) / candle.open) * 100).toFixed(2)
          );

          // Best-effort — jam puncak (peak_time_wib) cuma bisa dibackfill
          // kalau tanggalnya masih dalam jangkauan retensi data intraday
          // Yahoo (biasanya ~60 hari). Baris yang lebih lama dari itu
          // akan tetap dapat high/low/max_gain seperti biasa, cuma
          // peak_time_wib/peak_session_phase-nya null.
          const peak = await getIntradayPeakTime(kode, candle.date.slice(0, 10));

          await updateLabel(row.id, {
            actual_next_high: candle.high,
            actual_next_low: candle.low,
            max_gain_from_open_pct: maxGainFromOpenPct,
            peak_time_wib: peak?.peakTimeWIB ?? null,
            peak_session_phase: peak?.peakSessionPhase ?? null
          });

          labeled++;
        }

        return { kode, totalRows: kodeRows.length, labeled, flagged, notFound, flaggedExamples };
      },
      CONCURRENCY
    );

    const ok = results.filter((r) => r && !r.error);
    const failed = results
      .map((r, i) => (r && r.error ? { kode: kodesToProcess[i], error: r.error } : null))
      .filter(Boolean);

    const totalLabeled = ok.reduce((sum, r) => sum + r.labeled, 0);
    const totalFlagged = ok.reduce((sum, r) => sum + r.flagged, 0);
    const totalNotFound = ok.reduce((sum, r) => sum + r.notFound, 0);

    const remainingKode = allKodes.length - kodesToProcess.length;
    const remainingRows = rows.length - totalLabeled - totalNotFound;

    return res.status(200).json({
      success: true,
      processedKode: kodesToProcess.length,
      totalLabeled,
      totalFlagged,   // baris tetap dilabel, tapi selisih open >20% — cek manual (kemungkinan stock split)
      totalNotFound,   // baris yang dilewati karena tidak ketemu candle setelah scan_date
      remainingKode,   // kalau > 0, panggil ulang endpoint ini lagi (atau naikkan ?maxKode=)
      remainingRows,
      failed,
      detail: ok
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Relabel high/low gagal.",
      error: error.message
    });
  }
}
