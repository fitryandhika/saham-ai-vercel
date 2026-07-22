// ==========================
// Relabel High/Low — isi ulang actual_next_high/low untuk data LAMA
// ==========================
//
// Dipakai SEKALI (atau beberapa kali sampai backlog habis) setelah kolom
// actual_next_high, actual_next_low, max_gain_from_open_pct ditambahkan ke
// tabel scan_history. Baris yang sudah dilabel SEBELUM kolom ini ada tidak
// otomatis terisi — endpoint ini yang menyusulinya secara retroaktif.
//
// Beda dengan api/label-outcomes.js (yang ambil "candle paling baru" karena
// dijalankan sehari setelah scan): di sini kita perlu candle di TANGGAL
// SPESIFIK di masa lalu, jadi harus dicari dari histori harga, bukan cuma
// ambil elemen terakhir.
//
// Cara pakai:
//   GET /api/relabel-high-low                -> proses 15 emiten pertama yang masih kurang
//   GET /api/relabel-high-low?maxKode=30      -> proses lebih banyak sekaligus
//   GET /api/relabel-high-low?kode=BBCA       -> proses SATU emiten tertentu saja
//
// Jalankan berkali-kali (refresh / panggil ulang) sampai response
// "remainingKode: 0" — satu kali panggil sengaja dibatasi jumlah emiten
// (bukan jumlah baris) supaya tidak timeout, karena tiap emiten perlu 1x
// fetch ke Yahoo Finance yang makan waktu beberapa ratus ms.

import { getRowsMissingHighLow, updateLabel } from "../services/dataLogService.js";
import { getStockData } from "../services/stockService.js";

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 6; // lebih rendah dari label-outcomes.js (12) karena range=1y lebih berat

// Toleransi selisih harga open saat mencocokkan candle histori dengan
// actual_next_open yang sudah tersimpan — untuk mendeteksi kalau ternyata
// candle yang ketemu SALAH tanggal (misal ada libur bursa/kesalahan data),
// bukan cuma pembulatan desimal biasa.
const OPEN_MATCH_TOLERANCE = 1;

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

// Cari candle histori pertama yang tanggalnya SETELAH scan_date — itulah
// hari berikutnya secara perdagangan (sudah otomatis lompat weekend/libur
// karena candle memang cuma ada di hari bursa buka).
function findNextTradingDayCandle(candles, scanDate) {
  for (const c of candles) {
    if (c.date.slice(0, 10) > scanDate) {
      return c;
    }
  }
  return null;
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

    const singleKode = req.query.kode ? req.query.kode.toUpperCase() : null;
    const maxKode = req.query.maxKode ? parseInt(req.query.maxKode, 10) : 15;

    const rows = await getRowsMissingHighLow({ limit: 5000 });

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Tidak ada baris lama yang perlu di-relabel — semua sudah punya high/low.",
        remainingRows: 0,
        remainingKode: 0
      });
    }

    // Kelompokkan per kode supaya 1x fetch candle history dipakai untuk
    // semua baris emiten itu (bisa puluhan baris per kode).
    const byKode = {};
    for (const r of rows) {
      (byKode[r.kode] ||= []).push(r);
    }

    const allKodes = Object.keys(byKode);
    const kodesToProcess = singleKode
      ? allKodes.filter((k) => k === singleKode)
      : allKodes.slice(0, maxKode);

    if (kodesToProcess.length === 0) {
      return res.status(200).json({
        success: true,
        message: singleKode
          ? `Kode ${singleKode} tidak ada di antrean relabel (mungkin sudah selesai atau tidak ada baris belum dilabel).`
          : "Tidak ada kode untuk diproses.",
        remainingRows: rows.length,
        remainingKode: allKodes.length
      });
    }

    const results = await runPool(
      kodesToProcess,
      async (kode) => {
        // range=1y supaya cukup jauh ke belakang untuk data lama; kalau
        // proyek sudah jalan lebih dari setahun, ganti ke "2y" di sini.
        const stockData = await getStockData(kode, "1y");
        const candles = stockData.candles; // sudah urut naik berdasarkan tanggal

        const kodeRows = byKode[kode];
        let labeled = 0;
        let mismatched = 0;
        let notFound = 0;

        for (const row of kodeRows) {
          const candle = findNextTradingDayCandle(candles, row.scan_date);

          if (!candle) {
            notFound++;
            continue;
          }

          // Sanity check: open candle yang ketemu harus cocok dengan
          // actual_next_open yang sudah tersimpan dari labeling sebelumnya.
          // Kalau selisihnya besar, kemungkinan salah tanggal (jangan
          // dipaksa update — lebih baik dilewati & dilaporkan).
          if (
            row.actual_next_open != null &&
            Math.abs(candle.open - row.actual_next_open) > OPEN_MATCH_TOLERANCE
          ) {
            mismatched++;
            continue;
          }

          const maxGainFromOpenPct = Number(
            (((candle.high - candle.open) / candle.open) * 100).toFixed(2)
          );

          await updateLabel(row.id, {
            actual_next_high: candle.high,
            actual_next_low: candle.low,
            max_gain_from_open_pct: maxGainFromOpenPct
          });

          labeled++;
        }

        return { kode, totalRows: kodeRows.length, labeled, mismatched, notFound };
      },
      CONCURRENCY
    );

    const ok = results.filter((r) => r && !r.error);
    const failed = results
      .map((r, i) => (r && r.error ? { kode: kodesToProcess[i], error: r.error } : null))
      .filter(Boolean);

    const totalLabeled = ok.reduce((sum, r) => sum + r.labeled, 0);
    const totalMismatched = ok.reduce((sum, r) => sum + r.mismatched, 0);
    const totalNotFound = ok.reduce((sum, r) => sum + r.notFound, 0);

    const remainingKode = allKodes.length - kodesToProcess.length;
    const remainingRows = rows.length - totalLabeled - totalMismatched - totalNotFound;

    return res.status(200).json({
      success: true,
      processedKode: kodesToProcess.length,
      totalLabeled,
      totalMismatched, // baris yang dilewati karena open tidak cocok — cek manual
      totalNotFound,   // baris yang dilewati karena tidak ketemu candle setelah scan_date
      remainingKode,   // kalau > 0, panggil ulang endpoint ini lagi (atau naikkan ?maxKode=)
      remainingRows,
      failed,
      detail: ok
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Relabel high/low gagal.",
      error: error.message
    });
  }
}
