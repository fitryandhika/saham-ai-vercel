// ==========================
// Label Outcomes — TAHAP 1: open pagi ini (gap vs snapshot kemarin)
// ==========================
//
// Dijalankan besok pagi (lewat cron di vercel.json, atau manual) untuk
// melabeli snapshot KEMARIN dengan harga OPEN hari ini. Tanpa ini,
// scan_history cuma berisi fitur tanpa label — tidak bisa dipakai
// training model apa pun.
//
// Definisi label: gap_up_realized = true kalau open hari ini >= +2%
// dari close snapshot kemarin (ambang bisa diubah lewat ?threshold=).
// Ini definisi yang harus KONSISTEN dari waktu ke waktu — jangan
// diubah setelah mulai training, atau dataset jadi tidak sebanding
// lintas periode.
//
// PENTING:
// File ini hanya mengisi OPEN H+1.
// Close/high/low tetap ditangani oleh:
//   api/label-outcomes-close.js
//
// PERBAIKAN:
// Jangan lagi memakai candles.at(-1) secara membabi buta.
// Untuk backlog seperti:
//
//   2026-08-10 -> harus mencari candle 2026-08-11
//
// kita memilih candle perdagangan PERTAMA setelah scan_date.
// Ini juga otomatis melewati Sabtu/Minggu/libur bursa.
//

import {
  getUnlabeledSnapshots,
  updateLabel,
  getOldestUnlabeledDate
} from "../services/dataLogService.js";

import { getStockData } from "../services/stockService.js";

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
      {
        length: Math.min(concurrency, items.length)
      },
      next
    )
  );

  return results;
}


// ============================================================
// Helper: tanggal UTC YYYY-MM-DD
// ============================================================

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}


// ============================================================
// Helper: normalisasi tanggal candle
//
// Mendukung beberapa kemungkinan format:
//   "2026-08-11"
//   "2026-08-11T00:00:00.000Z"
//   Date object
//   timestamp detik
//   timestamp milidetik
// ============================================================

function toDateOnly(value) {
  if (value == null) {
    return null;
  }

  // String
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);

    if (match) {
      return match[1];
    }

    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    return null;
  }

  // Date object
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }

    return null;
  }

  // Unix timestamp
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds =
      value < 1e12
        ? value * 1000
        : value;

    const parsed = new Date(milliseconds);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return null;
}


// ============================================================
// Helper: ambil tanggal candle dari berbagai kemungkinan field
// ============================================================

function getCandleDate(candle) {
  if (!candle || typeof candle !== "object") {
    return null;
  }

  return toDateOnly(
    candle.date ??
    candle.datetime ??
    candle.timestamp ??
    candle.time ??
    candle.day
  );
}


// ============================================================
// Handler
// ============================================================

export default async function handler(req, res) {
  try {

    // ========================================================
    // Authorization
    // ========================================================

    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization;

      if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized."
        });
      }
    }


    // ========================================================
    // Threshold
    // ========================================================

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


    // ========================================================
    // Tentukan snapshot H
    //
    // ?date= tetap didukung.
    // Jika tidak ada date, ambil backlog tertua.
    // ========================================================

    const scanDate =
      req.query.date ||
      (await getOldestUnlabeledDate());


    // ========================================================
    // Tidak ada snapshot
    // ========================================================

    if (!scanDate) {
      return res.status(200).json({
        success: true,
        scanDate: null,
        message:
          "Tidak ada snapshot yang perlu dilabel — semua sudah dilabel.",
        labeled: 0
      });
    }


    // ========================================================
    // Jangan label hari ini menggunakan data hari ini
    // ========================================================

    if (scanDate === todayUTC()) {
      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Snapshot tertua yang belum dilabel adalah scan hari ini — tunggu sampai besok (perlu harga open besok).",
        labeled: 0
      });
    }


    // ========================================================
    // Ambil snapshot yang belum dilabel
    // ========================================================

    const pending =
      await getUnlabeledSnapshots(scanDate);


    if (pending.length === 0) {
      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Tidak ada snapshot yang perlu dilabel (sudah dilabel semua, atau belum ada scan di tanggal ini).",
        labeled: 0
      });
    }


    // ========================================================
    // Label setiap saham
    // ========================================================

    const results = await runPool(
      pending,

      async (row) => {

        const stockData =
          await getStockData(row.kode);


        // ====================================================
        // Validasi data candle
        // ====================================================

        const candles =
          Array.isArray(stockData?.candles)
            ? stockData.candles
            : [];


        if (candles.length === 0) {
          throw new Error(
            `Tidak ada candle tersedia untuk ${row.kode}.`
          );
        }


        // ====================================================
        // Cari candle perdagangan pertama SETELAH scan_date
        //
        // Contoh:
        //
        // H:
        // 2026-08-10
        //
        // candle tersedia:
        // 2026-08-10
        // 2026-08-11
        // 2026-08-12
        //
        // yang dipilih:
        // 2026-08-11
        //
        // Kalau Jumat:
        // 2026-08-07
        // -> 2026-08-10 Senin
        // ====================================================

        const datedCandles = candles
          .map((candle) => ({
            candle,
            date: getCandleDate(candle)
          }))
          .filter(
            (item) =>
              item.date &&
              item.date > scanDate
          )
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date)
          );


        const nextDayItem =
          datedCandles[0];


        // ====================================================
        // H+1 belum tersedia
        //
        // Jangan pakai candle terakhir.
        // Jangan melabel dengan data yang salah.
        // ====================================================

        if (!nextDayItem) {
          throw new Error(
            `C