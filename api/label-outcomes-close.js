// ==========================
// Label Outcomes — TAHAP 2: close, high, low, & jam puncak (SETELAH tutup)
// ==========================
//
// Pasangan dari api/label-outcomes.js (tahap 1, open-only, jalan pagi).
// File ini HARUS jalan SETELAH bursa tutup (dijadwalkan ~16:00 WIB di
// vercel.json) supaya candle harian yang diambil sudah final — bukan
// candle yang baru separuh jalan seperti kalau diambil pagi.
//
// Target baris: yang sudah dilabel TAHAP 1 (labeled_at terisi) tapi
// belum dilabel TAHAP 2 (close_labeled_at masih null). Dengan begitu,
// backlog (mis. cron sempat gagal beberapa hari) otomatis kekejar —
// sama seperti pola getOldestUnlabeledDate() di tahap 1.
//
// Cara cari candle T+1: dipakai findTradingDayCandleAfter() yang sama
// dengan yang dipakai api/relabel-high-low.js — mencari candle harian
// pertama SETELAH scan_date, bukan asumsi "candle terakhir" (yang cuma
// benar kalau baris ini bukan backlog lama). Robust untuk kedua kasus:
// dilabel hari yang sama atau backlog beberapa hari ke belakang.

import { getPendingCloseSnapshots, getOldestOpenLabeledDate, updateLabel, getLabeledRowsForStats } from "../services/dataLogService.js";
import { getStockData, getIntradayPeakTime, findTradingDayCandleAfter } from "../services/stockService.js";
import { computeGapCalibration } from "../engine/gapCalibration.js";
import { saveGapCalibration } from "../services/gapCalibrationService.js";

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 12;

// Sanity check sama seperti relabel-high-low.js: candle T+1 yang
// ditemukan harus open-nya cocok dengan actual_next_open yang sudah
// tersimpan dari tahap 1 — kalau selisihnya besar, kemungkinan salah
// tanggal (data Yahoo yang aneh/libur tak terduga), lebih baik dilewati
// & dilaporkan daripada dipaksa update dengan data yang salah.
const OPEN_MATCH_TOLERANCE_PCT = 3;

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
    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${process.env.CRON_SECRET}` && !req.query.manual) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Tambahkan ?manual=1 kalau menjalankan manual dari browser."
        });
      }
    }

    const scanDate = req.query.date || (await getOldestOpenLabeledDate());

    if (!scanDate) {
      return res.status(200).json({
        success: true,
        scanDate: null,
        message: "Tidak ada snapshot yang menunggu label tahap 2 (close) — semua sudah lengkap.",
        labeled: 0
      });
    }

    const pending = await getPendingCloseSnapshots(scanDate);

    if (pending.length === 0) {
      return res.status(200).json({
        success: true,
        scanDate,
        message: "Tidak ada baris yang perlu dilabel close di tanggal ini.",
        labeled: 0
      });
    }

    const results = await runPool(
      pending,
      async (row) => {
        // range 3mo cukup untuk backlog wajar; kalau backlog lebih dari
        // itu, findTradingDayCandleAfter tidak akan ketemu (notFound),
        // sama seperti pola aman di relabel-high-low.js.
        const stockData = await getStockData(row.kode, "3mo");
        const candle = findTradingDayCandleAfter(stockData.candles, row.scan_date);

        if (!candle) {
          return { kode: row.kode, status: "NOT_FOUND" };
        }

        const candleDate = candle.date.slice(0, 10);

        if (
          row.actual_next_open != null &&
          Math.abs(candle.open - row.actual_next_open) / row.actual_next_open * 100 > OPEN_MATCH_TOLERANCE_PCT
        ) {
          return {
            kode: row.kode,
            status: "MISMATCHED",
            expectedOpen: row.actual_next_open,
            foundOpen: candle.open,
            foundDate: candleDate
          };
        }

        const nextClose = candle.close;
        const nextHigh = candle.high;
        const nextLow = candle.low;
        const refOpen = row.actual_next_open ?? candle.open;

        const maxGainFromOpenPct = Number(
          (((nextHigh - refOpen) / refOpen) * 100).toFixed(2)
        );

        // ============================================================
        // V2 TARGET — khusus strategi beli sore
        // Reference price = CLOSE H (row.close), BUKAN OPEN H+1.
        //
        // maxGainFromClosePct:
        //   peluang terbaik menjual kapan pun pada H+1 dibanding harga
        //   close H. Ini menangkap kenaikan sesi 1 maupun sesi 2.
        //
        // closeReturnFromClosePct:
        //   hasil jika posisi tetap ditahan sampai close H+1.
        //
        // "success" V2:
        //   max gain >= 3% ATAU close H+1 >= +2%.
        // Ambang ini dibuat eksplisit dan tersimpan supaya nanti dapat
        // dikalibrasi ulang tanpa mengubah arti kolom lama.
        // ============================================================
        const refClose = Number(row.close);

        const nextDayCloseReturnFromClosePct =
          Number.isFinite(refClose) && refClose > 0
            ? Number((((nextClose - refClose) / refClose) * 100).toFixed(2))
            : null;

        const nextDayMaxGainFromClosePct =
          Number.isFinite(refClose) && refClose > 0
            ? Number((((nextHigh - refClose) / refClose) * 100).toFixed(2))
            : null;

        const nextDayMaxLossFromClosePct =
          Number.isFinite(refClose) && refClose > 0
            ? Number((((nextLow - refClose) / refClose) * 100).toFixed(2))
            : null;

        const nextDayHigh3PctRealized =
          nextDayMaxGainFromClosePct !== null &&
          nextDayMaxGainFromClosePct >= 3;

        const nextDayClose2PctRealized =
          nextDayCloseReturnFromClosePct !== null &&
          nextDayCloseReturnFromClosePct >= 2;

        const nextDaySuccess =
          nextDayHigh3PctRealized ||
          nextDayClose2PctRealized;

        // Peak time: best-effort, cuma tersedia kalau Yahoo masih punya
        // data intraday untuk tanggal itu (biasanya <= ~60 hari). Kalau
        // tidak ketemu (null), tetap lanjut label close/high/low seperti
        // biasa — peak_time_wib/peak_session_phase cuma dibiarkan kosong.
        const peak = await getIntradayPeakTime(row.kode, candleDate);

        await updateLabel(row.id, {
          actual_next_close: nextClose,
          actual_next_high: nextHigh,
          actual_next_low: nextLow,
          max_gain_from_open_pct: maxGainFromOpenPct,

          // V2 — target dari CLOSE H
          next_day_close_return_from_close_pct:
            nextDayCloseReturnFromClosePct,
          next_day_max_gain_from_close_pct:
            nextDayMaxGainFromClosePct,
          next_day_max_loss_from_close_pct:
            nextDayMaxLossFromClosePct,
          next_day_high_3pct_realized:
            nextDayHigh3PctRealized,
          next_day_close_2pct_realized:
            nextDayClose2PctRealized,
          next_day_success:
            nextDaySuccess,

          peak_time_wib: peak?.peakTimeWIB ?? null,
          peak_session_phase: peak?.peakSessionPhase ?? null,
          close_labeled_at: new Date().toISOString()
        });

        return {
          kode: row.kode,
          status: "OK",
          maxGainFromOpenPct,
          nextDayCloseReturnFromClosePct,
          nextDayMaxGainFromClosePct,
          nextDayMaxLossFromClosePct,
          nextDaySuccess,
          peakTimeWIB: peak?.peakTimeWIB ?? null,
          peakSessionPhase: peak?.peakSessionPhase ?? null
        };
      },
      CONCURRENCY
    );

    const ok = results.filter((r) => r && !r.error);
    const failed = results
      .map((r, i) => (r && r.error ? { kode: pending[i].kode, error: r.error } : null))
      .filter(Boolean);

    const labeled = ok.filter((r) => r.status === "OK").length;
    const mismatched = ok.filter((r) => r.status === "MISMATCHED");
    const notFound = ok.filter((r) => r.status === "NOT_FOUND").length;
    const peakTimeFound = ok.filter((r) => r.status === "OK" && r.peakTimeWIB).length;

    // ==========================
    // Recompute Gap Calibration (2 Agustus 2026) — best-effort, TIDAK
    // boleh menggagalkan response labeling tahap 2 kalau gagal. Dijalankan
    // di sini (bukan endpoint cron terpisah) supaya tidak nambah jumlah
    // serverless function (Vercel Hobby plan mentok 12, sudah pernah
    // kejadian sebelumnya) — dan karena titik ini pas: label harian baru
    // saja selesai, jadi tabel gap_calibration dihitung dari data
    // paling baru begitu tersedia.
    // ==========================
    let gapCalibration = { recomputed: false };

    try {
      const rows = await getLabeledRowsForStats({});
      const table = computeGapCalibration(rows);
      const saveResult = await saveGapCalibration(table);

      gapCalibration = {
        recomputed: true,
        buckets: table.length,
        totalLabeledRows: rows.length,
        ...saveResult
      };
    } catch (e) {
      console.error("Recompute gap calibration gagal:", e.message);
      gapCalibration = { recomputed: false, error: e.message };
    }

    return res.status(200).json({
      success: true,
      scanDate,
      totalPending: pending.length,
      labeled,
      mismatched: mismatched.length,
      mismatchExamples: mismatched.slice(0, 3),
      notFound, // kemungkinan besar butuh api/relabel-high-low.js kalau backlog kelewat jauh
      peakTimeFound, // dari yang berhasil dilabel, berapa yang juga dapat jam puncaknya
      failed: failed.length,
      failedDetail: failed,
      gapCalibration
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Labeling tahap 2 (close) gagal.",
      error: error.message,
      stack: error.stack
    });
  }
}
