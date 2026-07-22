// ==========================
// Dashboard Riwayat & Evaluasi — /api/history
// ==========================
//
// Dipakai oleh dashboard.html untuk menampilkan:
//   1. Tabel riwayat scan_history (prediksi + hasil aktual, kalau sudah dilabel)
//   2. Ringkasan akurasi (win rate, avg return) per signal / bucket skor /
//      breakout level / tanggal, dihitung dari engine/evaluationStats.js
//
// Query params:
//   ?view=summary            -> ringkasan statistik (default kalau tidak diisi)
//   ?view=table               -> baris mentah untuk tabel
//   &date=YYYY-MM-DD          -> filter tanggal scan tertentu
//   &kode=BBCA                -> filter satu emiten
//   &onlyLabeled=true         -> (view=table) hanya baris yang sudah ada hasil aktualnya
//   &limit=&offset=           -> (view=table) paginasi
//   &sinceDate=YYYY-MM-DD     -> (view=summary) batasi rentang untuk ringkasan
//   &format=csv                -> (view=table) unduh sebagai file CSV, bukan JSON
//                                  (limit default jadi lebih besar — lihat di bawah —
//                                  supaya bisa export ribuan baris sekaligus untuk
//                                  dianalisa manual di Excel/Google Sheets)

import { getScanHistoryRows, getAllScanHistoryRows, getLabeledRowsForStats } from "../services/dataLogService.js";
import { computeSummary } from "../engine/evaluationStats.js";
import { rowsToCsv } from "../utils/csv.js";

// Kolom & urutan untuk export CSV — dipilih manual (bukan Object.keys)
// supaya urutannya stabil dan enak dibaca di spreadsheet, tidak
// tergantung urutan kolom yang dikembalikan Supabase.
const CSV_COLUMNS = [
  "kode", "sector", "scan_date", "close", "score", "signal", "entry",
  "rsi", "macd", "sma20", "sma50", "ema9", "ema20", "risk_reward", "atr",
  "breakout_level", "breakout_distance_pct", "closing_strength",
  "volume_ratio", "volume_signal", "volume_accel_slope_pct", "volume_accelerating",
  "rs_vs_ihsg", "rs_vs_sector", "rs_label",
  "gap_outlook", "gap_probability",
  "session_gain_score", "session_gain_label",
  "actual_next_open", "actual_next_close", "actual_next_high", "actual_next_low",
  "max_gain_from_open_pct", "next_day_return_pct",
  "gap_up_realized", "labeled_at"
];

export default async function handler(req, res) {
  try {
    const { view = "summary", date, kode, onlyLabeled, limit, offset, sinceDate, format } = req.query;

    if (view === "table") {
      const isCsv = format === "csv";

      // Export CSV: kalau user TIDAK set limit manual, tarik SEMUA baris yang
      // cocok filter (loop paginasi per 1000 baris) — bukan cuma 1 halaman.
      // Ini supaya "Kosongkan tanggal" benar-benar menampilkan semua data
      // yang sudah dilabel, tidak kepotong di batas max-rows Supabase (1000).
      // Kalau user set &limit= manual, tetap dihormati (single page, seperti semula).
      const rows = isCsv && !limit
        ? await getAllScanHistoryRows({
            scanDate: date,
            kode,
            onlyLabeled: onlyLabeled === "true"
          })
        : await getScanHistoryRows({
            scanDate: date,
            kode,
            onlyLabeled: onlyLabeled === "true",
            limit: limit ? parseInt(limit, 10) : 200,
            offset: offset ? parseInt(offset, 10) : 0
          });

      if (isCsv) {
        const csv = rowsToCsv(rows, CSV_COLUMNS);
        const filename = `scan_history_${date || kode || "export"}_${new Date().toISOString().slice(0, 10)}.csv`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        // BOM supaya Excel (termasuk versi HP) langsung kebaca UTF-8 dengan benar,
        // bukan salah encoding di kolom yang ada karakter non-ASCII.
        return res.status(200).send("\uFEFF" + csv);
      }

      return res.status(200).json({ success: true, view: "table", count: rows.length, data: rows });
    }

    // view === "summary"
    const rows = await getLabeledRowsForStats({ sinceDate, kode });
    const summary = computeSummary(rows);

    return res.status(200).json({ success: true, view: "summary", data: summary });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Gagal mengambil riwayat/ringkasan.",
      error: error.message
    });
  }
}
