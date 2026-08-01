// ==========================
// Batch Scanner — Semua Emiten
// ==========================
//
// Menggantikan pola lama (frontend loop fetch /api/analyze satu-satu
// per kode, ratusan request sekuensial dari browser). Di sini semua
// emiten di-scan SERVER-SIDE dengan concurrency pool, jadi:
//   1. Jauh lebih cepat (paralel, bukan sekuensial di HP).
//   2. Relative Strength vs sektor bisa dihitung (butuh data semua
//      peer sektor dalam satu batch yang sama).
//   3. Satu response berisi hasil sudah diranking, siap dipakai untuk
//      alert / notifikasi otomatis di masa depan (bukan cuma UI).
//
// Vercel Hobby plan default timeout 10s — kalau universe penuh (~240
// kode) tidak selesai dalam waktu itu, upgrade ke Pro (maxDuration di
// bawah) atau kecilkan lewat query ?limit=100.

import { analyzeStock } from "../engine/analyzer.js";
import { getStockData } from "../services/stockService.js";
import { getIhsgCloses } from "../services/marketService.js";
import { nDayReturn } from "../engine/relativeStrength.js";
import { UNIVERSE, getSector } from "../config/universe.js";
import { logScanSnapshots } from "../services/dataLogService.js";
import { isTradingDay, nonTradingDayReason, todayWIB } from "../config/tradingCalendar.js";
import { getLatestMacroSnapshot } from "../services/macroDataService.js";
import { applyRegimeAdjustment } from "../engine/marketRegime.js";

// Butuh Vercel Pro (atau plan dengan maxDuration lebih besar) untuk scan
// universe penuh. Di Hobby, function akan terpotong di ~10s — pakai
// ?limit= untuk scan sebagian kalau masih di Hobby plan.
export const config = {
  maxDuration: 60
};

const CONCURRENCY = 12;
const RETURN_PERIOD = 20; // n-hari untuk relative strength

// Dinonaktifkan sementara (2026-07-20): analisa scan_history nunjukin
// filter ini justru MEMBUANG 32-38% saham yang beneran capai target
// gap-up, karena tiap kriterianya (gap_outlook, closing_strength,
// volume_signal) sendiri-sendiri korelasinya lemah ke hasil aktual —
// bukan cuma butuh tuning ambang. Nyalakan lagi cuma kalau sudah ada
// kriteria baru yang terbukti prediktif dari data yang lebih besar
// (rencana evaluasi ulang akhir Juli 2026).
const HIGH_CONVICTION_ENABLED = false;

// Layer makro (28 Juli 2026) — dimulai OFF secara default, sama pola
// kill-switch-nya seperti HIGH_CONVICTION_ENABLED di atas. market_regime
// & score_adjusted TETAP dihitung dan dicatat ke scan_history walau
// flag ini false (supaya datanya terkumpul untuk dianalisa dulu), tapi
// TIDAK dipakai untuk menyaring/mengubah urutan hasil yang ditampilkan
// sampai terbukti prediktif dari data nyata — nyalakan lewat
// ?macroFilter=true setelah ada cukup data untuk divalidasi.
const MACRO_FILTER_ENABLED = false;

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

export default async function handler(req, res) {
  try {
    const {
      limit,
      minScore,
      maxPrice,
      sector,
      onlyBreakout,
      highConviction,
      macroFilter,
      force
    } = req.query;

    // Tolak scan di hari non-bursa (weekend / libur nasional IDX) secara
    // default — supaya scan_history nggak lagi kemasukan data hari yang
    // bukan hari bursa asli (misal test manual di weekend, seperti yang
    // pernah kejadian 2026-07-18). Override dengan ?force=true kalau
    // memang sengaja mau test manual di hari libur.
    const today = todayWIB();
    if (!isTradingDay(today) && force !== "true") {
      return res.status(200).json({
        skipped: true,
        reason: nonTradingDayReason(today),
        scan_date: today,
        message:
          "Hari ini bukan hari bursa (weekend atau libur nasional IDX), scan dilewati. " +
          "Tambahkan ?force=true kalau memang sengaja mau scan manual."
      });
    }

    let kodeList = UNIVERSE;

    if (limit) {
      const n = parseInt(limit, 10);
      if (Number.isFinite(n) && n > 0) kodeList = kodeList.slice(0, n);
    }

    if (sector) {
      kodeList = kodeList.filter(
        (k) => getSector(k).toLowerCase() === String(sector).toLowerCase()
      );
    }

    const ihsgCloses = await getIhsgCloses();

    // Layer makro — best-effort. Kalau macro_snapshot belum pernah
    // terisi (macro-scan belum jalan/gagal) atau Supabase belum
    // dikonfigurasi, regime dinetralkan (score 50) oleh
    // applyRegimeAdjustment di bawah, TIDAK menggagalkan scan.
    const macroSnapshot = await getLatestMacroSnapshot();
    const marketRegime = macroSnapshot?.market_regime ?? null;
    const marketRegimeScore = macroSnapshot?.market_regime_score ?? 50;

    // ==========================
    // Tahap 1 — fetch data candle semua kode (paralel, concurrency-limited)
    // ==========================
    const fetched = await runPool(
      kodeList,
      async (kode) => {
        const stockData = await getStockData(kode);
        const stockReturn = nDayReturn(stockData.closePrices, RETURN_PERIOD);
        return { kode, stockData, stockReturn, sector: getSector(kode) };
      },
      CONCURRENCY
    );

    const ok = fetched.filter((f) => f && !f.error);
    const failed = fetched
      .map((f, i) => (f && f.error ? kodeList[i] : null))
      .filter(Boolean);

    // ==========================
    // Tahap 2 — rata-rata return per sektor dari hasil batch ini sendiri
    // ==========================
    const sectorReturns = {};
    const sectorGroups = {};

    for (const item of ok) {
      if (item.stockReturn === null) continue;
      if (!sectorGroups[item.sector]) sectorGroups[item.sector] = [];
      sectorGroups[item.sector].push(item.stockReturn);
    }

    for (const [sec, returns] of Object.entries(sectorGroups)) {
      sectorReturns[sec] =
        returns.reduce((a, b) => a + b, 0) / returns.length;
    }

    // ==========================
    // Tahap 3 — analyzeStock() penuh per kode, dengan RS vs IHSG & sektor
    // ==========================
    // Dibungkus try/catch PER KODE — satu kode dengan data ganjil (histori
    // terlalu pendek, harga NaN, dll) tidak boleh menjatuhkan seluruh batch.
    const analyzeErrors = [];

    const analyzed = ok
      .map((item) => {
        try {
          item.stockData.ihsgCloses = ihsgCloses;
          item.stockData.sectorReturn = sectorReturns[item.sector] ?? null;
          item.stockData.sector = item.sector;

          const hasil = analyzeStock(item.stockData);
          hasil.sector = item.sector;

          // Layer makro — lapisan terpisah, TIDAK mengubah hasil.score
          // asli (lihat catatan di engine/marketRegime.js).
          hasil.marketRegime = marketRegime;
          hasil.marketRegimeScore = marketRegimeScore;
          hasil.scoreAdjusted = applyRegimeAdjustment(hasil.score, marketRegimeScore);

          return hasil;
        } catch (e) {
          analyzeErrors.push({ kode: item.kode, error: e.message });
          return null;
        }
      })
      .filter(Boolean);

    // ==========================
    // Simpan snapshot ke Supabase — SEMUA kode yang berhasil dianalisa,
    // BUKAN cuma yang lolos filter. Dataset training butuh contoh
    // negatif (skor rendah/HOLD) juga, bukan cuma kandidat terbaik.
    // ==========================
    const scanDate = new Date().toISOString().slice(0, 10);

    const snapshotRows = analyzed.map((d) => ({
      kode: d.kode,
      sector: d.sector,
      scan_date: scanDate,

      close: d.close,
      score: d.score,
      signal: d.signal,
      entry: d.entry,
      rsi: d.rsi,
      macd: d.macd?.macd ?? null,
      sma20: d.sma20,
      sma50: d.sma50,
      ema9: d.ema9,
      ema20: d.ema20,
      risk_reward: d.riskReward,
      atr: d.atr,

      breakout_level: d.breakout?.level ?? null,
      breakout_distance_pct: d.breakout?.distancePercent ?? null,

      closing_strength: d.closingStrength,

      volume_ratio: d.volume?.ratio ?? null,
      volume_signal: d.volume?.signal ?? null,
      volume_accel_slope_pct: d.volumeAcceleration?.slopePercent ?? null,
      volume_accelerating: d.volumeAcceleration?.accelerating ?? null,

      rs_vs_ihsg: d.relativeStrength?.vsIhsg ?? null,
      rs_vs_sector: d.relativeStrength?.vsSector ?? null,
      rs_label: d.relativeStrength?.label ?? null,

      gap_outlook: d.gap?.outlook ?? null,
      gap_probability: d.gap?.probability
        ? parseFloat(String(d.gap.probability).replace("%", ""))
        : null,

      session_gain_score: d.sessionGain?.sessionGainScore ?? null,
      session_gain_label: d.sessionGain?.label ?? null,

      illiquid: d.liquidity?.illiquid ?? false,
      illiquid_reason: d.liquidity?.reason ?? null,

      market_regime: d.marketRegime ?? null,
      market_regime_score: d.marketRegimeScore ?? null,
      score_adjusted: d.scoreAdjusted ?? null,
      reversal_candidate: d.reversalCandidate ?? false,

      exhaustion_score: d.exhaustion?.exhaustionScore ?? null,
      exhaustion_label: d.exhaustion?.label ?? null,
      distribution_score: d.distribution?.distributionScore ?? null,
      distribution_label: d.distribution?.label ?? null
    }));

    // Fire-and-forget-ish: ditunggu tapi kegagalan logging TIDAK boleh
    // menggagalkan response scan ke user.
    const logResult = await logScanSnapshots(snapshotRows);

    // ==========================
    // Filter opsional
    // ==========================
    // Saham "beku"/tidak likuid (lihat engine/liquidity.js) TETAP dicatat
    // ke scan_history di atas (dataset training butuh contoh ini juga),
    // tapi dibuang dari hasil yang ditampilkan ke user — tidak actionable
    // untuk beli-sore/jual-pagi karena memang nyaris tidak ada transaksi.
    const illiquidCount = analyzed.filter((d) => d.liquidity?.illiquid).length;
    let hasilFilter = analyzed.filter((d) => !d.liquidity?.illiquid);

    if (minScore) {
      const n = parseInt(minScore, 10);
      if (Number.isFinite(n)) hasilFilter = hasilFilter.filter((d) => d.score >= n);
    }

    if (maxPrice) {
      const n = parseFloat(maxPrice);
      if (Number.isFinite(n)) hasilFilter = hasilFilter.filter((d) => d.close < n);
    }

    // ==========================
    // High Conviction — beberapa sinyal harus SALING MENDUKUNG sekaligus,
    // bukan cuma satu angka skor tinggi. Ini yang paling relevan untuk
    // "potensi naik esok hari" (strategi beli sore/jual pagi):
    //   - Signal BUY/STRONG BUY (skor sudah lolos ambang ≥75)
    //   - Entry NOW (sudah lolos gerbang risiko RSI di getEntryTiming)
    //   - Gap Outlook mengarah naik (indikator gap-up literal, bukan proxy)
    //   - Closing Strength ≥0.5 (buyer masih pegang kendali sampai closing,
    //     bukan cuma naik siang lalu dijual lagi menjelang sore)
    //   - Volume tidak LOW (kenaikan didukung partisipasi nyata)
    if (HIGH_CONVICTION_ENABLED && highConviction === "true") {
      hasilFilter = hasilFilter.filter((d) => {
        const signalOk = d.signal === "BUY" || d.signal === "STRONG BUY";
        const entryOk = d.entry === "NOW";
        const gapOk = d.gap.outlook === "POSSIBLE GAP UP" || d.gap.outlook === "HIGH GAP UP";
        const closingOk = typeof d.closingStrength === "number" && d.closingStrength >= 0.5;
        const volumeOk = d.volume && d.volume.signal !== "LOW";

        return signalOk && entryOk && gapOk && closingOk && volumeOk;
      });
    }

    if (onlyBreakout === "true") {
      hasilFilter = hasilFilter.filter((d) => d.breakout && d.breakout.isBreakout);
    }

    // Filter regime makro (OFF secara default, lihat MACRO_FILTER_ENABLED
    // di atas) — saat RISK_OFF, sinyal BUY/STRONG BUY butuh score_adjusted
    // yang lebih tinggi supaya lolos, bukan langsung dibuang semua.
    if (MACRO_FILTER_ENABLED && macroFilter === "true" && marketRegime === "RISK_OFF") {
      hasilFilter = hasilFilter.filter((d) => {
        const isBuySignal = d.signal === "BUY" || d.signal === "STRONG BUY";
        if (!isBuySignal) return true;
        return d.scoreAdjusted >= 80;
      });
    }

    // Ranking (24 Juli 2026 — ditambah entry timing sebagai kriteria
    // pertama): sebelumnya urutan cuma pakai breakout+rank, jadi saham
    // signal BUY/STRONG BUY dengan skor tinggi bisa nangkring di atas
    // walau entry-nya AVOID (RSI kepentok gerbang di getEntryTiming,
    // biasanya karena breakout belum terkonfirmasi) — verdict-nya
    // "Belum layak dibeli" tapi tetap tampil sebagai kandidat teratas,
    // kontradiktif untuk user yang cuma lihat urutan/badge signal.
    // entry === "NOW" sekarang jadi tier tertinggi, supaya yang benar-benar
    // "layak dibeli sekarang" memang muncul duluan. Saham lain (WAIT/AVOID)
    // TETAP ada di hasil (tidak dibuang, cuma di bawah) supaya masih bisa
    // dipantau dari dashboard.
    hasilFilter.sort((a, b) => {
      const aReady = a.entry === "NOW" ? 1 : 0;
      const bReady = b.entry === "NOW" ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;

      const aBreak = a.breakout && a.breakout.isBreakout ? 1 : 0;
      const bBreak = b.breakout && b.breakout.isBreakout ? 1 : 0;
      if (aBreak !== bBreak) return bBreak - aBreak;
      return b.rank - a.rank;
    });

    return res.status(200).json({
      success: true,
      scanned: kodeList.length,
      succeeded: analyzed.length,
      failed: failed.length + analyzeErrors.length,
      failedCodes: [...failed, ...analyzeErrors.map((e) => e.kode)],
      analyzeErrors,
      breakoutCount: analyzed.filter((d) => d.breakout && d.breakout.isBreakout).length,
      readyNowCount: analyzed.filter((d) => d.entry === "NOW").length,
      illiquidCount, // dibuang dari `data` tapi tetap dicatat di scan_history untuk training
      highConvictionRequested: highConviction === "true",
      highConvictionApplied: HIGH_CONVICTION_ENABLED && highConviction === "true",
      marketRegime,
      marketRegimeScore,
      macroFilterRequested: macroFilter === "true",
      macroFilterApplied: MACRO_FILTER_ENABLED && macroFilter === "true",
      logging: logResult,
      data: hasilFilter
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Batch scan gagal.",
      error: error.message,
      stack: error.stack
    });
  }
}
