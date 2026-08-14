// ==========================
// Batch Scanner — Semua Emiten
// ==========================
//
// Next-Day Opportunity V1:
// Menambahkan analisis peluang kenaikan H+1 dari harga CLOSE H,
// bukan hanya memprediksi gap/open.
//
// Engine utama tetap dipertahankan.
// Next-Day Opportunity berjalan sebagai layer tambahan / shadow mode.
//
// ==========================

import { analyzeStock } from "../engine/analyzer.js";
import { getStockData } from "../services/stockService.js";
import { getIhsgCloses } from "../services/marketService.js";
import { nDayReturn } from "../engine/relativeStrength.js";
import {
  resolveUniverse,
  UNIVERSE as STATIC_UNIVERSE
} from "../config/universe.js";
import { logScanSnapshots } from "../services/dataLogService.js";
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
const RETURN_PERIOD = 20;

// Tetap OFF.
// Tidak digunakan untuk mengubah ranking / BUY / SELL.
const HIGH_CONVICTION_ENABLED = false;

// Tetap OFF.
// Market regime hanya dicatat.
const MACRO_FILTER_ENABLED = false;

// ==========================
// Helper: concurrency pool
// ==========================

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const i = cursor++;

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
// Handler
// ==========================

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

        const stockReturn =
          nDayReturn(
            stockData.closePrices,
            RETURN_PERIOD
          );

        return {
          kode,
          stockData,
          stockReturn,
          sector: sectorOf(kode),
          marketCap: marketCapOf(kode)
        };
      },
      CONCURRENCY
    );

    const ok = fetched.filter(
      (f) => f && !f.error
    );

    const failed = fetched
      .map((f, i) =>
        f && f.error
          ? kodeList[i]
          : null
      )
      .filter(Boolean);

    // ==========================
    // Tahap 2
    // Sector return
    // ==========================

    const sectorReturns = {};
    const sectorGroups = {};

    for (const item of ok) {
      if (item.stockReturn === null) {
        continue;
      }

      if (!sectorGroups[item.sector]) {
        sectorGroups[item.sector] = [];
      }

      sectorGroups[item.sector].push(
        item.stockReturn
      );
    }

    for (const [sec, returns] of Object.entries(
      sectorGroups
    )) {
      if (!returns.length) continue;

      sectorReturns[sec] =
        returns.reduce(
          (a, b) => a + b,
          0
        ) / returns.length;
    }

    // ==========================
    // Tahap 3
    // Analyze
    // ==========================

    const analyzeErrors = [];

    const analyzed = ok
      .map((item) => {
        try {
          item.stockData.ihsgCloses =
            ihsgCloses;

          item.stockData.sectorReturn =
            sectorReturns[item.sector] ?? null;

          item.stockData.sector =
            item.sector;

          item.stockData.gapCalibration =
            gapCalibrationMap;

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

    const scanDate =
      new Date()
        .toISOString()
        .slice(0, 10);

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

          next_day_opportunity_label:
            opportunity
              ?.opportunityLabel ??
            null,

          next_day_opportunity_setup:
            opportunity
              ?.coreSetup ??
            null,

          next_day_opportunity_eligible:
            opportunity
              ?.eligible ??
            false
        };
      });

    // ==========================
    // Simpan ke Supabase
    // ==========================

    const logResult =
      await logScanSnapshots(
        snapshotRows
      );

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
    // PENTING:
    // Opportunity Score BELUM digunakan untuk mengganti ranking
    // utama. Kita masih dalam SHADOW MODE.
    //
    // Ranking lama dipertahankan agar tidak mengubah perilaku
    // SahamAI yang sudah berjalan.
    // =========================================================

    hasilFilter.sort(
      (a, b) => {

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

        low:
          opportunityResults.filter(
            (x) =>
              x.opportunityLabel ===
              "LOW"
          ).length,

        avoid:
          opportunityResults.filter(
            (x) =>
              x.opportunityLabel ===
              "AVOID"
          ).length,

        eligible:
          opportunityResults.filter(
            (x) =>
              x.eligible ===
              true
          ).length
      };

    // ==========================
    // Response
    // ==========================

    return res.status(200).json({

      success: true,

      scanned:
        kodeList.length,

      universeSource,

      succeeded:
        analyzed.length,

      failed:
        failed.length +
        analyzeErrors.length,

      failedCodes: [
        ...failed,
        ...analyzeErrors.map(
          (e) => e.kode
        )
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
        "SHADOW",

      nextDayOpportunityAffectsRanking:
        false,

      // ======================
      // Logging
      // ======================

      logging:
        logResult,

      // ======================
      // Data
      // ======================

      data:
        hasilFilter
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