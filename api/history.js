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
//                                  (tanpa &limit, CSV menarik SEMUA baris yang
//                                  cocok filter lewat loop paginasi)
//
// Filter tabel tambahan (3 September 2026) — semua opsional, semua
// dieksekusi di Supabase, bukan di browser:
//   &sinceDate=&untilDate=    -> rentang tanggal scan (diabaikan kalau &date= diisi)
//   &tier=PRIMARY|SECONDARY|NONE
//   &opportunity=HIGH|MODERATE|WATCH|LOW
//   &minOpportunityScore=70   -> skor opportunity minimal
//   &entryDecision=BUY_NOW|WAIT_PULLBACK|WATCH|AVOID
//   &outcome=win5|win3|lossClose
//   &sort=date|opp|gain|ret   -> urutan (default date)
//
// Response view=table sekarang juga membawa total/hasMore supaya UI
// bisa menampilkan "100 dari 397" dan tombol muat lebih banyak.

import { getScanHistoryRows, getScanHistoryPage, getAllScanHistoryRows, getLabeledRowsForStats } from "../services/dataLogService.js";
import { computeSummary } from "../engine/evaluationStats.js";
import { rowsToCsv } from "../utils/csv.js";

// Kolom & urutan untuk export CSV — dipilih manual (bukan Object.keys)
// supaya urutannya stabil dan enak dibaca di spreadsheet, tidak
// tergantung urutan kolom yang dikembalikan Supabase.
const CSV_COLUMNS = [
  "kode", "sector", "scan_date", "close", "score", "signal", "entry", "distribution_flag",
  "rsi", "macd", "sma20", "sma50", "ema9", "ema20", "risk_reward", "atr",
  "breakout_level", "breakout_distance_pct", "closing_strength",
  "volume_ratio", "volume_signal", "volume_accel_slope_pct", "volume_accelerating",
  "rs_vs_ihsg", "rs_vs_sector", "rs_label",
  "gap_outlook", "gap_probability",
  "session_gain_score", "session_gain_label",
  "illiquid", "illiquid_reason",
  "market_regime", "market_regime_score", "score_adjusted", "reversal_candidate",
  "capitulation_bounce_candidate",
  "actual_next_open", "actual_next_close", "actual_next_high", "actual_next_low",
  "max_gain_from_open_pct", "next_day_return_pct",
  "peak_time_wib", "peak_session_phase",
  "gap_up_realized", "labeled_at",
  // Strategi beli sore -> jual pagi (sesi 1) / sampai close — basis CLOSE H,
  // lihat catatan di engine/evaluationStats.js & api/label-outcomes-close.js.
  "next_day_opportunity_label", "next_day_opportunity_eligible",
  "next_day_opportunity_setup", "next_day_opportunity_score",
  "next_day_entry_quality_score", "next_day_entry_quality_label",
  "next_day_chase_risk", "next_day_entry_decision", "next_day_entry_eligible",
  "next_day_close_return_from_close_pct", "next_day_max_gain_from_close_pct",
  "next_day_high_3pct_realized", "next_day_close_2pct_realized", "next_day_success",
  // Opportunity V4 — 3 September 2026
  "next_day_conviction_tier", "next_day_fade_risk", "next_day_exit_plan",
  "atr_percent", "next_day_opportunity_probability_8pct",
  "close_labeled_at"
];

export default async function handler(req, res) {
  try {
    const {
      view = "summary", date, kode, onlyLabeled, pattern, limit, offset, sinceDate, format,
      // Filter tabel baru — 3 September 2026. Lihat catatan di
      // services/dataLogService.js soal kenapa filter ini harus di
      // server: satu hari scan ±400 baris, jadi 100 baris teratas
      // tanpa filter cuma potongan sembarang dari hari yang sama.
      untilDate, tier, opportunity, minOpportunityScore, entryDecision, outcome, sort
    } = req.query;

    if (view === "table") {
      const isCsv = format === "csv";

      const filters = {
        scanDate: date,
        sinceDate,
        untilDate,
        kode,
        onlyLabeled: onlyLabeled === "true",
        pattern, // "reversal" | "capitulation" — lihat riwayat.js filter "Pola"
        tier,
        opportunity,
        minOpportunityScore,
        entryDecision,
        outcome,
        sort
      };

      // Export CSV: kalau user TIDAK set limit manual, tarik SEMUA baris yang
      // cocok filter (loop paginasi per 1000 baris) — bukan cuma 1 halaman.
      // Kalau user set &limit= manual, tetap dihormati (single page, seperti semula).
      if (isCsv) {
        const rows = limit
          ? await getScanHistoryRows({ ...filters, limit: parseInt(limit, 10), offset: offset ? parseInt(offset, 10) : 0 })
          : await getAllScanHistoryRows(filters);

        const csv = rowsToCsv(rows, CSV_COLUMNS);
        const filename = `scan_history_${date || kode || "export"}_${new Date().toISOString().slice(0, 10)}.csv`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        // BOM supaya Excel (termasuk versi HP) langsung kebaca UTF-8 dengan benar,
        // bukan salah encoding di kolom yang ada karakter non-ASCII.
        return res.status(200).send("\uFEFF" + csv);
      }

      // JSON: pakai versi ber-count supaya UI bisa bilang "100 dari 397"
      // dan tahu kapan tombol "Muat lebih banyak" perlu ditampilkan.
      const pageSize = limit ? parseInt(limit, 10) : 100;
      const pageOffset = offset ? parseInt(offset, 10) : 0;

      const { rows, total } = await getScanHistoryPage({
        ...filters,
        limit: pageSize,
        offset: pageOffset
      });

      return res.status(200).json({
        success: true,
        view: "table",
        count: rows.length,
        total,
        offset: pageOffset,
        limit: pageSize,
        hasMore: pageOffset + rows.length < total,
        data: rows
      });
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
