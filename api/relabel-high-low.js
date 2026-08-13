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
//
// UPDATE 7 Agustus 2026 — digabung dengan backfill session_gain_score
// (bukan file endpoint baru, supaya jumlah serverless function tidak
// nambah lagi dari 12 dan kena limit Vercel Hobby seperti insiden
// sebelumnya, lihat catatan di api/dashboard-data.js):
//   GET /api/relabel-high-low?target=session-gain          -> backfill session_gain_score 2000 baris pertama
//   GET /api/relabel-high-low?target=session-gain&limit=500 -> batasi jumlah per panggilan
// Mode ini TIDAK fetch Yahoo Finance sama sekali (semua input
// calculateSessionGainScore sudah ada di baris itu sendiri), jadi jauh
// lebih cepat dan terpisah total dari logic high/low di bawah — lihat
// handler target === "session-gain" di awal handler().

import { getRowsMissingHighLow, getRowsMissingSessionGain, updateLabel } from "../services/dataLogService.js";
import { getStockData, getIntradayPeakTime } from "../services/stockService.js";
import { calculateSessionGainScore } from "../engine/sessionGainScore.js";

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 6; // lebih rendah dari label-outcomes.js (12) karena range=1y lebih berat

// Toleransi selisih harga open saat mencocokkan candle histori dengan
// actual_next_open yang sudah tersimpan — HANYA dipakai sebagai PENANDA
// (bukan penghalang tulis), untuk kasus ekstrem yang di luar batas ARA/ARB
// wajar (indikasi kemungkinan candle salah tanggal / stock split belum
// disesuaikan). Sebelumnya di-set 3% dan dipakai untuk SKIP baris — ternyata
// findNextTradingDayCandle() sudah pasti benar mengambil hari bursa
// berikutnya (loncat weekend/libur otomatis dari urutan tanggal candle),
// jadi selisih di bawah batas ARA/ARB itu 99% cuma gap harga wajar
// (terutama saham recehan di bawah Rp500 yang gampang gap >3% sehari),
// bukan bug. Menahan tulis di situ menyebabkan banyak baris valid
// permanen tidak terisi. Sekarang dinaikkan ke 20% dan sifatnya cuma
// FLAG untuk dicek manual — data tetap ditulis.
const OPEN_MATCH_TOLERANCE_PCT = 20;

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

// Backfill session_gain_score — lihat catatan "UPDATE 7 Agustus 2026" di
// atas. Terpisah total dari logic high/low di bawah (tidak ada fetch
// eksternal), jadi bisa proses per BARIS langsung, bukan per kode.
async function handleSessionGainBackfill(req, res) {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 2000;
  const rows = await getRowsMissingSessionGain({ limit });

  if (rows.length === 0) {
    return res.status(200).json({
      success: true,
      message: "Tidak ada baris lama yang perlu di-backfill — semua sudah punya session_gain_score.",
      processed: 0,
      remaining: 0
    });
  }

  const results = await runPool(
    rows,
    async (row) => {
      // Sama seperti finalSessionGain di analyzer.js: saham illiquid
      // (saham beku/floor price) langsung 0/SANGAT RENDAH, konsisten
      // dengan baris baru dari scan normal.
      if (row.illiquid) {
        await updateLabel(row.id, { session_gain_score: 0, session_gain_label: "SANGAT RENDAH" });
        return { id: row.id, ok: true };
      }

      const result = calculateSessionGainScore({
        signal: row.signal,
        score: row.score,
        volumeAccelerating: row.volume_accelerating,
        volumeSignal: row.volume_signal,
        volumeRatio: row.volume_ratio,
        gapOutlook: row.gap_outlook,
        rsLabel: row.rs_label
      });

      await updateLabel(row.id, {
        session_gain_score: result.sessionGainScore,
        session_gain_label: result.label
      });

      return { id: row.id, ok: true };
    },
    20 // tidak ada fetch eksternal, aman concurrency lebih tinggi dari relabel high/low
  );

  const ok = results.filter((r) => r && r.ok).length;
  const failed = results
    .map((r, i) => (r && r.error ? { id: rows[i].id, error: r.error } : null))
    .filter(Boolean);

  return res.status(200).json({
    success: true,
    processed: ok,
    failedCount: failed.length,
    failed: failed.slice(0, 10),
    remaining: rows.length - ok,
    hint: rows.length === limit
      ? "Batch ini penuh sampai limit — mungkin masih ada baris lagi, panggil ulang endpoint ini dengan target=session-gain."
      : undefined
  });
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

    if (req.query.target === "session-gain") {
      return await handleSessionGainBackfill(req, res);
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
        let flagged = 0;
        let notFound = 0;
        const flaggedExamples = [];

        for (const row of kodeRows) {
          const candle = findNextTradingDayCandle(candles, row.scan_date);

          if (!candle) {
            notFound++;
            continue;
          }

          // Sanity check: open candle yang ketemu harus cocok dengan
          // actual_next_open yang sudah tersimpan dari labeling sebelumnya.
          // Bedanya dengan versi lama: sekarang ini CUMA PENANDA (flag),
          // bukan penghalang — baris tetap dilabel walau selisihnya besar,
          // supaya data valid tidak nyangkut permanen di antrean. Baris
          // dengan selisih >20% (di luar batas ARA/ARB wajar) dicatat di
          // flaggedExamples untuk dicek manual (kemungkinan stock split).
          const isFlagged =
            row.actual_next_open != null &&
            Math.abs(candle.open - row.actual_next_open) / row.actual_next_open * 100 > OPEN_MATCH_TOLERANCE_PCT;

          if (isFlagged) {
            flagged++;
            if (flaggedExamples.length < 3) {
              flaggedExamples.push({
                scan_date: row.scan_date,
                expected_open: row.actual_next_open,
                found_open: candle.open,
                found_date: candle.date.slice(0, 10)
              });
            }
          }

          const maxGainFromOpenPct = Number(
            (((candle.high - candle.open) / candle.open) * 100).toFixed(2)
          );

          // Best-effort — jam puncak (peak_time_wib) cuma bisa dibackfill
          // kalau tanggalnya masih dalam jangkauan retensi data intraday
          // Yahoo (biasanya ~60 hari). Baris yang lebih lama dari itu
          // akan tetap dapat high/low/max_gain seperti biasa, cuma
          // peak_time_wib/peak_session_phase-nya null.
          const peak = await getIntradayPeakTime(kode, candle.date.slice(0, 10));

          await updateLabel(row.id, {
            actual_next_high: candle.high,
            actual_next_low: candle.low,
            max_gain_from_open_pct: maxGainFromOpenPct,
            peak_time_wib: peak?.peakTimeWIB ?? null,
            peak_session_phase: peak?.peakSessionPhase ?? null
          });

          labeled++;
        }

        return { kode, totalRows: kodeRows.length, labeled, flagged, notFound, flaggedExamples };
      },
      CONCURRENCY
    );

    const ok = results.filter((r) => r && !r.error);
    const failed = results
      .map((r, i) => (r && r.error ? { kode: kodesToProcess[i], error: r.error } : null))
      .filter(Boolean);

    const totalLabeled = ok.reduce((sum, r) => sum + r.labeled, 0);
    const totalFlagged = ok.reduce((sum, r) => sum + r.flagged, 0);
    const totalNotFound = ok.reduce((sum, r) => sum + r.notFound, 0);

    const remainingKode = allKodes.length - kodesToProcess.length;
    const remainingRows = rows.length - totalLabeled - totalNotFound;

    return res.status(200).json({
      success: true,
      processedKode: kodesToProcess.length,
      totalLabeled,
      totalFlagged,   // baris tetap dilabel, tapi selisih open >20% — cek manual (kemungkinan stock split)
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
