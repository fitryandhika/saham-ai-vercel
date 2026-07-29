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

import { getLatestMacroSnapshot } from "../services/macroDataService.js";

export default async function handler(req, res) {
  try {
    const snapshot = await getLatestMacroSnapshot();

    if (!snapshot) {
      return res.status(200).json({
        success: true,
        available: false,
        market_regime: null,
        market_regime_score: null
      });
    }

    return res.status(200).json({
      success: true,
      available: true,
      snapshot_date: snapshot.snapshot_date,
      market_regime: snapshot.market_regime,
      market_regime_score: snapshot.market_regime_score,
      regime_reasons: snapshot.regime_reasons
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
