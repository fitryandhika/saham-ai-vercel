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

import { getUnlabeledSnapshots, updateLabel, getOldestUnlabeledDate } from "../services/dataLogService.js";
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

// Dulu pakai "hari kalender - 1" (lihat git history). Bug: cron cuma
// jalan Senin-Jumat, jadi cron Senin pagi menghitung "kemarin" =
// Minggu (tidak ada scan-nya) — bukan Jumat, yang scan-nya justru
// belum dilabel. Akibatnya snapshot Jumat kelewat permanen, tidak
// pernah dicoba lagi oleh cron manapun. Diganti: selalu ambil
// scan_date PALING LAMA yang masih belum dilabel, supaya backlog
// otomatis terkejar tiap kali cron jalan, apapun urutan hari liburnya.
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
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

    const thresholdPct = req.query.threshold
      ? parseFloat(req.query.threshold)
      : DEFAULT_THRESHOLD_PCT;

    // ?date= tetap didukung buat re-run manual satu tanggal tertentu.
    // Default: kejar backlog dari scan_date belum dilabel yang paling lama.
    const scanDate = req.query.date || (await getOldestUnlabeledDate());

    if (!scanDate) {
      return res.status(200).json({
        success: true,
        scanDate: null,
        message: "Tidak ada snapshot yang perlu dilabel — semua sudah dilabel.",
        labeled: 0
      });
    }

    // Jangan label snapshot hari ini pakai data hari ini juga — open
    // besok belum ada. Ini cuma bisa kejadian kalau scan_date tertua
    // yang belum dilabel kebetulan sama dengan hari ini (mis. run
    // pertama kali setelah scan pagi ini, belum ada histori lain).
    if (scanDate === todayUTC()) {
      return res.status(200).json({
        success: true,
        scanDate,
        message: "Snapshot tertua yang belum dilabel adalah scan hari ini — tunggu sampai besok (perlu harga open besok).",
        labeled: 0
      });
    }

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
        // high/low candle harian SUDAH tersedia dari stockService.js (Yahoo
        // Finance ngasih OHLC lengkap per hari), tapi sebelumnya dibuang —
        // cuma open & close yang dipakai. Sekarang disimpan juga supaya bisa
        // dianalisa "seberapa tinggi harga bisa naik hari itu" (relevan untuk
        // strategi beli sore/jual pagi: kalau jual pas di titik tertinggi,
        // bukan cuma di harga close).
        const nextHigh = todayCandle.high;
        const nextLow = todayCandle.low;

        const nextDayReturnPct = Number(
          (((nextOpen - row.close) / row.close) * 100).toFixed(2)
        );

        // Potensi gain maksimal HARI ITU dihitung dari open (bukan dari
        // harga beli kemarin sore), karena open pagi = harga jual real
        // paling awal yang bisa dieksekusi sesuai strategi jual pagi.
        const maxGainFromOpenPct = Number(
          (((nextHigh - nextOpen) / nextOpen) * 100).toFixed(2)
        );

        const gapUpRealized = nextDayReturnPct >= thresholdPct;

        await updateLabel(row.id, {
          actual_next_open: nextOpen,
          actual_next_close: nextClose,
          actual_next_high: nextHigh,
          actual_next_low: nextLow,
          max_gain_from_open_pct: maxGainFromOpenPct,
          next_day_return_pct: nextDayReturnPct,
          gap_up_realized: gapUpRealized,
          labeled_at: new Date().toISOString()
        });

        return { kode: row.kode, nextDayReturnPct, maxGainFromOpenPct, gapUpRealized };
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
