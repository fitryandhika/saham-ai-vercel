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

import { getScanHistoryRows, getLabeledRowsForStats } from "../services/dataLogService.js";
import { computeSummary } from "../engine/evaluationStats.js";

export default async function handler(req, res) {
  try {
    const { view = "summary", date, kode, onlyLabeled, limit, offset, sinceDate } = req.query;

    if (view === "table") {
      const rows = await getScanHistoryRows({
        scanDate: date,
        kode,
        onlyLabeled: onlyLabeled === "true",
        limit: limit ? parseInt(limit, 10) : 200,
        offset: offset ? parseInt(offset, 10) : 0
      });

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
