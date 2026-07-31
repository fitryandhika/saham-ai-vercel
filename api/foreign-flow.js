// ==========================
// Arus Dana Asing — /api/foreign-flow
// ==========================
//
// CATATAN JUJUR (lihat juga services/macroFetchService.js): tidak ada
// API gratis resmi untuk net buy/sell asing harian di IDX (data resmi
// ada di RTI/IPOT/IDX tapi butuh scraping HTML yang rapuh). Endpoint
// ini karena itu punya DUA MODE:
//   1. "actual" — kalau kolom foreign_net_flow_idx di macro_snapshot
//      sudah diisi manual (lihat catatan di macroFetchService.js),
//      dipakai apa adanya sebagai data nyata.
//   2. "estimate" — kalau belum ada input manual, dihitung PROXY dari
//      tren DXY + USD/IDR + IHSG 5 hari terakhir (logika sama seperti
//      engine/marketRegime.js). Selalu diberi label jelas "Estimasi"
//      di response supaya frontend tidak menampilkannya seolah data
//      resmi.

import { getRecentMacroSnapshots } from "../services/macroDataService.js";

function trendPct(snapshots, field, lookback = 5) {
  const values = snapshots.map((s) => s[field]).filter((v) => v !== null && v !== undefined);
  if (values.length < 2) return null;
  const recent = values.at(-1);
  const past = values.length > lookback ? values.at(-(lookback + 1)) : values[0];
  if (!past) return null;
  return Number((((recent - past) / past) * 100).toFixed(2));
}

export default async function handler(req, res) {
  try {
    const snapshots = await getRecentMacroSnapshots(10);

    if (!snapshots.length) {
      return res.status(200).json({
        success: true,
        available: false,
        message: "Belum ada data macro_snapshot — jalankan /api/macro-scan dulu."
      });
    }

    const today = snapshots.at(-1);

    // Mode 1: data aktual kalau sudah diisi manual.
    if (today.foreign_net_flow_idx !== null && today.foreign_net_flow_idx !== undefined) {
      const direction = today.foreign_net_flow_idx >= 0 ? "INFLOW" : "OUTFLOW";
      return res.status(200).json({
        success: true,
        available: true,
        mode: "actual",
        direction,
        value: today.foreign_net_flow_idx,
        snapshotDate: today.snapshot_date,
        note: "Data net flow asing diinput manual (bukan estimasi)."
      });
    }

    // Mode 2: proxy dari tren DXY / USD-IDR / IHSG.
    const dxyTrend = trendPct(snapshots, "dxy_index", 5);
    const usdidrTrend = trendPct(snapshots, "usdidr", 5);
    const ihsgTrend = trendPct(snapshots, "ihsg_close", 5);

    let score = 0; // > 0 condong inflow, < 0 condong outflow
    const reasons = [];

    if (usdidrTrend !== null) {
      if (usdidrTrend >= 1) {
        score -= 2;
        reasons.push(`Rupiah melemah ${usdidrTrend}% dalam 5 hari — indikasi tekanan outflow.`);
      } else if (usdidrTrend <= -0.5) {
        score += 1;
        reasons.push(`Rupiah menguat ${Math.abs(usdidrTrend)}% dalam 5 hari — indikasi dukungan inflow.`);
      }
    }

    if (dxyTrend !== null) {
      if (dxyTrend >= 1.5) {
        score -= 1;
        reasons.push(`DXY menguat ${dxyTrend}% dalam 5 hari — dolar kuat, tekanan ke emerging market.`);
      } else if (dxyTrend <= -1.5) {
        score += 1;
        reasons.push(`DXY melemah ${Math.abs(dxyTrend)}% dalam 5 hari — kondusif untuk emerging market.`);
      }
    }

    if (ihsgTrend !== null) {
      if (ihsgTrend >= 2) {
        score += 1;
        reasons.push(`IHSG naik ${ihsgTrend}% dalam 5 hari — konsisten dengan dana masuk.`);
      } else if (ihsgTrend <= -2) {
        score -= 1;
        reasons.push(`IHSG turun ${ihsgTrend}% dalam 5 hari — konsisten dengan dana keluar.`);
      }
    }

    let direction = "NEUTRAL";
    if (score >= 2) direction = "INFLOW";
    else if (score <= -2) direction = "OUTFLOW";

    if (!reasons.length) {
      reasons.push("Belum cukup data tren untuk mengestimasi arah arus dana asing.");
    }

    return res.status(200).json({
      success: true,
      available: true,
      mode: "estimate",
      direction,
      score,
      dxyTrend,
      usdidrTrend,
      ihsgTrend,
      snapshotDate: today.snapshot_date,
      reasons,
      note: "Estimasi proxy dari tren DXY/USD-IDR/IHSG — bukan data net buy/sell asing resmi IDX."
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil estimasi arus dana asing.",
      error: error.message
    });
  }
}
