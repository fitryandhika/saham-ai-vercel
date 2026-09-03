// ============================================================
// Next-Day Opportunity Engine V4 — RECALIBRATED 3 Sep 2026
// ============================================================
// Target strategi: beli di Close H, jual di titik tertinggi H+1
// (kapan pun puncak itu terjadi, sesi 1 maupun sesi 2).
//
// KENAPA V3 GAGAL (bukti dari 11.129 baris close-labeled,
// 16 Jul - 1 Sep 2026, uji out-of-sample 18 Ags - 1 Sep):
//
//   Label HIGH V3 : n=115, win >=5% 35.7%, MEDIAN peak hanya 2.33%,
//                   EV target +3% = -0.55%, hold-to-close = -0.24%.
//   Label LOW  V3 : hold-to-close = +0.62%.
//
// Artinya HIGH kalah dari LOW. Rata-rata peak V3 terlihat bagus
// (5.29%) hanya karena beberapa saham kena ARA; median-nya jelek.
// V3 menyeleksi saham yang MELEDAK LALU DIJUALI, bukan yang naik.
//
// Tiga akar masalahnya:
//   1. Tidak ada fitur volatilitas (ATR%) sama sekali.
//   2. breakout_distance dipakai linear padahal hubungannya bentuk U.
//   3. MACD dipakai absolut, jadi bias ke saham mahal/murah.
// Lihat komentar di opportunityCalibration.js untuk angkanya.
//
// V4 out-of-sample: label HIGH n=586, win >=5% 42.2%,
// median peak 4.02%, EV target +3% = +0.66%, hold = +0.75%.
// Urutan label monoton: LOW 8.2% -> WATCH 17.2% -> MODERATE 29.8%
// -> HIGH 42.2%. V3 tidak monoton.

import {
  OPPORTUNITY_MODEL_VERSION,
  rawModelProbability,
  calibrateProbability
} from "./opportunityCalibration.js";

// ============================================================
// SAKELAR KEBIJAKAN
// ============================================================
// Instruksi lama (28 Ags 2026): jangan pernah beli saham yang
// harganya sudah di atas resistance.
//
// Data 30 hari perdagangan menolak aturan ini untuk strategi
// jual-di-puncak: zona di atas resistance punya win rate >=5%
// tertinggi dari semua zona (33.3%, n=613) versus baseline 16.3%.
// Yang benar dari kekhawatiran itu: zona ini memang paling sering
// balik arah sebelum penutupan (hold-to-close -0.23%, hanya 34.9%
// tutup hijau). Jadi bagus untuk dijual saat puncak, buruk untuk
// ditahan sampai close.
//
// Default dibiarkan sesuai instruksi (false). Ubah ke true kalau
// mau mengambil zona ini, dan pasangkan dengan target jual tetap.
const ALLOW_ENTRY_ABOVE_RESISTANCE = false;

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function finite(v) {
  return Number.isFinite(Number(v));
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

// ============================================================
// ENTRY QUALITY — DIPERBAIKI
// ============================================================
// Perubahan versus V3, semuanya berbasis data:
//
// a) Penalti "closing strength < 0.55" DIHAPUS. Datanya terbalik:
//    closing strength <=0.25 justru menghasilkan return close
//    +0.74% dan 51.9% tutup hijau, versus +0.22% dan 36.6% untuk
//    yang closing strength-nya tinggi. Tutup di harga tertinggi
//    hari ini artinya pembeli sudah habis terpakai hari ini.
//
// b) Penalti RSI diperlunak. RSI >80 justru win rate >=5% 19.2%
//    (lift +5.4 poin setelah dinormalisasi volatilitas), bukan
//    sinyal jual. Yang berbahaya adalah RSI tinggi TANPA volume.
//
// c) Penalti "sudah naik banyak hari ini" dipertahankan tapi
//    dikurangi, dan dibatalkan kalau volume >=2x. Kombinasi
//    ekstensi >20% di atas SMA20 + volume >2x memberi win rate
//    >=5% sebesar 50%, tertinggi di seluruh dataset.
function calculateEntryQuality({
  dailyChangePercent = null,
  breakout = {},
  rsi = null,
  exhaustion = {},
  distribution = {},
  riskReward = null,
  volumeRatio = null
} = {}) {
  let score = 100;
  const reasons = [];
  const dcp = Number(dailyChangePercent);
  const distance = Number(breakout?.distancePercent);
  const rsiValue = Number(rsi);
  const vr = Number(volumeRatio);
  const exhaustionScore = Number(exhaustion?.exhaustionScore ?? 0);
  const distributionScore = Number(distribution?.distributionScore ?? 0);
  const rr = Number(riskReward);

  const volumeConfirmed = Number.isFinite(vr) && vr >= 2;

  if (Number.isFinite(dcp)) {
    const softener = volumeConfirmed ? 0.5 : 1;
    if (dcp >= 10) { score -= 25 * softener; reasons.push(`Sudah naik +${dcp}% hari ini`); }
    else if (dcp >= 8) { score -= 16 * softener; reasons.push(`Kenaikan harian +${dcp}% sudah tinggi`); }
    else if (dcp >= 6) { score -= 9 * softener; reasons.push(`Kenaikan harian +${dcp}% cukup tinggi`); }
    else if (dcp >= 4) { score -= 4 * softener; }
    if (volumeConfirmed && dcp >= 6) {
      reasons.push(`Volume ${vr.toFixed(1)}x mengkonfirmasi kenaikan — penalti chase dikurangi separuh`);
    }
  }

  // Tangga dua sisi. Bentuk U, sudah divalidasi ulang di dataset
  // 11.129 baris: -2%..0% adalah zona terburuk, dua ujungnya bagus.
  if (Number.isFinite(distance)) {
    if (distance > 0) {
      if (distance > 8) { score -= 6; reasons.push(`Harga ${distance}% di atas resistance`); }
      else if (distance > 3) { score -= 3; reasons.push(`Harga ${distance}% di atas resistance`); }
      reasons.push("Zona di atas resistance: peluang puncak tertinggi, tapi paling sering balik arah sebelum close");
    } else if (distance > -2) {
      score -= 22;
      reasons.push(`Menempel resistance (${distance}%) — zona tersangkut, win rate terendah (9.3%)`);
    } else if (distance > -5) {
      score -= 18;
      reasons.push(`Dekat resistance (${distance}%) — ruang naik terbatas`);
    } else if (distance > -10) {
      score -= 8;
      reasons.push(`Jarak ke resistance ${distance}% — ruang gerak sedang`);
    } else {
      score += 5;
      reasons.push(`Jauh di bawah resistance (${distance}%) — ruang pemulihan lebar (win rate 25.5%)`);
    }
  }

  if (Number.isFinite(rsiValue)) {
    if (rsiValue >= 80 && !volumeConfirmed) { score -= 10; reasons.push(`RSI ${rsiValue} tinggi tanpa konfirmasi volume`); }
    else if (rsiValue >= 75 && !volumeConfirmed) { score -= 5; }
  }

  if (exhaustionScore >= 60) { score -= 15; reasons.push("Rally menunjukkan exhaustion tinggi"); }
  else if (exhaustionScore >= 35) { score -= 7; reasons.push("Rally mulai menunjukkan exhaustion"); }

  if (distributionScore >= 60) { score -= 20; reasons.push("Indikasi distribusi tinggi"); }
  else if (distributionScore >= 35) { score -= 9; reasons.push("Ada indikasi distribusi"); }

  if (Number.isFinite(rr)) {
    if (rr < 1) { score -= 20; reasons.push("Risk/reward < 1"); }
    else if (rr < 1.5) { score -= 9; }
  }

  score = Math.round(clamp(score));

  let label = "AVOID";
  if (score >= 80) label = "GOOD";
  else if (score >= 65) label = "FAIR";
  else if (score >= 50) label = "CAUTION";
  else if (score >= 35) label = "POOR";

  let chaseRisk = "LOW";
  if (dcp >= 12 && !volumeConfirmed) chaseRisk = "EXTREME";
  else if (dcp >= 9 || distance > 8) chaseRisk = "HIGH";
  else if (dcp >= 6 || distance > 3) chaseRisk = "MODERATE";

  let decision = "BUY_NOW";
  if (score < 50 || chaseRisk === "EXTREME") decision = "AVOID";
  else if (score < 65) decision = "WAIT_PULLBACK";
  else if (score < 80) decision = "WATCH";

  let aboveResistanceBlocked = false;
  if (!ALLOW_ENTRY_ABOVE_RESISTANCE && Number.isFinite(distance) && distance > 0) {
    aboveResistanceBlocked = true;
    decision = "WAIT_PULLBACK";
    reasons.push(
      `Harga ${distance}% di atas resistance — entry ditahan oleh kebijakan ` +
      `(catatan: secara statistik zona ini justru win rate tertinggi 33.3%)`
    );
  }

  const entryEligible = score >= 65 && decision === "BUY_NOW" && !aboveResistanceBlocked;

  return { score, label, chaseRisk, decision, entryEligible, aboveResistanceBlocked, reasons };
}

// ============================================================
// FITUR MODEL V4
// ============================================================
function buildModelFeatures({
  close,
  atr,
  sma20,
  sma50,
  volume,
  volumeAcceleration,
  breakout,
  relativeStrength,
  rsi,
  macd,
  closingStrength
}) {
  const c = Number(close);
  const atrPct = finite(atr) && finite(c) && c > 0
    ? Math.min(20, Math.max(0, (Number(atr) / c) * 100))
    : 4.86; // mean training, fallback netral

  const dist = Math.min(15, Math.max(-40, n(breakout?.distancePercent, 0)));
  const vr = Math.min(15, Math.max(0, n(volume?.ratio, 1)));

  const ext20 = finite(sma20) && Number(sma20) > 0
    ? Math.min(60, Math.max(-40, ((c - Number(sma20)) / Number(sma20)) * 100))
    : 0;
  const ext50 = finite(sma50) && Number(sma50) > 0
    ? Math.min(80, Math.max(-50, ((c - Number(sma50)) / Number(sma50)) * 100))
    : 0;

  const macdPct = finite(macd?.macd) && finite(c) && c > 0
    ? Math.min(15, Math.max(-15, (Number(macd.macd) / c) * 100))
    : 0;

  return {
    atr_pct: atrPct,
    log_close: Math.log(Math.max(20, finite(c) ? c : 400)),
    dist_below: Math.min(0, dist),
    dist_above: Math.max(0, dist),
    above_res: dist > 0 ? 1 : 0,
    log_vr: Math.log1p(vr),
    va: Math.min(150, Math.max(-150, n(volumeAcceleration?.slopePercent, 0))),
    rs: Math.min(80, Math.max(-40, n(relativeStrength?.vsIhsg, 0))),
    rsi_c: Math.min(100, Math.max(10, n(rsi, 50))),
    macd_pct: macdPct,
    cs: n(closingStrength, 0.5),
    ext20,
    ext50
  };
}

function detectOpportunitySetup({ volumeRatio, breakoutDistance, rsVsIhsg, rsi }) {
  if (finite(breakoutDistance) && breakoutDistance >= 0 &&
      finite(volumeRatio) && volumeRatio >= 1.5) {
    return "CONFIRMED_BREAKOUT";
  }
  if (finite(volumeRatio) && volumeRatio >= 3) {
    return "VOLUME_EXPANSION";
  }
  if (finite(breakoutDistance) && breakoutDistance >= -20 && breakoutDistance < -3 &&
      finite(volumeRatio) && volumeRatio >= 1.5 &&
      finite(rsVsIhsg) && rsVsIhsg >= 10) {
    return "PRE_BREAKOUT_ACCUMULATION";
  }
  if (finite(breakoutDistance) && breakoutDistance <= -10 &&
      finite(volumeRatio) && volumeRatio >= 1.5 &&
      finite(rsi) && rsi >= 35 && rsi <= 65) {
    return "REVERSAL_ABSORPTION";
  }
  return "GENERAL";
}

function setupDetail(setup) {
  switch (setup) {
    case "CONFIRMED_BREAKOUT": return "Breakout terkonfirmasi + volume";
    case "PRE_BREAKOUT_ACCUMULATION": return "Belum breakout, RS dan volume menunjukkan akumulasi";
    case "VOLUME_EXPANSION": return "Ekspansi volume ekstrem (>=3x)";
    case "REVERSAL_ABSORPTION": return "Pullback dalam dengan indikasi absorption";
    default: return "Tidak ada setup khusus; dinilai oleh model umum";
  }
}

// Bobot komposit. p10 lama diganti p8: target >=10% di IDX hampir
// selalu berarti ARA, yang didominasi saham gorengan dan tidak bisa
// diandalkan sebagai target. Bobotnya juga diturunkan.
function calculateOpportunityIndex({ p3, p5, p8 }) {
  const composite = (0.30 * p3) + (0.50 * p5) + (0.20 * p8);
  // 0.18 = komposit rata-rata dataset; skala 150 supaya 0-100 terpakai penuh.
  return Math.round(clamp(50 + 150 * (composite - 0.18)));
}

function probabilityLabel(p) {
  if (!Number.isFinite(p)) return "–";
  return `${(p * 100).toFixed(1)}%`;
}

export function calculateNextDayOpportunity({
  score = null,
  close = null,
  atr = null,
  sma20 = null,
  sma50 = null,
  volume = {},
  volumeAcceleration = {},
  breakout = {},
  relativeStrength = {},
  exhaustion = {},
  distribution = {},
  liquidity = {},
  riskReward = null,
  closingStrength = null,
  marketTrend = null,
  rsi = null,
  macd = {},
  dailyChangePercent = null
} = {}) {
  const volumeRatio = Number(volume?.ratio);
  const breakoutDistance = Number(breakout?.distancePercent);
  const rsVsIhsg = Number(relativeStrength?.vsIhsg);
  const rsiValue = Number(rsi);
  const dcp = Number(dailyChangePercent);

  const setup = detectOpportunitySetup({ volumeRatio, breakoutDistance, rsVsIhsg, rsi: rsiValue });

  const features = buildModelFeatures({
    close, atr, sma20, sma50, volume, volumeAcceleration,
    breakout, relativeStrength, rsi, macd, closingStrength
  });

  const rawP3 = rawModelProbability("p3", features);
  const rawP5 = rawModelProbability("p5", features);
  const rawP8 = rawModelProbability("p8", features);
  const rawClose2 = rawModelProbability("close2", features);

  const p3 = calibrateProbability("p3", rawP3);
  const p5 = calibrateProbability("p5", rawP5);
  const p8 = calibrateProbability("p8", rawP8);
  const close2 = calibrateProbability("close2", rawClose2);

  const opportunityScore = calculateOpportunityIndex({ p3, p5, p8 });

  const blockers = [];
  if (liquidity?.illiquid) blockers.push("Saham tidak likuid");
  if (Number.isFinite(rsVsIhsg) && rsVsIhsg < -20) blockers.push("Relative strength sangat lemah");
  if (Number(distribution?.distributionScore) >= 60) blockers.push("Distribution tinggi");

  // Ambang label diambil dari kuantil skor pada data nyata, bukan
  // dari angka bulat. Hasil out-of-sample per label:
  //   HIGH >=75      win >=5% 42.2%, median peak 4.02%
  //   MODERATE >=60  29.8%
  //   WATCH >=45     17.2%
  //   LOW <45         8.2%
  let opportunityLabel = "LOW";
  if (opportunityScore >= 75) opportunityLabel = "HIGH";
  else if (opportunityScore >= 60) opportunityLabel = "MODERATE";
  else if (opportunityScore >= 45) opportunityLabel = "WATCH";

  if (blockers.length > 0 && opportunityLabel === "HIGH") opportunityLabel = "MODERATE";

  const expectedMoveBand = opportunityLabel;

  // ============================================================
  // ELIGIBLE + CONVICTION TIER
  // ============================================================
  // Sebelumnya `eligible` hanya bernilai true untuk HIGH, sementara
  // headline di script.js punya ambangnya sendiri (HIGH ATAU MODERATE).
  // Akibatnya satu kartu bisa menampilkan "PRIORITAS — BUY SORE" di
  // atas dan "Opportunity H+1: TIDAK VALID" tepat di bawahnya (kasus
  // SQMI, 3 Sep 2026). Sekarang ambangnya cuma satu, di sini, dan
  // perbedaan bobot dinyatakan lewat convictionTier — bukan lewat
  // dua definisi "valid" yang berbeda.
  //
  // Kenapa MODERATE tetap "eligible" tapi bukan PRIMARY (OOS 18 Ags –
  // 1 Sep): HIGH win >=5% 42,2% / median peak 4,02% / EV target +3%
  // +0,66%. MODERATE 29,8% / 2,64% / +0,22%. Ada setup, tapi setelah
  // fee IDX (±0,3%) EV-nya praktis nol — layak posisi kecil, tidak
  // layak disebut prioritas.
  const eligible =
    (opportunityLabel === "HIGH" || opportunityLabel === "MODERATE") &&
    blockers.length === 0;

  const convictionTier =
    !eligible ? "NONE"
      : opportunityLabel === "HIGH" ? "PRIMARY"
        : "SECONDARY";

  // FADE RISK — kolom baru, memisahkan dua hal yang selama ini
  // tercampur: peluang MENYENTUH target versus peluang MEMPERTAHANKANNYA.
  // Inilah sumber keluhan "score HIGH tapi close minus": saham
  // berpeluang puncak tinggi memang sering ditutup merah.
  // p5 tinggi + close2 rendah = wajib jual di puncak, jangan ditahan.
  let fadeRisk = "LOW";
  if (p5 >= 0.25 && close2 < 0.15) fadeRisk = "HIGH";
  else if (p5 >= 0.20 && close2 < 0.20) fadeRisk = "MODERATE";

  const exitPlan = fadeRisk === "HIGH"
    ? "JUAL_DI_TARGET"   // pasang target +2-3%, jangan tahan sampai close
    : close2 >= 0.25
      ? "BOLEH_TAHAN_SAMPAI_CLOSE"
      : "JUAL_SEPARUH_DI_TARGET";

  const entryQuality = calculateEntryQuality({
    dailyChangePercent: dcp,
    breakout,
    rsi: rsiValue,
    exhaustion,
    distribution,
    riskReward: Number(riskReward),
    volumeRatio
  });

  const tradeDecision = !eligible ? "NO_SETUP" : entryQuality.decision;

  const regime = String(marketTrend ?? "").toUpperCase();

  const breakdown = [
    { factor: "MODEL_PROBABILITY_3PCT", points: Math.round(p3 * 100), detail: probabilityLabel(p3) },
    { factor: "MODEL_PROBABILITY_5PCT", points: Math.round(p5 * 100), detail: probabilityLabel(p5) },
    { factor: "MODEL_PROBABILITY_8PCT", points: Math.round(p8 * 100), detail: probabilityLabel(p8) },
    { factor: "MODEL_CLOSE_2PCT", points: Math.round(close2 * 100), detail: probabilityLabel(close2) },
    { factor: "ATR_PERCENT", points: Math.round(features.atr_pct * 10) / 10,
      detail: `ATR ${features.atr_pct.toFixed(2)}% dari harga — ruang gerak harian` },
    { factor: "FADE_RISK", points: 0, detail: `${fadeRisk} — rencana keluar: ${exitPlan}` },
    { factor: "SETUP", points: 0, detail: `${setup}: ${setupDetail(setup)}` },
    { factor: "PRICE_STRUCTURE_CONTEXT", points: 0,
      detail: `Distance resistance ${finite(breakoutDistance) ? breakoutDistance.toFixed(1) : "–"}%` }
  ];

  if (finite(volumeRatio) && volumeRatio >= 3) {
    breakdown.push({ factor: "VOLUME_EXPANSION_CONTEXT", points: 0,
      detail: `Volume ${volumeRatio.toFixed(2)}x — faktor tunggal terkuat (win rate 34.8% vs 16.3%)` });
  }

  return {
    version: OPPORTUNITY_MODEL_VERSION,
    opportunityScore,
    opportunityProbability: p3 * 100,
    opportunityProbability5Pct: p5 * 100,
    opportunityProbability8Pct: p8 * 100,
    nextDayClose2PctProbability: close2 * 100,
    rawProbability3Pct: rawP3,
    rawProbability5Pct: rawP5,
    rawProbability8Pct: rawP8,
    rawClose2PctProbability: rawClose2,
    opportunityLabel,
    expectedMoveBand,
    coreSetup: setup,
    setupDetail: setupDetail(setup),
    eligible,
    convictionTier,
    fadeRisk,
    exitPlan,
    atrPercent: Math.round(features.atr_pct * 100) / 100,
    entryQualityScore: entryQuality.score,
    entryQualityLabel: entryQuality.label,
    chaseRisk: entryQuality.chaseRisk,
    entryDecision: entryQuality.decision,
    entryEligible: entryQuality.entryEligible,
    aboveResistanceBlocked: entryQuality.aboveResistanceBlocked,
    entryQualityReasons: entryQuality.reasons,
    tradeDecision,
    preBreakoutAccumulation: setup === "PRE_BREAKOUT_ACCUMULATION",
    inputs: {
      volumeRatio: finite(volumeRatio) ? volumeRatio : null,
      volumeAccelerationPercent: finite(volumeAcceleration?.slopePercent)
        ? Number(volumeAcceleration.slopePercent) : null,
      breakoutDistancePercent: finite(breakoutDistance) ? breakoutDistance : null,
      baseScore: finite(score) ? Number(score) : null,
      relativeStrengthVsIhsg: finite(rsVsIhsg) ? rsVsIhsg : null,
      closingStrength: finite(closingStrength) ? Number(closingStrength) : null,
      marketTrend: regime || null,
      rsi: finite(rsiValue) ? rsiValue : null,
      macdPercent: features.macd_pct,
      atrPercent: features.atr_pct,
      dailyChangePercent: finite(dcp) ? dcp : null
    },
    breakdown,
    blockers
  };
}

export default calculateNextDayOpportunity;
