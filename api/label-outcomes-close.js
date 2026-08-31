// ==========================
// Label Outcomes — FINAL SELF-HEALING WORKER
// ==========================
//
// Tujuan:
// 1. Setiap snapshot yang sudah jatuh tempo (scan_date < hari ini)
//    dapat dilabel tanpa bergantung pada Tahap 1.
// 2. Satu saham/tanggal yang gagal TIDAK boleh memblokir tanggal lain.
// 3. Retry otomatis dengan backoff untuk error sementara.
// 4. Saat candle H+1 ditemukan, worker ini mengisi OPEN + CLOSE/HIGH/LOW
//    sekaligus. Jadi kegagalan cron pagi tidak dapat membuat Max Gain/Return
//    kosong selamanya.
// 5. Peak intraday adalah metadata tambahan; tidak boleh menghalangi
//    labeling OHLC utama.
//
// Strategi:
//   scan_history (due & close_labeled_at NULL)
//        -> fetch daily OHLC H+1
//        -> isi seluruh outcome
//        -> COMPLETE
//
// Jika fetch gagal:
//   -> RETRY + next_retry_at
//   -> run berikutnya mengambil row tersebut kembali
//
// IMPORTANT:
// Jangan menggunakan candles.at(-1). Selalu cari candle trading pertama
// SETELAH scan_date.

import {
  getPendingCloseSnapshots,
  getPendingCloseSnapshotsAcrossDates,
  updateLabel,
  markCloseLabelRetry
} from "../services/dataLogService.js";

import {
  getStockData,
  findTradingDayCandleAfter,
  getIntradayPeakTime
} from "../services/stockService.js";

import { todayWIB } from "../config/tradingCalendar.js";

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 16;
const MAX_ROWS_PER_RUN = 300;
const TIME_BUDGET_MS = 48000;

const HIGH_TARGET_PCT = 3;
const CLOSE_TARGET_PCT = 2;

// Daily candle perlu buffer setelah market close resmi. 16:20 WIB
// dipakai agar candle harian tidak dilabel terlalu dini.
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 20;

function isAfterMarketCloseWIB() {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const wibMinutes = (utcMinutes + 7 * 60) % (24 * 60);
  const hour = Math.floor(wibMinutes / 60);
  const minute = wibMinutes % 60;

  return (
    hour > MARKET_CLOSE_HOUR ||
    (hour === MARKET_CLOSE_HOUR && minute >= MARKET_CLOSE_MINUTE)
  );
}

function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;

      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = {
          status: "ERROR",
          error: e?.message || String(e)
        };
      }
    }
  }

  return Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      next
    )
  ).then(() => results);
}

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pct(from, to) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) {
    return null;
  }
  return Number((((to - from) / from) * 100).toFixed(2));
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    // ============================================================
    // SECURITY
    // ============================================================
    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${process.env.CRON_SECRET}` && !req.query.manual) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Tambahkan ?manual=1 untuk menjalankan manual."
        });
      }
    }

    const today = todayWIB();
    const forcedDate = req.query.date || null;

    // Cache per kode. Satu invocation dapat mempunyai banyak tanggal untuk
    // kode yang sama; jangan fetch Yahoo/ZAPI/IDX berulang-ulang.
    const stockCache = new Map();

    async function getStockCached(kode) {
      const key = String(kode).trim().toUpperCase();
      if (stockCache.has(key)) return stockCache.get(key);

      // 3mo cukup untuk dataset SahamAI saat ini dan jauh lebih ringan
      // daripada melakukan fetch panjang untuk setiap row.
      const promise = getStockData(key, "3mo").catch(error => {
        return {
          __error: error?.message || String(error),
          candles: []
        };
      });

      stockCache.set(key, promise);
      return promise;
    }

    // ============================================================
    // AMBIL ROW YANG BENAR-BENAR DUE
    // ============================================================
    let pending;

    if (forcedDate) {
      if (forcedDate === today) {
        return res.status(200).json({
          success: true,
          scanDate: forcedDate,
          labeled: 0,
          message: "Scan hari ini belum mempunyai candle H+1."
        });
      }

      pending = await getPendingCloseSnapshots(forcedDate);
    } else {
      // TIDAK ada filter labeled_at. Close worker adalah worker mandiri.
      pending = await getPendingCloseSnapshotsAcrossDates({
        beforeDate: today,
        maxRows: MAX_ROWS_PER_RUN
      });
    }

    if (!Array.isArray(pending) || pending.length === 0) {
      return res.status(200).json({
        success: true,
        scanDate: forcedDate,
        datesProcessed: [],
        labeled: 0,
        remainingHint: "Tidak ada snapshot due yang menunggu labeling."
      });
    }

    const rows = pending.slice(0, MAX_ROWS_PER_RUN);
    const datesProcessed = [...new Set(rows.map(r => r.scan_date))];

    // ============================================================
    // DRY RUN
    // ============================================================
    if (req.query.dryRun) {
      const perDate = {};
      for (const row of rows) {
        perDate[row.scan_date] = (perDate[row.scan_date] || 0) + 1;
      }

      return res.status(200).json({
        success: true,
        dryRun: true,
        today,
        datesProcessed,
        rowsThisRun: rows.length,
        rowsPerDate: perDate,
        elapsedMs: Date.now() - startedAt
      });
    }

    // ============================================================
    // WORKER
    // ============================================================
    const results = await runPool(
      rows,
      async row => {
        // Jangan memulai network work baru ketika mendekati hard timeout.
        // Row yang belum dimulai tetap pending untuk cron berikutnya.
        if (Date.now() - startedAt >= TIME_BUDGET_MS) {
          return {
            kode: row.kode,
            scanDate: row.scan_date,
            status: "SKIPPED_TIME_BUDGET"
          };
        }

        try {
          const stockData = await getStockCached(row.kode);

          if (stockData?.__error) {
            await markCloseLabelRetry(row.id, {
              attempts: row.close_label_attempts,
              error: `STOCK_DATA: ${stockData.__error}`
            });

            return {
              kode: row.kode,
              scanDate: row.scan_date,
              status: "RETRY_STOCK_DATA",
              error: stockData.__error
            };
          }

          if (!Array.isArray(stockData?.candles) || stockData.candles.length === 0) {
            await markCloseLabelRetry(row.id, {
              attempts: row.close_label_attempts,
              error: "Tidak ada daily candle dari sumber data."
            });

            return {
              kode: row.kode,
              scanDate: row.scan_date,
              status: "RETRY_NO_CANDLES"
            };
          }

          const nextCandle = findTradingDayCandleAfter(
            stockData.candles,
            row.scan_date
          );

          if (!nextCandle) {
            await markCloseLabelRetry(row.id, {
              attempts: row.close_label_attempts,
              error: `Candle trading H+1 belum ditemukan setelah ${row.scan_date}.`
            });

            return {
              kode: row.kode,
              scanDate: row.scan_date,
              status: "RETRY_NEXT_CANDLE_NOT_FOUND"
            };
          }

          const nextDate = String(nextCandle.date || "").slice(0, 10);

          if (!nextDate || nextDate <= row.scan_date) {
            await markCloseLabelRetry(row.id, {
              attempts: row.close_label_attempts,
              error: `Tanggal candle H+1 tidak valid: ${nextDate}`
            });

            return {
              kode: row.kode,
              scanDate: row.scan_date,
              status: "RETRY_INVALID_CANDLE_DATE"
            };
          }

          // Jika H+1 adalah hari ini, jangan melabel sebelum market close.
          if (nextDate === today && !isAfterMarketCloseWIB()) {
            return {
              kode: row.kode,
              scanDate: row.scan_date,
              nextDate,
              status: "WAIT_MARKET_CLOSE"
            };
          }

          const previousClose = finitePositive(row.close);
          const nextOpen = finitePositive(nextCandle.open);
          const nextHigh = finitePositive(nextCandle.high);
          const nextLow = finitePositive(nextCandle.low);
          const nextClose = finitePositive(nextCandle.close);

          if (!previousClose) throw new Error("INVALID_PREVIOUS_CLOSE");
          if (!nextOpen) throw new Error("INVALID_NEXT_OPEN");
          if (!nextHigh) throw new Error("INVALID_NEXT_HIGH");
          if (!nextLow) throw new Error("INVALID_NEXT_LOW");
          if (!nextClose) throw new Error("INVALID_NEXT_CLOSE");

          // ========================================================
          // TAHAP 1 + TAHAP 2 SEKALIGUS
          // ========================================================
          const nextDayReturnPct = pct(previousClose, nextOpen);
          const closeReturnPct = pct(previousClose, nextClose);
          const maxGainFromClosePct = pct(previousClose, nextHigh);
          const maxLossFromClosePct = pct(previousClose, nextLow);
          const maxGainFromOpenPct = pct(nextOpen, nextHigh);

          const gapUpRealized = nextDayReturnPct >= 2;
          const high3PctRealized = maxGainFromClosePct >= HIGH_TARGET_PCT;
          const close2PctRealized = closeReturnPct >= CLOSE_TARGET_PCT;
          const nextDaySuccess = high3PctRealized || close2PctRealized;

          const nowIso = new Date().toISOString();

          const patch = {
            // Tahap 1 — diisi juga jika cron pagi sebelumnya gagal.
            actual_next_open: nextOpen,
            next_day_return_pct: nextDayReturnPct,
            gap_up_realized: gapUpRealized,
            labeled_at: row.labeled_at || nowIso,

            // Tahap 2.
            actual_next_close: nextClose,
            actual_next_high: nextHigh,
            actual_next_low: nextLow,
            next_day_close_return_from_close_pct: closeReturnPct,
            next_day_max_gain_from_close_pct: maxGainFromClosePct,
            next_day_max_loss_from_close_pct: maxLossFromClosePct,
            max_gain_from_open_pct: maxGainFromOpenPct,
            next_day_high_3pct_realized: high3PctRealized,
            next_day_close_2pct_realized: close2PctRealized,
            next_day_success: nextDaySuccess,

            // Reliability state.
            close_label_status: "COMPLETE",
            close_label_last_error: null,
            close_label_next_retry_at: null,
            close_labeled_at: nowIso
          };

          // Peak hanya metadata. Untuk hari berjalan ZAPI bisa memberi
          // peak realtime. Untuk historis, sengaja tidak dipanggil agar
          // peak tidak menghambat outcome utama.
          if (nextDate === today && isAfterMarketCloseWIB()) {
            try {
              const peak = await getIntradayPeakTime(
                row.kode,
                nextDate,
                { range: "5d", interval: "15m" }
              );

              if (peak) {
                patch.peak_time_wib = peak.peakTimeWIB ?? null;
                patch.peak_high = Number.isFinite(Number(peak.peakHigh))
                  ? Number(peak.peakHigh)
                  : null;
                patch.peak_session_phase = peak.peakSessionPhase ?? null;
                patch.peak_source = peak.source ?? null;
              }
            } catch (peakError) {
              // Peak bukan alasan untuk menggagalkan labeling utama.
              console.warn(
                `Peak ${row.kode} ${nextDate} dilewati:`,
                peakError?.message || String(peakError)
              );
            }
          }

          await updateLabel(row.id, patch);

          return {
            kode: row.kode,
            scanDate: row.scan_date,
            nextDate,
            previousClose,
            nextOpen,
            nextHigh,
            nextLow,
            nextClose,
            nextDayReturnPct,
            closeReturnPct,
            maxGainFromClosePct,
            maxLossFromClosePct,
            maxGainFromOpenPct,
            nextDaySuccess,
            status: "OK"
          };
        } catch (error) {
          const message = error?.message || String(error);

          try {
            await markCloseLabelRetry(row.id, {
              attempts: row.close_label_attempts,
              error: message
            });
          } catch (retryError) {
            console.error(
              `Gagal mencatat retry ${row.kode}:`,
              retryError?.message || String(retryError)
            );
          }

          return {
            kode: row.kode,
            scanDate: row.scan_date,
            status: "RETRY_ERROR",
            error: message
          };
        }
      },
      CONCURRENCY
    );

    const ok = results.filter(r => r?.status === "OK");
    const retry = results.filter(r => r?.status?.startsWith("RETRY_"));
    const skipped = results.filter(r => r?.status === "SKIPPED_TIME_BUDGET");
    const waiting = results.filter(r => r?.status === "WAIT_MARKET_CLOSE");

    const successCount = ok.filter(r => r.nextDaySuccess).length;
    const high3PctCount = ok.filter(r => r.maxGainFromClosePct >= HIGH_TARGET_PCT).length;
    const close2PctCount = ok.filter(r => r.closeReturnPct >= CLOSE_TARGET_PCT).length;

    return res.status(200).json({
      success: true,
      scanDate: datesProcessed[0] ?? null,
      datesProcessed,
      totalPending: pending.length,
      rowsThisRun: rows.length,
      labeled: ok.length,
      retry: retry.length,
      skippedTimeBudget: skipped.length,
      waitingMarketClose: waiting.length,
      successCount,
      high3PctCount,
      close2PctCount,
      uniqueCodesFetched: stockCache.size,
      elapsedMs: Date.now() - startedAt,
      retryDetail: retry.slice(0, 20),
      examples: ok.slice(0, 10),
      remainingHint:
        skipped.length > 0 || retry.length > 0 || pending.length >= MAX_ROWS_PER_RUN
          ? "Masih ada row pending/retry. Cron berikutnya akan melanjutkan otomatis."
          : "Batch due selesai diproses."
    });
  } catch (error) {
    console.error("Label outcomes close error:", error);

    return res.status(500).json({
      success: false,
      message: "Close labeling gagal.",
      error: error?.message || String(error),
      elapsedMs: Date.now() - startedAt
    });
  }
}
