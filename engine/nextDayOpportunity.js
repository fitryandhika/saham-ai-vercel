// ============================================================
// Next-Day Opportunity Engine V2 — CALIBRATED
// ============================================================
// Tujuan:
// Menilai peluang H+1 dari CLOSE H, bukan dari OPEN H+1.
//
// Target strategi:
//   Close H -> harga tertinggi H+1 / Close H+1
//
// Perbaikan penting dari V1:
// 1) "Jauh di bawah resistance" TIDAK lagi otomatis dianggap pre-breakout.
//    V1 menerima distance -26.7% sebagai PRE_BREAKOUT; ini terlalu longgar
//    dan menjadi salah satu sumber false positive seperti DMMX.
// 2) Score dasar/score lama tidak boleh membuat Opportunity langsung HIGH.
//    Score lama hanya fitur pendukung, bukan mesin prediksi H+1.
// 3) Volume wajib dikonfirmasi price action (closing strength), struktur
//    pasar, dan jarak resistance yang masuk akal.
// 4) HIGH + ELIGIBLE hanya boleh muncul jika hard checks lolos.
// 5) Exhaustion/distribution menjadi blocker nyata untuk kandidat HIGH.
// 6) Tidak ada saturation: base score >=90 tidak diberi bonus besar.
//
// CATATAN:
// Threshold ini adalah recalibration defensif berbasis failure mode yang
// terlihat (false HIGH/ELIGIBLE), bukan hasil training statistik baru.
// Setelah outcome H+1 dari close terkumpul, threshold harus divalidasi lagi
// terhadap max_gain_from_close_pct dan next_day_close_return_from_close_pct.

import {
  OPPORTUNITY_MODEL_VERSION,
  rawModelProbability,
  calibrateProbability
} from "./opportunityCalibration.js";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function addBreakdown(arr, factor, points, detail = null) {
  arr.push({ factor, points, ...(detail ? { detail } : {}) });
}

function calculateEntryQuality({
  dailyChangePercent = null,
  breakout = {},
  rsi = null,
  exhaustion = {},
  distribution = {},
  riskReward = null,
  closingStrength = null
} = {}) {
  let score = 100;
  const reasons = [];
  const dcp = Number(dailyChangePercent);
  const distance = Number(breakout?.distancePercent);
  const rsiValue = Number(rsi);
  const exhaustionScore = Number(exhaustion?.exhaustionScore ?? 0);
  const distributionScore = Number(distribution?.distributionScore ?? 0);
  const rr = Number(riskReward);
  const cs = Number(closingStrength);

  // Opportunity = potensi H+1 dari Close H.
  // Entry Quality = apakah Close H masih layak dibeli sekarang.
  // Keduanya sengaja dipisahkan agar momentum kuat tidak berarti "buy at any price".
  if (Number.isFinite(dcp)) {
    if (dcp >= 10) { score -= 35; reasons.push(`Sudah naik +${dcp}% hari ini`); }
    else if (dcp >= 8) { score -= 25; reasons.push(`Kenaikan harian +${dcp}% sudah tinggi`); }
    else if (dcp >= 6) { score -= 15; reasons.push(`Kenaikan harian +${dcp}% cukup tinggi`); }
    else if (dcp >= 4) { score -= 8; reasons.push(`Kenaikan harian +${dcp}% mulai membatasi entry`); }
    else if (dcp >= 2) { score -= 3; }
  }

  // ============================================================
  // JARAK KE RESISTANCE — TANGGA DUA SISI
  // ============================================================
  //
  // ROOT CAUSE (ditemukan 28 Agustus 2026, dari export 10.148 baris
  // berlabel / 30 hari perdagangan):
  //
  // Tangga lama HANYA punya cabang untuk distance > 0. Seluruh rentang
  // negatif — dari -1% sampai -30% — jatuh ke "tidak ada penalti", jadi
  // sama-sama menerima skor penuh. Padahal dua ujung rentang itu
  // berlawanan hasilnya (win rate naik >=5% di H+1):
  //
  //   distance <= -10%  -> 23.0%   (n=3494)  <- terbaik di sisi bawah
  //   -10% s/d -5%      -> 13.5%   (n=2814)
  //   -5%  s/d -2%      ->  9.5%   (n=2002)
  //   -2%  s/d  0%      ->  9.3%   (n=1306)  <- ZONA MATI, tapi dulu
  //                                             dapat skor 100 penuh
  //   di atas resistance-> 25.6%   (n= 532)  <- dulu justru DIHUKUM -30
  //
  // Akibatnya entry_quality_score jadi TERBALIK terhadap hasil nyata:
  // korelasi -0.102 terhadap max gain H+1; di atas median win rate
  // 13.1%, di bawah median 22.4%. Kolom yang tugasnya menyaring entry
  // justru menyingkirkan pemenang.
  //
  // FIX: tangga dibuat dua sisi, mengikuti bentuk-U yang terbukti
  // konsisten di 27 dari 30 hari (median selisih 12.2 poin persentase).
  if (Number.isFinite(distance)) {
    if (distance > 0) {
      // Sudah di atas resistance. Secara statistik ini zona terbaik,
      // TAPI lihat gate anti-chasing di bawah: atas instruksi user,
      // posisi entry tidak diizinkan membeli di atas resistance.
      // Penalti di sini dibuat ringan saja supaya skornya jujur
      // mencerminkan kualitas setup; yang memblokir pembelian adalah
      // gate eksplisit, bukan skor yang dipaksa jelek.
      if (distance > 8) { score -= 12; reasons.push(`Harga sudah ${distance}% di atas resistance`); }
      else if (distance > 5) { score -= 8; reasons.push(`Harga ${distance}% di atas resistance`); }
      else if (distance > 3) { score -= 5; reasons.push(`Harga ${distance}% di atas resistance`); }
      else { score -= 2; }
    } else if (distance > -2) {
      score -= 22;
      reasons.push(`Menempel resistance (${distance}%) — zona tersangkut, historis win rate terendah`);
    } else if (distance > -5) {
      score -= 20;
      reasons.push(`Dekat resistance (${distance}%) — ruang naik terbatas sebelum tertahan`);
    } else if (distance > -10) {
      score -= 10;
      reasons.push(`Jarak ke resistance ${distance}% — ruang gerak sedang`);
    } else {
      // Pullback dalam: ruang pemulihan lebar, tidak ada resistance
      // terdekat yang menahan. Diberi bonus kecil, bukan sekadar
      // "tanpa penalti", supaya benar-benar terangkat di atas zona mati.
      score += 5;
      reasons.push(`Jauh di bawah resistance (${distance}%) — ruang pemulihan lebar`);
    }
  }

  if (Number.isFinite(rsiValue)) {
    if (rsiValue >= 80) { score -= 20; reasons.push(`RSI ${rsiValue} sangat overbought`); }
    else if (rsiValue >= 75) { score -= 12; reasons.push(`RSI ${rsiValue} overbought`); }
    else if (rsiValue >= 70) { score -= 6; reasons.push(`RSI ${rsiValue} mulai tinggi`); }
  }

  if (exhaustionScore >= 60) { score -= 20; reasons.push("Rally menunjukkan exhaustion tinggi"); }
  else if (exhaustionScore >= 35) { score -= 10; reasons.push("Rally mulai menunjukkan exhaustion"); }

  if (distributionScore >= 60) { score -= 25; reasons.push("Indikasi distribusi tinggi"); }
  else if (distributionScore >= 35) { score -= 12; reasons.push("Ada indikasi distribusi"); }

  if (Number.isFinite(rr)) {
    if (rr < 1) { score -= 25; reasons.push("Risk/reward < 1"); }
    else if (rr < 1.5) { score -= 12; reasons.push("Risk/reward < 1.5"); }
    else if (rr < 2) { score -= 4; }
  }

  if (Number.isFinite(cs) && cs < 0.55) {
    score -= 10;
    reasons.push("Closing strength belum cukup kuat");
  }

  score = Math.round(clamp(score));

  let label = "AVOID";
  if (score >= 80) label = "GOOD";
  else if (score >= 65) label = "FAIR";
  else if (score >= 50) label = "CAUTION";
  else if (score >= 35) label = "POOR";

  let chaseRisk = "LOW";
  if (dcp >= 10 || distance > 8) chaseRisk = "EXTREME";
  else if (dcp >= 8 || distance > 5 || rsiValue >= 80) chaseRisk = "HIGH";
  else if (dcp >= 6 || distance > 3 || rsiValue >= 75) chaseRisk = "MODERATE";

  let decision = "BUY_NOW";
  if (score < 50 || chaseRisk === "EXTREME") decision = "AVOID";
  else if (score < 65 || chaseRisk === "HIGH") decision = "WAIT_PULLBACK";
  else if (score < 80 || chaseRisk === "MODERATE") decision = "WATCH";

  // Anti-chasing guard khusus strategi beli sore -> jual pagi.
  // Opportunity boleh tetap HIGH, tetapi harga tidak boleh otomatis dianggap layak entry.
  if (dcp >= 8) {
    decision = dcp >= 10 ? "AVOID" : "WAIT_PULLBACK";
    score = Math.min(score, dcp >= 10 ? 49 : 64);
    label = dcp >= 10 ? "POOR" : "CAUTION";
  }

  // ============================================================
  // GATE: JANGAN BELI DI ATAS RESISTANCE
  // ============================================================
  //
  // Atas instruksi user (28 Agustus 2026): posisi entry tidak boleh
  // membeli saham yang harganya sudah berada di atas level resistance-nya.
  //
  // CATATAN JUJUR SOAL TRADE-OFF — supaya keputusan ini bisa ditinjau
  // ulang nanti dengan angka, bukan dari ingatan:
  // Secara statistik zona di atas resistance justru berkinerja BAIK
  // (win rate 25.6%, n=532, tertinggi dari semua zona). Memblokirnya
  // berarti melepas 136 dari 1.630 pemenang di dataset 30 hari, sekitar
  // 8% dari total pemenang. Yang ditukar adalah eksposur chase: entry di
  // atas resistance tidak punya level tersangkut yang jelas di bawahnya,
  // jadi kalau gagal, tidak ada acuan support terdekat untuk cut loss.
  //
  // Gate ini sengaja HANYA mematikan kelayakan entry (entryEligible /
  // decision), TIDAK menyentuh opportunityScore — supaya saham seperti
  // ini tetap terlihat di ranking sebagai kandidat pantauan, dan
  // efeknya bisa diukur terpisah di evaluasi.
  let aboveResistanceBlocked = false;
  if (Number.isFinite(distance) && distance > 0) {
    aboveResistanceBlocked = true;
    decision = "WAIT_PULLBACK";
    reasons.push(
      `Harga sudah ${distance}% di atas resistance — entry ditahan, tunggu pullback ke bawah level`
    );
  }

  const entryEligible =
    score >= 65 &&
    decision === "BUY_NOW" &&
    !aboveResistanceBlocked;

  return { score, label, chaseRisk, decision, entryEligible, aboveResistanceBlocked, reasons };
}


// ============================================================
// OPPORTUNITY V3 ENGINE
// ============================================================

function finite(value) {
  return Number.isFinite(Number(value));
}

function n(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function detectOpportunitySetup({
  volumeRatio,
  breakoutDistance,
  rsVsIhsg,
  rsi
}) {
  // Priority deliberately favors the setup that best explains the
  // price/volume structure rather than the old score.
  if (
    finite(breakoutDistance) &&
    breakoutDistance >= 0 &&
    finite(volumeRatio) &&
    volumeRatio >= 1.5 &&
    finite(rsVsIhsg) &&
    rsVsIhsg >= 10
  ) {
    return "CONFIRMED_BREAKOUT";
  }

  if (
    finite(breakoutDistance) &&
    breakoutDistance >= -20 &&
    breakoutDistance < -3 &&
    finite(volumeRatio) &&
    volumeRatio >= 1.5 &&
    finite(rsVsIhsg) &&
    rsVsIhsg >= 10
  ) {
    return "PRE_BREAKOUT_ACCUMULATION";
  }

  if (
    finite(volumeRatio) &&
    volumeRatio >= 3 &&
    finite(rsVsIhsg) &&
    rsVsIhsg >= 10
  ) {
    return "VOLUME_EXPANSION";
  }

  if (
    finite(breakoutDistance) &&
    breakoutDistance <= -10 &&
    finite(volumeRatio) &&
    volumeRatio >= 1.5 &&
    finite(rsi) &&
    rsi >= 35 &&
    rsi <= 65
  ) {
    return "REVERSAL_ABSORPTION";
  }

  return "GENERAL";
}

function calculateOpportunityIndex({
  p3,
  p5,
  p10
}) {
  // Weighted H+1 opportunity:
  // - >=5% is the primary target for the user's strategy.
  // - >=3% captures normal tradable moves.
  // - >=10% identifies explosive upside.
  const composite =
    (0.25 * p3) +
    (0.50 * p5) +
    (0.25 * p10);

  // Keep a familiar 0-100 display while making the score probability-
  // derived rather than a sum of arbitrary technical points.
  // ~15% composite is the empirical baseline; 35% maps to ~82.
  return Math.round(
    clamp(50 + 160 * (composite - 0.15))
  );
}

function buildModelFeatures({
  volume,
  volumeAcceleration,
  breakout,
  relativeStrength,
  riskReward,
  closingStrength,
  rsi,
  macd
}) {
  return {
    rs_vs_ihsg: n(relativeStrength?.vsIhsg, 0),
    volume_ratio: n(volume?.ratio, 0),
    volume_accel_slope_pct: n(
      volumeAcceleration?.slopePercent,
      0
    ),
    breakout_distance_pct: n(
      breakout?.distancePercent,
      0
    ),
    rsi: n(rsi, 50),
    macd: n(macd?.macd, 0),
    risk_reward: n(riskReward, 1),
    closing_strength: n(closingStrength, 0.5)
  };
}

function getOpportunityBlockers({
  liquidity,
  relativeStrength,
  exhaustion,
  distribution
}) {
  const blockers = [];

  if (liquidity?.illiquid) {
    blockers.push("Saham tidak likuid");
  }

  const rs = Number(relativeStrength?.vsIhsg);
  if (Number.isFinite(rs) && rs < -20) {
    blockers.push("Relative strength sangat lemah");
  }

  const exhaustionScore =
    Number(exhaustion?.exhaustionScore);
  if (Number.isFinite(exhaustionScore) &&
      exhaustionScore >= 60) {
    blockers.push("Exhaustion tinggi");
  }

  const distributionScore =
    Number(distribution?.distributionScore);
  if (Number.isFinite(distributionScore) &&
      distributionScore >= 60) {
    blockers.push("Distribution tinggi");
  }

  return [...new Set(blockers)];
}

function setupDetail(setup) {
  switch (setup) {
    case "CONFIRMED_BREAKOUT":
      return "Breakout terkonfirmasi + volume + relative strength";
    case "PRE_BREAKOUT_ACCUMULATION":
      return "Belum breakout, tetapi RS dan volume menunjukkan akumulasi";
    case "VOLUME_EXPANSION":
      return "Ekspansi volume + relative strength kuat";
    case "REVERSAL_ABSORPTION":
      return "Pullback dalam dengan indikasi absorption/reversal";
    default:
      return "Tidak ada setup khusus; dinilai oleh model umum";
  }
}

function probabilityLabel(p) {
  if (!Number.isFinite(p)) return "–";
  return `${(p * 100).toFixed(1)}%`;
}

// ============================================================
// PUBLIC ENGINE
// ============================================================

export function calculateNextDayOpportunity({
  // Legacy score is intentionally accepted for API compatibility but
  // is NOT used as a predictive feature in V3.
  score = null,
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
  const breakoutDistance = Number(
    breakout?.distancePercent
  );
  const rsVsIhsg = Number(relativeStrength?.vsIhsg);
  const rsiValue = Number(rsi);
  const dcp = Number(dailyChangePercent);

  const setup = detectOpportunitySetup({
    volumeRatio,
    breakoutDistance,
    rsVsIhsg,
    rsi: rsiValue
  });

  const features = buildModelFeatures({
    volume,
    volumeAcceleration,
    breakout,
    relativeStrength,
    riskReward,
    closingStrength,
    rsi,
    macd
  });

  // Four independently fitted targets.
  const rawP3 = rawModelProbability("p3", features, setup);
  const rawP5 = rawModelProbability("p5", features, setup);
  const rawP10 = rawModelProbability("p10", features, setup);
  const rawClose2 = rawModelProbability(
    "close2",
    features,
    setup
  );

  const p3 = calibrateProbability("p3", rawP3);
  const p5 = calibrateProbability("p5", rawP5);
  const p10 = calibrateProbability("p10", rawP10);
  const close2 = calibrateProbability(
    "close2",
    rawClose2
  );

  const opportunityScore =
    calculateOpportunityIndex({
      p3,
      p5,
      p10
    });

  const blockers = getOpportunityBlockers({
    liquidity,
    relativeStrength,
    exhaustion,
    distribution
  });

  // Small market-regime adjustment is deliberately NOT fed into the
  // trained probability. It is only a transparency/risk context.
  const regime =
    String(marketTrend ?? "").toUpperCase();

  const regimeNote =
    regime === "BEARISH"
      ? "Trend teknikal saham bearish — confidence diturunkan secara interpretasi"
      : regime === "BULLISH"
        ? "Trend teknikal saham bullish"
        : regime === "SIDEWAYS"
          ? "Trend teknikal saham sideways"
          : null;

  // HIGH is driven by calibrated probability, not by an arbitrary
  // raw-score threshold.
  const high =
    p5 >= 0.35 &&
    p3 >= 0.45 &&
    blockers.length === 0;

  const moderate =
    p5 >= 0.20 &&
    blockers.length === 0;

  let opportunityLabel = "LOW";
  let expectedMoveBand = "LOW";

  if (high) {
    opportunityLabel = "HIGH";
    expectedMoveBand = "HIGH";
  } else if (moderate) {
    opportunityLabel = "MODERATE";
    expectedMoveBand = "MODERATE";
  } else if (p5 >= 0.12) {
    opportunityLabel = "WATCH";
    expectedMoveBand = "WATCH";
  }

  // A blocker changes eligibility/label but never destroys the
  // underlying probability. This preserves useful candidates for review.
  if (blockers.length > 0 && opportunityLabel === "HIGH") {
    opportunityLabel = "MODERATE";
    expectedMoveBand = "MODERATE";
  }

  const eligible =
    high &&
    blockers.length === 0;

  // Close-hold pattern is information only; it is not used to inflate
  // probability. This keeps the model honest.
  let closeHoldPattern = "NOT_APPLICABLE";
  if (
    opportunityLabel === "HIGH" ||
    opportunityLabel === "MODERATE"
  ) {
    closeHoldPattern =
      breakoutDistance < 0 &&
      finite(closingStrength) &&
      Number(closingStrength) < 0.55
        ? "FAVORABLE_HOLD_TO_CLOSE"
        : "CAUTION_GAP_DUMP_RISK";
  }

  const entryQuality = calculateEntryQuality({
    dailyChangePercent: dcp,
    breakout,
    rsi: rsiValue,
    exhaustion,
    distribution,
    riskReward: Number(riskReward),
    closingStrength: Number(closingStrength)
  });

  const tradeDecision = !eligible
    ? "NO_SETUP"
    : entryQuality.decision;

  const breakdown = [
    {
      factor: "MODEL_PROBABILITY_3PCT",
      points: Math.round(p3 * 100),
      detail: probabilityLabel(p3)
    },
    {
      factor: "MODEL_PROBABILITY_5PCT",
      points: Math.round(p5 * 100),
      detail: probabilityLabel(p5)
    },
    {
      factor: "MODEL_PROBABILITY_10PCT",
      points: Math.round(p10 * 100),
      detail: probabilityLabel(p10)
    },
    {
      factor: "MODEL_CLOSE_2PCT",
      points: Math.round(close2 * 100),
      detail: probabilityLabel(close2)
    },
    {
      factor: "SETUP",
      points: 0,
      detail: `${setup}: ${setupDetail(setup)}`
    }
  ];

  if (finite(volumeRatio) && volumeRatio >= 3) {
    breakdown.push({
      factor: "VOLUME_EXPANSION_CONTEXT",
      points: 0,
      detail: `Volume ${volumeRatio.toFixed(2)}x`
    });
  }

  if (finite(rsVsIhsg) && rsVsIhsg >= 20) {
    breakdown.push({
      factor: "STRONG_RS_CONTEXT",
      points: 0,
      detail: `RS vs IHSG +${rsVsIhsg.toFixed(1)}%`
    });
  }

  if (finite(breakoutDistance)) {
    breakdown.push({
      factor: "PRICE_STRUCTURE_CONTEXT",
      points: 0,
      detail: `Distance resistance ${breakoutDistance.toFixed(1)}%`
    });
  }

  if (finite(dcp) && Math.abs(dcp) >= 6) {
    breakdown.push({
      factor: "ALREADY_MOVED_TODAY_INFO",
      points: 0,
      detail:
        `${dcp > 0 ? "+" : ""}${dcp.toFixed(1)}% hari ini — `
        + "volatilitas historis lebih tinggi ke dua arah"
    });
  }

  if (regimeNote) {
    breakdown.push({
      factor: "MARKET_CONTEXT",
      points: 0,
      detail: regimeNote
    });
  }

  return {
    version: OPPORTUNITY_MODEL_VERSION,

    opportunityScore,
    opportunityProbability: p3 * 100,
    opportunityProbability5Pct: p5 * 100,
    opportunityProbability10Pct: p10 * 100,
    nextDayClose2PctProbability: close2 * 100,

    rawProbability3Pct: rawP3,
    rawProbability5Pct: rawP5,
    rawProbability10Pct: rawP10,
    rawClose2PctProbability: rawClose2,

    opportunityLabel,
    expectedMoveBand,

    coreSetup: setup,
    setupDetail: setupDetail(setup),

    eligible,
    closeHoldPattern,

    entryQualityScore: entryQuality.score,
    entryQualityLabel: entryQuality.label,
    chaseRisk: entryQuality.chaseRisk,
    entryDecision: entryQuality.decision,
    entryEligible: entryQuality.entryEligible,
    aboveResistanceBlocked:
      entryQuality.aboveResistanceBlocked,
    entryQualityReasons: entryQuality.reasons,
    tradeDecision,

    preBreakoutAccumulation:
      setup === "PRE_BREAKOUT_ACCUMULATION",

    volatilityNote:
      finite(dcp) && Math.abs(dcp) >= 6
        ? `Sudah ${dcp > 0 ? "naik" : "turun"} ${Math.abs(dcp).toFixed(1)}% hari ini — volatilitas historis lebih tinggi ke dua arah`
        : null,

    inputs: {
      volumeAccelerationPercent:
        Number.isFinite(
          Number(volumeAcceleration?.slopePercent)
        )
          ? Number(volumeAcceleration.slopePercent)
          : null,

      volumeRatio:
        finite(volumeRatio)
          ? volumeRatio
          : null,

      breakoutDistancePercent:
        finite(breakoutDistance)
          ? breakoutDistance
          : null,

      baseScore:
        finite(score)
          ? Number(score)
          : null,

      relativeStrengthVsIhsg:
        finite(rsVsIhsg)
          ? rsVsIhsg
          : null,

      relativeStrengthLabel:
        relativeStrength?.label ?? null,

      closingStrength:
        finite(closingStrength)
          ? Number(closingStrength)
          : null,

      marketTrend: regime || null,

      rsi:
        finite(rsiValue)
          ? rsiValue
          : null,

      macd:
        finite(macd?.macd)
          ? Number(macd.macd)
          : null,

      dailyChangePercent:
        finite(dcp)
          ? dcp
          : null
    },

    breakdown,
    blockers
  };
}

export function estimateOpportunityProbability5Pct(score) {
  // Compatibility helper. V3's authoritative probability is the
  // feature-model probability returned by calculateNextDayOpportunity().
  if (!Number.isFinite(Number(score))) return null;
  return null;
}

export function estimateOpportunityProbability(score) {
  // Compatibility helper retained so older imports do not break.
  if (!Number.isFinite(Number(score))) return null;
  return null;
}

export default calculateNextDayOpportunity;
