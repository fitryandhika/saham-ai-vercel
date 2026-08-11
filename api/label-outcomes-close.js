// ==========================
// Label Outcomes — TAHAP 1: OPEN H+1
// ==========================
//
// Tujuan:
// Melabeli snapshot H menggunakan harga OPEN pada hari trading berikutnya.
//
// Contoh:
// scan_date  : 2026-08-10
// close H    : 198
// trading day berikutnya: 2026-08-11
// open H+1   : 194
//
// IMPORTANT:
// Jangan menggunakan candles.at(-1) karena candle terakhir dari data provider
// belum tentu merupakan candle H+1 yang kita cari.
//
// Kita wajib mencari candle trading pertama SETELAH scan_date.
//
// TAHAP 1:
//   actual_next_open
//   next_day_return_pct
//   gap_up_realized
//
// TAHAP 2:
//   api/label-outcomes-close.js
//   mengisi close/high/low/max gain dan success setelah market tutup.
//

import {
  getUnlabeledSnapshots,
  updateLabel,
  getOldestUnlabeledDate
} from "../services/dataLogService.js";

import {
  getStockData,
  findTradingDayCandleAfter
} from "../services/stockService.js";

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 12;
const DEFAULT_THRESHOLD_PCT = 2;

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
          error: e?.message || String(e)
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      next
    )
  );

  return results;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  try {
    // ============================================================
    // SECURITY
    // ============================================================

    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization;

      if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized."
        });
      }
    }

    // ============================================================
    // THRESHOLD
    // ============================================================

    const thresholdPct =
      req.query.threshold != null
        ? parseFloat(req.query.threshold)
        : DEFAULT_THRESHOLD_PCT;

    if (!Number.isFinite(thresholdPct)) {
      return res.status(400).json({
        success: false,
        message: "Parameter threshold tidak valid."
      });
    }

    // ============================================================
    // TENTUKAN SCAN DATE
    // ============================================================
    //
    // ?date=2026-08-10
    // bisa digunakan untuk re-run tanggal tertentu.
    //
    // Kalau tidak diberikan:
    // ambil tanggal paling lama yang belum dilabel.
    //

    const scanDate =
      req.query.date ||
      (await getOldestUnlabeledDate());

    if (!scanDate) {
      return res.status(200).json({
        success: true,
        scanDate: null,
        message:
          "Tidak ada snapshot yang perlu dilabel — semua sudah dilabel.",
        labeled: 0
      });
    }

    // ============================================================
    // JANGAN LABEL HARI INI
    // ============================================================

    if (scanDate === todayUTC()) {
      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Snapshot adalah scan hari ini. Tunggu sampai tersedia candle trading berikutnya.",
        labeled: 0
      });
    }

    // ============================================================
    // AMBIL SNAPSHOT YANG BELUM DILABEL
    // ============================================================

    const pending =
      await getUnlabeledSnapshots(scanDate);

    if (pending.length === 0) {
      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Tidak ada snapshot yang perlu dilabel pada tanggal ini.",
        labeled: 0
      });
    }

    // ============================================================
    // LABEL SETIAP SAHAM
    // ============================================================

    const results = await runPool(
      pending,
      async (row) => {

        // ========================================================
        // PENTING:
        // Gunakan range yang cukup panjang supaya backlog hari
        // libur/weekend tetap bisa menemukan candle trading berikutnya.
        // ========================================================

        const stockData =
          await getStockData(row.kode, "3mo");

        if (
          !stockData ||
          !Array.isArray(stockData.candles) ||
          stockData.candles.length === 0
        ) {
          return {
            kode: row.kode,
            status: "NO_DATA"
          };
        }

        // ========================================================
        // CARI CANDLE TRADING PERTAMA SETELAH SCAN DATE
        // ========================================================
        //
        // CONTOH:
        //
        // scan_date = 2026-08-10
        //
        // candles:
        // 2026-08-08
        // 2026-08-09
        // 2026-08-10
        // 2026-08-11  <-- YANG DICARI
        //
        // Tidak lagi memakai candles.at(-1).
        // ========================================================

        const nextCandle =
          findTradingDayCandleAfter(
            stockData.candles,
            row.scan_date
          );

        if (!nextCandle) {
          return {
            kode: row.kode,
            status: "NEXT_CANDLE_NOT_FOUND",
            scanDate: row.scan_date
          };
        }

        // ========================================================
        // VALIDASI DATA CANDLE
        // ========================================================

        const nextDate =
          nextCandle.date?.slice(0, 10);

        const nextOpen =
          Number(nextCandle.open);

        const previousClose =
          Number(row.close);

        if (
          !Number.isFinite(nextOpen) ||
          nextOpen <= 0
        ) {
          return {
            kode: row.kode,
            status: "INVALID_NEXT_OPEN",
            nextDate,
            nextOpen: nextCandle.open
          };
        }

        if (
          !Number.isFinite(previousClose) ||
          previousClose <= 0
        ) {
          return {
            kode: row.kode,
            status: "INVALID_PREVIOUS_CLOSE",
            previousClose: row.close
          };
        }

        // ========================================================
        // PASTIKAN CANDLE BENAR-BENAR H+1
        // ========================================================

        if (!nextDate || nextDate <= row.scan_date) {
          return {
            kode: row.kode,
            status: "INVALID_CANDLE_DATE",
            scanDate: row.scan_date,
            foundDate: nextDate
          };
        }

        // ========================================================
        // HITUNG RETURN OPEN H+1 VS CLOSE H
        // ========================================================

        const nextDayReturnPct = Number(
          (
            ((nextOpen - previousClose) /
              previousClose) *
            100
          ).toFixed(2)
        );

        // ========================================================
        // GAP UP REALIZED
        // ========================================================

        const gapUpRealized =
          nextDayReturnPct >= thresholdPct;

        // ========================================================
        // SIMPAN LABEL
        // ========================================================

        await updateLabel(row.id, {

          actual_next_open: nextOpen,

          next_day_return_pct:
            nextDayReturnPct,

          gap_up_realized:
            gapUpRealized,

          labeled_at:
            new Date().toISOString()

        });

        return {
          kode: row.kode,
          scanDate: row.scan_date,
          nextDate,

          previousClose,

          nextOpen,

          nextDayReturnPct,

          gapUpRealized,

          status: "OK"
        };
      },
      CONCURRENCY
    );

    // ============================================================
    // HASIL
    // ============================================================

    const ok =
      results.filter(
        (r) =>
          r &&
          r.status === "OK"
      );

    const failed =
      results
        .map((r, i) => {

          if (
            r &&
            r.status !== "OK"
          ) {
            return {
              kode: pending[i].kode,
              status: r.status,
              detail: r
            };
          }

          if (r?.error) {
            return {
              kode: pending[i].kode,
              status: "ERROR",
              error: r.error
            };
          }

          return null;

        })
        .filter(Boolean);

    const gapUpCount =
      ok.filter(
        (r) => r.gapUpRealized
      ).length;

    // ============================================================
    // RESPONSE
    // ============================================================

    return res.status(200).json({

      success: true,

      scanDate,

      thresholdPct,

      totalPending:
        pending.length,

      labeled:
        ok.length,

      failed:
        failed.length,

      gapUpCount,

      failedDetail:
        failed.slice(0, 20),

      examples:
        ok.slice(0, 10)

    });

  } catch (error) {

    console.error(
      "Label outcomes error:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Labeling gagal.",

      error:
        error?.message ||
        String(error)

    });
  }
}