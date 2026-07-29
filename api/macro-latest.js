// ==========================
// Macro Latest — /api/macro-latest
// ==========================
//
// Endpoint READ-ONLY dan ringan, khusus dipakai frontend (index.html/
// script.js) buat nampilin badge regime market di header. Beda dengan
// /api/macro-scan (yang fetch FRED+Yahoo lalu simpan), endpoint ini
// CUMA baca baris macro_snapshot terakhir dari Supabase — tidak
// memanggil FRED/Yahoo sama sekali, jadi aman dipanggil tiap kali
// halaman dibuka tanpa boros rate limit.

import { getLatestMacroSnapshot, getRecentMacroSnapshots } from "../services/macroDataService.js";

export default async function handler(req, res) {
  try {
    const snapshot = await getLatestMacroSnapshot();

    if (!snapshot) {
      return res.status(200).json({
        success: true,
        available: false,
        market_regime: null,
        market_regime_score: null,
        ihsg_close: null,
        ihsg_change_pct: null
      });
    }

    // Ambil 2 snapshot terakhir buat hitung perubahan IHSG hari-ke-hari
    // untuk ticker — best-effort, tetap tampil walau cuma ada 1 baris.
    const recent = await getRecentMacroSnapshots(2);
    let ihsgChangePct = null;

    if (recent.length >= 2) {
      const prevClose = recent[0].ihsg_close;
      const todayClose = recent[1].ihsg_close;
      if (prevClose && todayClose) {
        ihsgChangePct = Number((((todayClose - prevClose) / prevClose) * 100).toFixed(2));
      }
    }

    return res.status(200).json({
      success: true,
      available: true,
      snapshot_date: snapshot.snapshot_date,
      market_regime: snapshot.market_regime,
      market_regime_score: snapshot.market_regime_score,
      regime_reasons: snapshot.regime_reasons,
      ihsg_close: snapshot.ihsg_close,
      ihsg_change_pct: ihsgChangePct
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil regime market terakhir.",
      error: error.message
    });
  }
}
