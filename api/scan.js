// ==========================
// Batch Scanner — Semua Emiten
// ==========================
//
// Next-Day Opportunity V1:
// Menambahkan analisis peluang kenaikan H+1 dari harga CLOSE H,
// bukan hanya memprediksi gap/open.
//
// Engine utama tetap dipertahankan.
// Next-Day Opportunity berjalan sebagai layer aktif untuk ranking strategi beli sore -> jual pagi.
//
// ==========================

import { analyzeStock } from "../engine/analyzer.js";
import { getStockData } from "../services/stockService.js";
import { getIhsgCloses } from "../services/marketService.js";
import {
  resolveUniverse,
  UNIVERSE as STATIC_UNIVERSE
} from "../config/universe.js";
import {
  logScanSnapshots,
  getScannedKodeForDate
} from "../services/dataLogService.js";
import {
  isTradingDay,
  nonTradingDayReason,
  todayWIB
} from "../config/tradingCalendar.js";
import { getLatestMacroSnapshot } from "../services/macroDataService.js";
import { getGapCalibrationMap } from "../services/gapCalibrationService.js";
import { applyRegimeAdjustment } from "../engine/marketRegime.js";

// ==========================
// CONFIG
// ==========================

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 12;

// ============================================================
// KONTRAK PENYIMPANAN — 10 September 2026
// ============================================================
// Riwayat kegagalan scan_history sejauh ini SEMUANYA berbentuk sama:
// endpoint jalan, tidak ada yang tersimpan, dan tidak ada yang tahu.
//   - 20-21 Agu: kolom camelCase bikin batch insert gagal, API tetap 200.
//   - 07 Sep  : scheduler GitHub membuang jadwal scan.
//   - 09 Sep  : gerbang persist menuntut ?persist=true, sementara
//               pemanggil mengirim ?mode=scheduled -> semua baris
//               dihitung lalu dibuang dengan PERSIST_NOT_REQUESTED.
//
// Aturan yang sekarang berlaku:
//   1. Menulis diminta lewat mode=scheduled ATAU persist=true. Dua-duanya
//      diterima supaya pemanggil lama/baru tidak bisa lagi "salah nama
//      parameter" dan kehilangan satu hari penuh.
//   2. Kalau penulisan diminta tapi GAGAL atau TIDAK LENGKAP, respons
//      berstatus HTTP 5xx dengan success:false. Tidak ada lagi 200 palsu.
//      Cron Vercel, GitHub Actions, dan cron-job.org semuanya membaca
//      status HTTP, jadi ketiganya otomatis ikut melihat kegagalan.
//   3. Penulisan ditolak sebelum 16:20 WIB (HTTP 409), sama dengan
//      ambang isAfterMarketCloseWIB() di label-outcomes-close.js.
//   4. resume=1 hanya memproses kode yang BELUM tersimpan hari ini.
//      Dipakai lapis cadangan & retry, supaya panggilan kedua murah dan
//      tidak kena batas 60 detik di titik yang sama.
//   5. Fetch berhenti mulai kode baru setelah FETCH_TIME_BUDGET_MS, lalu
//      yang sudah didapat tetap disimpan. Timeout 60 detik tidak lagi
//      berarti nol baris.
const PERSIST_AFTER_HOUR = 16;
const PERSIST_AFTER_MINUTE = 20;
const FETCH_TIME_BUDGET_MS = 40000;
const MIN_COVERAGE = 0.9;

// Tetap OFF.
// Tidak digunakan untuk mengubah ranking / BUY / SELL.
const HIGH_CONVICTION_ENABLED = false;

// Tetap OFF.
// Market regime hanya dicatat.
const MACRO_FILTER_ENABLED = false;

// ==========================
// Helper: concurrency pool
// ==========================

async function runPool(items, worker, concurrency, deadlineMs = null) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const i = cursor++;

      // Lewat anggaran waktu: jangan mulai item baru. Yang sudah jalan
      // dibiarkan selesai. Item sisanya ditandai supaya bisa dilaporkan
      // dan dilanjutkan oleh panggilan resume=1.
      if (deadlineMs !== null && Date.now() >= deadlineMs) {
        results[i] = { budgetSkipped: true };
        continue;
      }

      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = {
          error: e?.message || "Unknown worker error"
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(concurrency, items.length)
      },
      next
    )
  );

  return results;
}

// ==========================
// Helper: safe number
// ==========================

function safeNumber(value, fallback = null) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return n;
}

// ==========================
// Helper: jam WIB (jam + menit)
// ==========================

function wibClock(date = new Date()) {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return {
    hour: wib.getUTCHours(),
    minute: wib.getUTCMinutes()
  };
}

function isAfterPersistGate(date = new Date()) {
  const { hour, minute } = wibClock(date);
  return (
    hour > PERSIST_AFTER_HOUR ||
    (hour === PERSIST_AFTER_HOUR && minute >= PERSIST_AFTER_MINUTE)
  );
}

// ==========================
// Handler
// ==========================

export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    const {
      limit,
      minScore,
      maxPrice,
      sector,
      onlyBreakout,
      highConviction,
      macroFilter,
      force,
      persist,
      mode,
      resume
    } = req.query;

    // Keputusan tulis/baca diambil SEKALI di awal, dari waktu request
    // masuk — bukan setelah fetch selesai.
    const persistRequested =
      mode === "scheduled" || persist === "true";

    const resumeRequested =
      persistRequested &&
      (resume === "1" || resume === "true");

    // ==========================
    // Trading day guard
    // ==========================

    const today = todayWIB();

    if (!isTradingDay(today) && force !== "true") {
      return res.status(200).json({
        skipped: true,
        reason: nonTradingDayReason(today),
        scan_date: today,
        message:
          "Hari ini bukan hari bursa (weekend atau libur nasional IDX), " +
          "scan dilewati. Tambahkan ?force=true kalau memang sengaja mau scan manual."
      });
    }

    // ==========================
    // Gerbang jam tutup pasar (hanya untuk permintaan tulis)
    // ==========================
    // Ditolak SEBELUM fetch, supaya cron yang terpicu kepagian tidak
    // membakar 40+ detik dan kuota data untuk hasil yang pasti dibuang.
    // HTTP 409 = pemanggil salah waktu; kelihatan merah di semua lapis.

    if (
      persistRequested &&
      !isAfterPersistGate() &&
      force !== "true"
    ) {
      const { hour, minute } = wibClock();
      return res.status(409).json({
        success: false,
        persistence_mode: "scheduled",
        persistence: {
          requested: true,
          status: "BEFORE_MARKET_CLOSE",
          detail:
            `Penulisan diminta pukul ${String(hour).padStart(2, "0")}:` +
            `${String(minute).padStart(2, "0")} WIB. Scan terjadwal baru boleh ` +
            `menulis mulai ${PERSIST_AFTER_HOUR}:${PERSIST_AFTER_MINUTE} WIB ` +
            "supaya harga pre-closing tidak tersimpan sebagai close. " +
            "Tambahkan &force=true kalau memang disengaja."
        }
      });
    }

    // ==========================
    // Universe
    // ==========================

    const {
      list: UNIVERSE,
      sectorOf,
      marketCapOf,
      source: universeSource
    } = await resolveUniverse();

    const dynamicSet = new Set(UNIVERSE);

    const excludedFromUniverseCodes =
      universeSource === "DB"
        ? STATIC_UNIVERSE.filter((k) => !dynamicSet.has(k))
        : [];

    let kodeList = UNIVERSE;

    // ==========================
    // Limit
    // ==========================

    if (limit) {
      const n = parseInt(limit, 10);

      if (Number.isFinite(n) && n > 0) {
        kodeList = kodeList.slice(0, n);
      }
    }

    // ==========================
    // Sector filter
    // ==========================

    if (sector) {
      kodeList = kodeList.filter(
        (k) =>
          sectorOf(k).toLowerCase() ===
          String(sector).toLowerCase()
      );
    }

    // ==========================
    // Resume: lewati kode yang sudah tersimpan hari ini
    // ==========================

    const universeTotal = kodeList.length;
    let alreadySavedCount = 0;
    let resumeNote = null;

    if (resumeRequested) {
      try {
        const saved = new Set(
          await getScannedKodeForDate(today)
        );
        const before = kodeList.length;
        kodeList = kodeList.filter((k) => !saved.has(k));
        alreadySavedCount = before - kodeList.length;
      } catch (e) {
        // Gagal baca = scan penuh. Lebih mahal, tapi tidak pernah
        // membuat hari itu kosong.
        resumeNote =
          "Gagal membaca baris tersimpan, resume diabaikan: " +
          (e?.message || "unknown");
      }

      if (kodeList.length === 0) {
        return res.status(200).json({
          success: true,
          scan_date: today,
          scanned: 0,
          universeTotal,
          persistence_mode: "scheduled",
          persistence: {
            requested: true,
            status: "SAVED",
            resume: true,
            alreadySaved: alreadySavedCount,
            savedThisRun: 0,
            savedTotal: alreadySavedCount,
            universeTotal,
            coverage: 1,
            detail:
              "Semua kode hari ini sudah tersimpan. Tidak ada yang perlu diproses."
          },
          logging: { logged: 0, skipped: true, reason: "ALREADY_COMPLETE" }
        });
      }
    }

    // ==========================
    // IHSG
    // ==========================

    const ihsgCloses = await getIhsgCloses();

    // ==========================
    // Macro
    // ==========================

    const macroSnapshot = await getLatestMacroSnapshot();

    const marketRegime =
      macroSnapshot?.market_regime ?? null;

    const marketRegimeScore =
      safeNumber(
        macroSnapshot?.market_regime_score,
        50
      );

    // ==========================
    // Gap calibration
    // ==========================

    const gapCalibrationMap =
      await getGapCalibrationMap();

    // ==========================
    // Tahap 1
    // Fetch data semua saham
    // ==========================

    const fetched = await runPool(
      kodeList,
      async (kode) => {
        const stockData = await getStockData(kode);

        return {
          kode,
          stockData,
          sector: sectorOf(kode),
          marketCap: marketCapOf(kode)
        };
      },
      CONCURRENCY,
      startedAt + FETCH_TIME_BUDGET_MS
    );

    const ok = fetched.filter(
      (f) => f && !f.error && !f.budgetSkipped
    );

    const budgetSkippedCodes = fetched
      .map((f, i) =>
        f && f.budgetSkipped
          ? kodeList[i]
          : null
      )
      .filter(Boolean);

    const failed = fetched
      .map((f, i) =>
        f && f.error
          ? kodeList[i]
          : null
      )
      .filter(Boolean);

    // ==========================
    // Tahap 2
    // Analyze
    // ==========================
    //
    // CATATAN (15 Agustus 2026): dulu di sini ada perhitungan sectorReturn
    // (rata-rata return 20-hari semua saham 1 sektor dari batch ini),
    // dipakai sebagai fallback relativeStrength.vsSector kalau vsIhsg
    // tidak tersedia. TAPI api/analyze.js (menu analisa satu-saham) TIDAK
    // PERNAH mengisi sectorReturn — data peer sektor cuma tersedia dari
    // batch scan, bukan analisa satu ticker. Akibatnya, untuk saham &
    // waktu yang SAMA, relativeStrength.label (dan skor/signal yang
    // menurunkannya) BISA beda antara hasil batch scan (dipakai
    // riwayat/kalibrasi) vs menu analisa (yang benar-benar dilihat &
    // dipakai user untuk memutuskan entry) — kalibrasi scoring jadi
    // menyesatkan karena tidak mengukur apa yang sebenarnya user lihat.
    //
    // Sama seperti fundamental.score yang sudah dilepas dari skor 3
    // Agustus 2026 dengan alasan yang sama persis (lihat catatan di
    // engine/analyzer.js), sectorReturn sekarang TIDAK diisi lagi di sini
    // — data.sectorReturn dibiarkan undefined, supaya relativeStrength
    // batch scan identik dengan menu analisa (cuma vs IHSG). rs_vs_sector
    // di scan_history karena itu akan selalu null untuk baris baru —
    // ini sengaja, bukan bug.

    const analyzeErrors = [];

    const analyzed = ok
      .map((item) => {
        try {
          item.stockData.ihsgCloses =
            ihsgCloses;

          item.stockData.sector =
            item.sector;

          item.stockData.gapCalibration =
            gapCalibrationMap;

          // Ditambahkan 20 Agustus 2026 - supaya sessionGainScore.js
          // (dipanggil di dalam analyzeStock()) menerima marketRegimeScore
          // yang sebenarnya, bukan fallback netral 50. marketRegimeScore
          // sudah dihitung di atas sebelum loop ini.
          item.stockData.marketRegimeScore =
            marketRegimeScore;

          // ==========================
          // Mesin analisis utama
          // ==========================

          const hasil =
            analyzeStock(
              item.stockData
            );

          hasil.sector =
            item.sector;

          hasil.marketCap =
            item.marketCap ?? null;

          // ==========================
          // Market regime
          // ==========================

          hasil.marketRegime =
            marketRegime;

          hasil.marketRegimeScore =
            marketRegimeScore;

          hasil.scoreAdjusted =
            applyRegimeAdjustment(
              hasil.score,
              marketRegimeScore
            );

          // ==========================
          // NEXT-DAY OPPORTUNITY
          // ==========================
          //
          // Engine sudah dipanggil oleh
          // analyzer.js.
          //
          // Kita hanya memastikan hasilnya
          // tetap aman jika engine tidak
          // menghasilkan object.
          // ==========================

          if (
            !hasil.nextDayOpportunity ||
            typeof hasil.nextDayOpportunity !==
              "object"
          ) {
            hasil.nextDayOpportunity = null;
          }

          return hasil;

        } catch (e) {
          analyzeErrors.push({
            kode: item.kode,
            error:
              e?.message ||
              "Unknown analyzer error"
          });

          return null;
        }
      })
      .filter(Boolean);

    // ==========================
    // Scan date
    // ==========================

    // FIX (21 Agustus 2026): dulu pakai new Date().toISOString().slice(0,10)
    // yaitu tanggal UTC, bukan WIB — tidak konsisten dengan todayWIB() yang
    // dipakai guard hari bursa di atas. Kebetulan aman untuk jam cron saat
    // ini (16:30 WIB = masih tanggal UTC yang sama), TAPI kalau endpoint
    // dipanggil manual larut malam WIB (sesudah 00:00 WIB tapi sebelum
    // 07:00 WIB, saat UTC masih di tanggal sebelumnya) baris akan tersimpan
    // dengan scan_date yang salah (mundur 1 hari). Disamakan ke todayWIB().
    const scanDate = today;

    // ==========================
    // Snapshot rows
    // ==========================

    const snapshotRows =
      analyzed.map((d) => {

        const opportunity =
          d.nextDayOpportunity || null;

        return {
          // ======================
          // Basic
          // ======================

          kode: d.kode,
          sector: d.sector,
          scan_date: scanDate,

          close: d.close,

          score: d.score,
          signal: d.signal,
          entry: d.entry,
          distribution_flag: d.distributionFlag ?? false,

          rsi: d.rsi,

          macd:
            d.macd?.macd ?? null,

          sma20: d.sma20,
          sma50: d.sma50,

          ema9: d.ema9,
          ema20: d.ema20,

          risk_reward:
            d.riskReward,

          atr: d.atr,

          // ======================
          // Breakout
          // ======================

          breakout_level:
            d.breakout?.level ?? null,

          breakout_distance_pct:
            d.breakout?.distancePercent ??
            null,

          // ======================
          // Closing
          // ======================

          closing_strength:
            d.closingStrength,

          // ======================
          // Volume
          // ======================

          volume_ratio:
            d.volume?.ratio ?? null,

          volume_signal:
            d.volume?.signal ?? null,

          volume_accel_slope_pct:
            d.volumeAcceleration
              ?.slopePercent ?? null,

          volume_accelerating:
            d.volumeAcceleration
              ?.accelerating ?? null,

          // ======================
          // Relative strength
          // ======================

          rs_vs_ihsg:
            d.relativeStrength
              ?.vsIhsg ?? null,

          rs_vs_sector:
            d.relativeStrength
              ?.vsSector ?? null,

          rs_label:
            d.relativeStrength
              ?.label ?? null,

          // ======================
          // Gap
          // ======================

          gap_outlook:
            d.gap?.outlook ?? null,

          gap_probability:
            d.gap?.probability
              ? parseFloat(
                  String(
                    d.gap.probability
                  ).replace("%", "")
                )
              : null,

          gap_calibration_applied:
            d.gap
              ?.calibrationApplied ??
            false,

          gap_bucket_sample_count:
            d.gap
              ?.bucketSampleCount ??
            null,

          // ======================
          // Session gain
          // ======================

          session_gain_score:
            d.sessionGain
              ?.sessionGainScore ??
            null,

          session_gain_label:
            d.sessionGain?.label ??
            null,

          // ======================
          // Liquidity
          // ======================

          illiquid:
            d.liquidity
              ?.illiquid ??
            false,

          illiquid_reason:
            d.liquidity
              ?.reason ??
            null,

          // ======================
          // Market regime
          // ======================

          market_regime:
            d.marketRegime ??
            null,

          market_regime_score:
            d.marketRegimeScore ??
            null,

          score_adjusted:
            d.scoreAdjusted ??
            null,

          // ======================
          // Existing candidates
          // ======================

          reversal_candidate:
            d.reversalCandidate ??
            false,

          capitulation_bounce_candidate:
            d.capitulationBounceCandidate ??
            false,

          strong_buy_confirmed:
            d.strongBuyConfirmed ??
            false,

          // Bonus sinergi volume EXPLOSIVE + rs_label JAUH OUTPERFORM —
          // ditambahkan 14 Agustus 2026, lihat catatan lengkap di
          // engine/sessionGainScore.js. Dicatat terpisah (sama seperti
          // reversal/capitulation/strongBuy di atas) supaya bisa terus
          // dievaluasi dari next_day_return_pct & max_gain_from_open_pct
          // sesungguhnya seiring data bertambah.
          volume_rs_synergy:
            d.volumeRsSynergy ??
            false,

          // ======================
          // Exhaustion
          // ======================

          exhaustion_score:
            d.exhaustion
              ?.exhaustionScore ??
            null,

          exhaustion_label:
            d.exhaustion?.label ??
            null,

          // ======================
          // Distribution
          // ======================

          distribution_score:
            d.distribution
              ?.distributionScore ??
            null,

          distribution_label:
            d.distribution?.label ??
            null,

          // ======================
          // Fundamentals
          // ======================

          market_cap:
            d.marketCap ??
            null,

          pe_ratio: null,

          // =================================================
          // NEXT-DAY OPPORTUNITY
          // =================================================
          //
          // Nama kolom harus sesuai migration Supabase.
          //
          // Jika engine menghasilkan null,
          // database akan menerima null.
          // =================================================

          next_day_opportunity_score:
            safeNumber(
              opportunity
                ?.opportunityScore
            ),

          next_day_opportunity_probability_3pct:
            safeNumber(
              opportunity
                ?.opportunityProbability
            ),

          next_day_opportunity_probability_5pct:
            safeNumber(
              opportunity
                ?.opportunityProbability5Pct
            ),

          // V4 (3 Sep 2026) mengganti target >=10% dengan >=8%. Di IDX,
          // target >=10% dalam sehari hampir selalu berarti ARA, yang
          // didominasi saham gorengan dan sering tidak bisa dieksekusi —
          // jadi bukan target yang layak dipakai model. Kolom lama
          // sengaja tidak diisi lagi (dibiarkan null) supaya data
          // historisnya tidak tercampur dengan definisi berbeda.
          next_day_opportunity_probability_8pct:
            safeNumber(
              opportunity
                ?.opportunityProbability8Pct
            ),

          next_day_close_2pct_probability:
            safeNumber(
              opportunity
                ?.nextDayClose2PctProbability
            ),

          next_day_opportunity_model_version:
            opportunity
              ?.version ??
            null,

          next_day_opportunity_label:
            opportunity
              ?.opportunityLabel ??
            null,

          next_day_opportunity_setup:
            opportunity
              ?.coreSetup ??
            null,

          next_day_opportunity_setup_detail:
            opportunity
              ?.setupDetail ??
            null,

          next_day_opportunity_eligible:
            opportunity
              ?.eligible ??
            false,

          // BARU (3 Sep 2026). conviction_tier memisahkan "ada setup"
          // dari "seberapa yakin": PRIMARY = HIGH, SECONDARY = MODERATE,
          // NONE = di bawah ambang. Sebelumnya UI menebak sendiri dari
          // label, dan tebakannya berbeda antara headline dan field di
          // bawahnya — itu sumber kartu SQMI yang bilang "PRIORITAS"
          // sekaligus "TIDAK VALID".
          next_day_conviction_tier:
            opportunity
              ?.convictionTier ??
            null,

          // fade_risk & exit_plan memisahkan peluang MENYENTUH target
          // dari peluang MEMPERTAHANKANNYA sampai penutupan.
          next_day_fade_risk:
            opportunity
              ?.fadeRisk ??
            null,

          next_day_exit_plan:
            opportunity
              ?.exitPlan ??
            null,

          // ATR sebagai persen harga — fitur terkuat model V4, disimpan
          // supaya evaluasi berikutnya bisa menormalisasi hasil terhadap
          // volatilitas, bukan sekadar membandingkan win rate mentah.
          atr_percent:
            safeNumber(opportunity?.atrPercent),

          next_day_entry_quality_score:
            safeNumber(opportunity?.entryQualityScore),

          next_day_entry_quality_label:
            opportunity?.entryQualityLabel ?? null,

          next_day_chase_risk:
            opportunity?.chaseRisk ?? null,

          next_day_entry_decision:
            opportunity?.entryDecision ?? null,

          next_day_entry_eligible:
            opportunity?.entryEligible ?? false,

          // Sudah naik berapa % hari ini vs close kemarin — ditambahkan
          // 14 Agustus 2026 sebagai info transparansi risiko (BUKAN
          // penalti skor, sudah diuji ke data & ternyata expected value-
          // nya tidak negatif — lihat catatan lengkap di
          // engine/nextDayOpportunity.js). entry_timing_conflict
          // menandai kapan TIMING TEKNIKAL bilang AVOID tapi Next-Day
          // Opportunity tetap eligible untuk saham & waktu yang sama.
          //
          // BUG FIX (21 Agustus 2026): dulu field ini SEMPAT juga
          // dikirim dengan key camelCase salah ("entryTimingConflict")
          // di bagian atas object ini (dekat "entry:") — nama kolom itu
          // TIDAK ADA di skema Supabase, dan karena insert Supabase
          // bersifat all-or-nothing per batch, SATU key salah ini bikin
          // SELURUH insert scan hari itu gagal (PGRST204 "Could not
          // find the entryTimingConflict column"), walau response
          // /api/scan tetap 200 OK — ini akar penyebab tabel Riwayat
          // kosong di 08/20 & 08/21 meski cron sudah jalan. Sudah
          // dihapus; SATU-SATUNYA key yang valid untuk field ini adalah
          // entry_timing_conflict (snake_case) di bawah ini. Kalau
          // nambah kolom baru lagi, JANGAN duplikat mapping manual di
          // sini — pindahkan snapshotRows ke buildSnapshotRow() di
          // services/snapshotBuilder.js (comment di file itu sudah
          // dibuat untuk mencegah masalah persis ini terulang).
          daily_change_pct:
            safeNumber(d.dailyChangePercent),

          entry_timing_conflict:
            d.entryTimingConflict ??
            false
        };
      });

    // ==========================
    // Simpan ke Supabase
    // ==========================

    // ============================================================
    // PERSIST
    // ============================================================
    // Lihat "KONTRAK PENYIMPANAN" di bagian atas file. Ringkasnya:
    // tombol Screener (tanpa mode/persist) = baca saja, tidak pernah
    // menulis. Cron (mode=scheduled) = menulis, dan kalau gagal/tidak
    // lengkap respons berstatus 5xx.
    //
    // Catatan keamanan yang jujur: mode=scheduled adalah parameter URL
    // biasa, bukan rahasia. Yang benar-benar melindungi data adalah
    // gerbang 16:20 WIB di atas — sesudah jam itu, siapa pun yang
    // memicu scan hanya menghitung ulang angka penutupan yang sama.

    let logResult;

    if (!persistRequested) {
      logResult = {
        logged: 0,
        skipped: true,
        reason: "READ_ONLY",
        detail:
          "Mode baca saja (tombol Screener). Hanya panggilan cron dengan " +
          "mode=scheduled yang menulis ke scan_history."
      };
    } else {
      logResult = await logScanSnapshots(snapshotRows);
    }

    // ==========================
    // Status penyimpanan
    // ==========================

    const savedThisRun = Number(logResult?.logged) || 0;
    const savedTotal = alreadySavedCount + savedThisRun;
    const coverage =
      universeTotal > 0
        ? Number((savedTotal / universeTotal).toFixed(4))
        : 0;

    let persistenceStatus = "READ_ONLY";

    if (persistRequested) {
      if (logResult?.reason === "SUPABASE_NOT_CONFIGURED") {
        persistenceStatus = "NOT_CONFIGURED";
      } else if (logResult?.error) {
        persistenceStatus = "INSERT_FAILED";
      } else if (coverage >= MIN_COVERAGE) {
        persistenceStatus = "SAVED";
      } else {
        persistenceStatus = "PARTIAL";
      }
    }

    const persistenceOk =
      !persistRequested || persistenceStatus === "SAVED";

    // PARTIAL = 503 (coba lagi, resume=1 akan melanjutkan sisanya).
    // Gagal simpan / belum dikonfigurasi = 500.
    const httpStatus = persistenceOk
      ? 200
      : persistenceStatus === "PARTIAL"
        ? 503
        : 500;

    const persistence = {
      requested: persistRequested,
      status: persistenceStatus,
      resume: resumeRequested,
      resumeNote,
      alreadySaved: alreadySavedCount,
      savedThisRun,
      savedTotal,
      universeTotal,
      coverage,
      minCoverage: MIN_COVERAGE,
      fetchFailed: failed.length,
      analyzeFailed: analyzeErrors.length,
      budgetSkipped: budgetSkippedCodes.length,
      error: logResult?.error ?? null
    };

    // ==========================
    // Filter display
    // ==========================

    const illiquidCount =
      analyzed.filter(
        (d) =>
          d.liquidity?.illiquid
      ).length;

    let hasilFilter =
      analyzed.filter(
        (d) =>
          !d.liquidity?.illiquid
      );

    // ==========================
    // minScore
    // ==========================

    if (minScore) {
      const n =
        parseInt(
          minScore,
          10
        );

      if (Number.isFinite(n)) {
        hasilFilter =
          hasilFilter.filter(
            (d) =>
              d.score >= n
          );
      }
    }

    // ==========================
    // maxPrice
    // ==========================

    if (maxPrice) {
      const n =
        parseFloat(
          maxPrice
        );

      if (Number.isFinite(n)) {
        hasilFilter =
          hasilFilter.filter(
            (d) =>
              d.close < n
          );
      }
    }

    // ==========================
    // High Conviction
    // ==========================

    if (
      HIGH_CONVICTION_ENABLED &&
      highConviction === "true"
    ) {
      hasilFilter =
        hasilFilter.filter(
          (d) => {

            const signalOk =
              d.signal === "BUY" ||
              d.signal ===
                "STRONG BUY";

            const entryOk =
              d.entry === "NOW";

            const gapOk =
              d.gap?.outlook ===
                "POSSIBLE GAP UP" ||
              d.gap?.outlook ===
                "HIGH GAP UP";

            const closingOk =
              typeof d.closingStrength ===
                "number" &&
              d.closingStrength >=
                0.5;

            const volumeOk =
              d.volume &&
              d.volume.signal !==
                "LOW";

            return (
              signalOk &&
              entryOk &&
              gapOk &&
              closingOk &&
              volumeOk
            );
          }
        );
    }

    // ==========================
    // Breakout filter
    // ==========================

    if (
      onlyBreakout === "true"
    ) {
      hasilFilter =
        hasilFilter.filter(
          (d) =>
            d.breakout &&
            d.breakout.isBreakout
        );
    }

    // ==========================
    // Macro filter
    // ==========================

    if (
      MACRO_FILTER_ENABLED &&
      macroFilter === "true" &&
      marketRegime ===
        "RISK_OFF"
    ) {
      hasilFilter =
        hasilFilter.filter(
          (d) => {

            const isBuySignal =
              d.signal === "BUY" ||
              d.signal ===
                "STRONG BUY";

            if (!isBuySignal) {
              return true;
            }

            return (
              d.scoreAdjusted >=
              80
            );
          }
        );
    }

    // =========================================================
    // Ranking
    // =========================================================
    //
    // Ranking strategi beli sore -> jual pagi sekarang memprioritaskan
    // keputusan entry yang sudah melewati Opportunity + Entry Quality.
    // Ini mencegah saham yang Opportunity-nya HIGH tetapi harga sudah
    // terlalu extended naik ke urutan BUY SORE.
    // =========================================================

    hasilFilter.sort(
      (a, b) => {

        const decisionRank = { BUY_NOW: 4, WAIT_PULLBACK: 3, WATCH: 2, AVOID: 1, NO_SETUP: 0 };
        const aTrade = decisionRank[a.nextDayOpportunity?.tradeDecision] ?? 0;
        const bTrade = decisionRank[b.nextDayOpportunity?.tradeDecision] ?? 0;

        if (aTrade !== bTrade) {
          return bTrade - aTrade;
        }

        const aReady =
          a.entry === "NOW"
            ? 1
            : 0;

        const bReady =
          b.entry === "NOW"
            ? 1
            : 0;

        if (
          aReady !== bReady
        ) {
          return (
            bReady -
            aReady
          );
        }

        const aBreak =
          a.breakout &&
          a.breakout.isBreakout
            ? 1
            : 0;

        const bBreak =
          b.breakout &&
          b.breakout.isBreakout
            ? 1
            : 0;

        if (
          aBreak !== bBreak
        ) {
          return (
            bBreak -
            aBreak
          );
        }

        return (
          b.rank -
          a.rank
        );
      }
    );

    // =========================================================
    // NEXT-DAY OPPORTUNITY STATS
    // =========================================================

    const opportunityResults =
      analyzed
        .map(
          (d) =>
            d.nextDayOpportunity
        )
        .filter(Boolean);

    const nextDayOpportunityStats =
      {
        total:
          opportunityResults.length,

        high:
          opportunityResults.filter(
            (x) =>
              x.opportunityLabel ===
              "HIGH"
          ).length,

        moderate:
          opportunityResults.filter(
            (x) =>
              x.opportunityLabel ===
              "MODERATE"
          ).length,

        // DITAMBAHKAN 3 Sep 2026. Label yang dihasilkan engine adalah
        // HIGH / MODERATE / WATCH / LOW — "WATCH" tidak pernah dihitung
        // di sini, jadi high+moderate+low selalu lebih kecil dari total
        // dan selisihnya tidak terjelaskan.
        watch:
          opportunityResults.filter(
            (x) =>
              x.opportunityLabel ===
              "WATCH"
          ).length,

        low:
          opportunityResults.filter(
            (x) =>
              x.opportunityLabel ===
              "LOW"
          ).length,

        // "AVOID" bukan label opportunity — itu nilai entryQualityLabel /
        // entryDecision. Field ini selalu 0 sejak awal. Dipertahankan
        // supaya konsumen lama tidak pecah, tapi jangan dipakai.
        avoid: 0,

        // eligible sekarang mencakup HIGH DAN MODERATE (lihat
        // engine/nextDayOpportunity.js). Untuk membedakan bobotnya,
        // pakai dua field di bawah, bukan eligible saja.
        eligible:
          opportunityResults.filter(
            (x) =>
              x.eligible ===
              true
          ).length,

        primary:
          opportunityResults.filter(
            (x) =>
              x.convictionTier === "PRIMARY"
          ).length,

        secondary:
          opportunityResults.filter(
            (x) =>
              x.convictionTier === "SECONDARY"
          ).length,

        entryEligible:
          opportunityResults.filter(
            (x) =>
              x.entryEligible === true
          ).length,

        // Fade risk tinggi = peluang menyentuh target bagus tapi peluang
        // bertahan sampai close rendah. Berguna untuk melihat sekilas
        // apakah hari itu didominasi kandidat yang harus dijual di target.
        fadeRiskHigh:
          opportunityResults.filter(
            (x) =>
              x.fadeRisk === "HIGH"
          ).length,

        waitPullback:
          opportunityResults.filter(
            (x) =>
              x.entryDecision === "WAIT_PULLBACK"
          ).length,

        avoidEntry:
          opportunityResults.filter(
            (x) =>
              x.entryDecision === "AVOID"
          ).length
      };

    // ==========================
    // Response
    // ==========================

    return res.status(httpStatus).json({

      success: persistenceOk,

      scan_date: scanDate,

      scanned:
        kodeList.length,

      universeTotal,

      elapsedMs:
        Date.now() - startedAt,

      // Dipertahankan untuk kompatibilitas workflow lama yang
      // memeriksa field ini.
      persistence_mode:
        persistRequested
          ? "scheduled"
          : "read_only",

      persistence,

      budgetSkippedCodes,

      macroSnapshotDate:
        macroSnapshot?.snapshot_date ?? null,

      macroFresh:
        (macroSnapshot?.snapshot_date ?? null) === today,

      universeSource,

      succeeded:
        analyzed.length,

      // Kode yang terpotong anggaran waktu ikut dihitung "gagal" supaya
      // ringkasan di tombol Screener tidak diam-diam lebih sedikit.
      failed:
        failed.length +
        analyzeErrors.length +
        budgetSkippedCodes.length,

      failedCodes: [
        ...failed,
        ...analyzeErrors.map(
          (e) => e.kode
        ),
        ...budgetSkippedCodes
      ],

      analyzeErrors,

      breakoutCount:
        analyzed.filter(
          (d) =>
            d.breakout &&
            d.breakout.isBreakout
        ).length,

      readyNowCount:
        analyzed.filter(
          (d) =>
            d.entry === "NOW"
        ).length,

      illiquidCount,

      excludedFromUniverse:
        excludedFromUniverseCodes.length,

      excludedFromUniverseCodes,

      // ======================
      // High Conviction
      // ======================

      highConvictionRequested:
        highConviction ===
        "true",

      highConvictionApplied:
        HIGH_CONVICTION_ENABLED &&
        highConviction ===
          "true",

      // ======================
      // Macro
      // ======================

      marketRegime,

      marketRegimeScore,

      macroFilterRequested:
        macroFilter ===
        "true",

      macroFilterApplied:
        MACRO_FILTER_ENABLED &&
        macroFilter ===
          "true",

      // ======================
      // NEXT-DAY OPPORTUNITY
      // ======================

      nextDayOpportunityStats,

      nextDayOpportunityMode:
        "ACTIVE_ENTRY_AWARE",

      nextDayOpportunityAffectsRanking:
        true,

      // ======================
      // Logging
      // ======================

      logging:
        logResult,

      // ======================
      // Data
      // ======================
      // Panggilan cron tidak butuh ratusan objek analisa di respons;
      // tanpa ini log GitHub Actions membengkak sampai megabyte.
      // Tambahkan &includeData=1 kalau memang perlu melihatnya.

      data:
        persistRequested &&
        req.query.includeData !== "1"
          ? undefined
          : hasilFilter
    });

  } catch (error) {

    console.error(
      "Batch scan error:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Batch scan gagal.",

      error:
        error?.message ||
        "Unknown error",

      stack:
        error?.stack ||
        null
    });
  }
}