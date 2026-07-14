// ==========================
// Label Outcomes — isi hasil aktual keesokan harinya
// ==========================
//
// Dijalankan besok pagi (lewat cron di vercel.json, atau manual) untuk
// melabeli snapshot KEMARIN dengan harga open/close HARI INI. Tanpa ini,
// scan_history cuma berisi fitur tanpa label — tidak bisa dipakai
// training model apa pun.
//
// Definisi label: gap_up_realized = true kalau open hari ini >= +2%
// dari close snapshot kemarin (ambang bisa diubah lewat ?threshold=).
// Ini definisi yang harus KONSISTEN dari waktu ke waktu — jangan
// diubah setelah mulai training, atau dataset jadi tidak sebanding
// lintas periode.

import { getUnlabeledSnapshots, updateLabel } from "../services/dataLogService.js";
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
        results[i] = { error: e.message };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, next)
  );

  return results;
}

function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  try {
    // Vercel otomatis set CRON_SECRET & mengirim header ini saat cron
    // yang memanggil. Kalau CRON_SECRET sudah di-set di env tapi
    // request datang tanpa header yang cocok, kemungkinan besar bukan
    // dari cron — tolak supaya endpoint ini tidak dipicu publik.
    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }
    }

    const scanDate = req.query.date || yesterday();
    const thresholdPct = req.query.threshold
      ? parseFloat(req.query.threshold)
      : DEFAULT_THRESHOLD_PCT;

    const pending = await getUnlabeledSnapshots(scanDate);

    if (pending.length === 0) {
      return res.status(200).json({
        success: true,
        scanDate,
        message: "Tidak ada snapshot yang perlu dilabel (sudah dilabel semua, atau belum ada scan di tanggal ini).",
        labeled: 0
      });
    }

    const results = await runPool(
      pending,
      async (row) => {
        const stockData = await getStockData(row.kode);

        // Candle paling baru sekarang seharusnya candle hari ini
        // (setelah scan kemarin dijalankan pasca-market-close).
        const todayCandle = stockData.candles.at(-1);

        const nextOpen = todayCandle.open;
        const nextClose = todayCandle.close;

        const nextDayReturnPct = Number(
          (((nextOpen - row.close) / row.close) * 100).toFixed(2)
        );

        const gapUpRealized = nextDayReturnPct >= thresholdPct;

        await updateLabel(row.id, {
          actual_next_open: nextOpen,
          actual_next_close: nextClose,
          next_day_return_pct: nextDayReturnPct,
          gap_up_realized: gapUpRealized,
          labeled_at: new Date().toISOString()
        });

        return { kode: row.kode, nextDayReturnPct, gapUpRealized };
      },
      CONCURRENCY
    );

    const ok = results.filter((r) => r && !r.error);
    const failed = results
      .map((r, i) => (r && r.error ? pending[i].kode : null))
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      scanDate,
      thresholdPct,
      labeled: ok.length,
      failed: failed.length,
      failedCodes: failed,
      gapUpCount: ok.filter((r) => r.gapUpRealized).length
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Labeling gagal.",
      error: error.message
    });
  }
}
