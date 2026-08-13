// ==========================
// Label Outcomes — TAHAP 1: OPEN H+1
// ==========================
//
// Melabeli snapshot H menggunakan OPEN pada hari trading berikutnya.
//
// Mengisi:
//   actual_next_open
//   next_day_return_pct
//   gap_up_realized
//   labeled_at
//
// Urutan sumber daily candle:
//   IDX Official + Yahoo melalui getStockData()
//
// IMPORTANT:
// Jangan menggunakan candles.at(-1).
// Selalu cari candle trading pertama SETELAH scan_date.

import {
  getUnlabeledSnapshots,
  updateLabel,
  getOldestUnlabeledDate
} from "../services/dataLogService.js";

import {
  getStockData,
  findTradingDayCandleAfter
} from "../services/stockService.js";

import { todayWIB } from "../config/tradingCalendar.js";

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 12;
const DEFAULT_THRESHOLD_PCT = 2;

// ============================================================
// GIVE UP THRESHOLD
// ============================================================
//
// BUG (ditemukan 14 Agustus 2026): getOldestUnlabeledDate() ambil SATU
// scan_date tertua yang punya gap_up_realized masih null, lalu HANYA
// tanggal itu yang diproses per panggilan. Kalau ada baris yang gagal
// permanen (kode delisting/suspend lama sehingga candle-nya tidak
// pernah muncul di Yahoo Finance), baris itu tidak pernah tertulis
// gap_up_realized-nya — jadi tanggal itu SELAMANYA jadi "tanggal
// tertua belum dilabel", dan cron macet di situ terus. Semua tanggal
// setelahnya (termasuk yang baru) numpuk di antrean tapi tidak pernah
// kesentuh sampai backlog lama ini dibereskan.
//
// FIX: kalau scan_date sudah lebih tua dari GIVE_UP_AFTER_DAYS hari
// kalender dan tetap gagal (NO_DATA / NEXT_CANDLE_NOT_FOUND / dst),
// tulis label "menyerah" (gap_up_realized = false, actual_next_open
// tetap null) supaya baris itu keluar dari antrean dan tidak
// menyumbat tanggal-tanggal baru selamanya.
const GIVE_UP_AFTER_DAYS = 10;

function daysSince(dateStr) {
  const then = new Date(dateStr + "T00:00:00Z").getTime();
  const now = new Date(todayWIB() + "T00:00:00Z").getTime();
  return Math.floor((now - then) / 86400000);
}

async function giveUpIfStale(row, status) {
  if (daysSince(row.scan_date) < GIVE_UP_AFTER_DAYS) {
    return false;
  }

  await updateLabel(row.id, {
    gap_up_realized: false,
    labeled_at: new Date().toISOString()
  });

  return true;
}

// ============================================================
// CONCURRENCY POOL
// ============================================================

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

// ============================================================
// HANDLER
// ============================================================

export default async function handler(req, res) {
  try {

    // ============================================================
    // SECURITY
    // ============================================================

    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization;

      if (auth !== `Bearer ${process.env.CRON_SECRET}` && !req.query.manual) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Tambahkan ?manual=1 kalau menjalankan manual dari browser."
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
    // SCAN DATE
    // ============================================================

    const scanDate =
      req.query.date ||
      await getOldestUnlabeledDate();

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
    // JANGAN LABEL SCAN HARI INI
    // ============================================================

    if (scanDate === todayWIB()) {
      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Snapshot adalah scan hari ini. Tunggu sampai tersedia candle trading berikutnya.",
        labeled: 0
      });
    }

    // ============================================================
    // AMBIL SNAPSHOT
    // ============================================================

    const pending =
      await getUnlabeledSnapshots(scanDate);

    if (!pending || pending.length === 0) {
      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Tidak ada snapshot yang perlu dilabel pada tanggal ini.",
        labeled: 0
      });
    }

    // ============================================================
    // LABEL
    // ============================================================

    const results = await runPool(
      pending,
      async (row) => {

        const stockData =
          await getStockData(row.kode, "3mo");

        if (
          !stockData ||
          !Array.isArray(stockData.candles) ||
          stockData.candles.length === 0
        ) {
          const gaveUp = await giveUpIfStale(row, "NO_DATA");
          return {
            kode: row.kode,
            status: gaveUp ? "GIVEN_UP_NO_DATA" : "NO_DATA"
          };
        }

        // ========================================================
        // CARI TRADING DAY PERTAMA SETELAH SCAN DATE
        // ========================================================

        const nextCandle =
          findTradingDayCandleAfter(
            stockData.candles,
            row.scan_date
          );

        if (!nextCandle) {
          const gaveUp = await giveUpIfStale(row, "NEXT_CANDLE_NOT_FOUND");
          return {
            kode: row.kode,
            status: gaveUp ? "GIVEN_UP_NEXT_CANDLE_NOT_FOUND" : "NEXT_CANDLE_NOT_FOUND",
            scanDate: row.scan_date
          };
        }

        // ========================================================
        // VALIDASI
        // ========================================================

        const nextDate =
          nextCandle.date?.slice(0, 10);

        const nextOpen =
          Number(nextCandle.open);

        const previousClose =
          Number(row.close);

        if (!nextDate || nextDate <= row.scan_date) {
          const gaveUp = await giveUpIfStale(row, "INVALID_CANDLE_DATE");
          return {
            kode: row.kode,
            status: gaveUp ? "GIVEN_UP_INVALID_CANDLE_DATE" : "INVALID_CANDLE_DATE",
            scanDate: row.scan_date,
            foundDate: nextDate
          };
        }

        if (
          !Number.isFinite(nextOpen) ||
          nextOpen <= 0
        ) {
          const gaveUp = await giveUpIfStale(row, "INVALID_NEXT_OPEN");
          return {
            kode: row.kode,
            status: gaveUp ? "GIVEN_UP_INVALID_NEXT_OPEN" : "INVALID_NEXT_OPEN",
            nextDate,
            nextOpen: nextCandle.open
          };
        }

        if (
          !Number.isFinite(previousClose) ||
          previousClose <= 0
        ) {
          const gaveUp = await giveUpIfStale(row, "INVALID_PREVIOUS_CLOSE");
          return {
            kode: row.kode,
            status: gaveUp ? "GIVEN_UP_INVALID_PREVIOUS_CLOSE" : "INVALID_PREVIOUS_CLOSE",
            previousClose: row.close
          };
        }

        // ========================================================
        // RETURN OPEN H+1 VS CLOSE H
        // ========================================================

        const nextDayReturnPct =
          Number(
            (
              ((nextOpen - previousClose) /
                previousClose) *
              100
            ).toFixed(2)
          );

        // ========================================================
        // GAP UP
        // ========================================================

        const gapUpRealized =
          nextDayReturnPct >= thresholdPct;

        // ========================================================
        // SIMPAN
        // ========================================================

        await updateLabel(row.id, {
          actual_next_open: nextOpen,
          next_day_return_pct: nextDayReturnPct,
          gap_up_realized: gapUpRealized,
          labeled_at: new Date().toISOString()
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
        r => r && r.status === "OK"
      );

    const failed =
      results
        .map((r, i) => {

          if (!r) {
            return {
              kode: pending[i].kode,
              status: "ERROR",
              error: "Worker tidak menghasilkan result."
            };
          }

          if (r.error) {
            return {
              kode: pending[i].kode,
              status: "ERROR",
              error: r.error
            };
          }

          if (r.status !== "OK") {
            return {
              kode: pending[i].kode,
              status: r.status,
              detail: r
            };
          }

          return null;
        })
        .filter(Boolean);

    const gapUpCount =
      ok.filter(
        r => r.gapUpRealized
      ).length;

    // ============================================================
    // RESPONSE
    // ============================================================

    return res.status(200).json({
      success: true,
      scanDate,
      thresholdPct,
      totalPending: pending.length,
      labeled: ok.length,
      failed: failed.length,
      gapUpCount,
      failedDetail: failed.slice(0, 20),
      examples: ok.slice(0, 10)
    });

  } catch (error) {

    console.error(
      "Label outcomes error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Labeling gagal.",
      error:
        error?.message ||
        String(error)
    });
  }
}