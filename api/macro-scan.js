// ==========================
// Macro Scan — Layer Fundamental Makro
// ==========================
//
// Jalan SEBELUM /api/scan (lihat urutan cron di vercel.json). Ambil
// data makro terkini (FRED + Yahoo Finance, lihat services/
// macroFetchService.js), simpan sebagai snapshot harian, lalu
// klasifikasikan regime (RISK_ON/RISK_OFF/NEUTRAL) dari histori
// beberapa hari terakhir — supaya api/scan.js tinggal baca hasilnya,
// tidak perlu fetch ulang macro data per stock.

import { fetchRawMacroData } from "../services/macroFetchService.js";
import { getIhsgCloses } from "../services/marketService.js";
import {
  saveMacroSnapshot,
  getRecentMacroSnapshots
} from "../services/macroDataService.js";
import { classifyMarketRegime } from "../engine/marketRegime.js";
import { isTradingDay, nonTradingDayReason, todayWIB } from "../config/tradingCalendar.js";

export const config = {
  maxDuration: 30
};

export default async function handler(req, res) {
  try {
    const { force } = req.query;
    const today = todayWIB();

    if (!isTradingDay(today) && force !== "true") {
      return res.status(200).json({
        skipped: true,
        reason: nonTradingDayReason(today),
        snapshot_date: today,
        message: "Hari ini bukan hari bursa, macro-scan dilewati. Tambahkan ?force=true untuk override."
      });
    }

    const raw = await fetchRawMacroData();

    // IHSG close dipakai juga oleh marketService.js (cache in-memory
    // per invocation) — ambil closes lalu pakai nilai terakhir.
    const ihsgCloses = await getIhsgCloses();
    const ihsgClose = ihsgCloses && ihsgCloses.length ? ihsgCloses.at(-1) : null;

    const draftRow = {
      snapshot_date: today,
      ...raw,
      ihsg_close: ihsgClose
    };

    // Ambil histori SEBELUM baris hari ini disimpan, supaya trend
    // (dxy 5 hari, ihsg 5 hari, dst) dihitung dari hari-hari
    // SEBELUMNYA + hari ini, bukan bias oleh diri sendiri dua kali.
    const recentBefore = await getRecentMacroSnapshots(9);
    const snapshotsForRegime = [...recentBefore, draftRow];

    const { regime, regimeScore, label, reasons } = classifyMarketRegime(snapshotsForRegime);

    const finalRow = {
      ...draftRow,
      market_regime: regime,
      market_regime_score: regimeScore,
      regime_reasons: reasons
    };

    const saveResult = await saveMacroSnapshot(finalRow);

    return res.status(200).json({
      success: true,
      snapshot_date: today,
      data: {
        ...finalRow,
        label
      },
      saving: saveResult
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Macro scan gagal.",
      error: error.message,
      stack: error.stack
    });
  }
}
