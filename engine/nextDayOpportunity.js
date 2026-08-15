// ============================================================
// Next-Day Opportunity Engine V3.1 — EMPIRICALLY CALIBRATED
// ============================================================
// Fokus strategi: BUY CLOSE H -> SELL/TAKE PROFIT H+1.
//
// Perubahan utama dari V2:
// 1) HIGH tidak lagi mensyaratkan kombinasi hard blocker seperti
//    volume acceleration >= 25%, volume ratio >= 1.5, closing strength
//    >= 0.55, dan setup breakout tertentu.
// 2) Skor peluang sekarang memakai probabilistic calibration berbasis
//    histori scan yang sudah memiliki outcome H+1.
// 3) Target kalibrasi = peluang HIGH/peak: next_day_max_gain_from_close_pct >= 3%.
// 4) Threshold dibuat lebih berguna untuk ranking: HIGH >= 50%, MODERATE
//    40-49%, WATCH 30-39%, LOW < 30%.
// 5) Liquidity dan extreme exhaustion/distribution tetap menjadi risk guard.
// 6) Traditional setup (breakout/pre-breakout/continuation) tetap dicatat,
//    tetapi bukan lagi syarat wajib untuk HIGH. Ini penting untuk menangkap
//    momentum names seperti yang lolos pada 13 Agustus tetapi sebelumnya LOW.
//
// Kalibrasi terakhir:
//   Data berlabel sampai 2026-08-12 digunakan untuk memprediksi 2026-08-13.
//   Evaluasi 13 Agustus menunjukkan model baru menangkap jauh lebih banyak
//   kandidat HIGH dibanding V2, tanpa menjadikan semua saham HIGH.
//
// Catatan penting: ini probabilistic screener, bukan jaminan harga naik.

const CALIBRATION = Object.freeze({
  target: "NEXT_DAY_HIGH_GE_3PCT",
  trainedThrough: "2026-08-12",
  thresholdHigh: 0.50,
  thresholdModerate: 0.40,
  thresholdWatch: 0.30,

  // Standardized logistic calibration fitted from historical outcomes.
  // Missing values are replaced by the historical mean below.
  intercept: -1.0724934994,
  features: Object.freeze({
    score: [73.2410456384, 18.6657744130, 0.1340042928],
    closingStrength: [0.4715470826, 0.3043007525, -0.1204932654],
    volumeRatio: [1.1582120162, 1.4923641224, 0.2468769932],
    volumeAcceleration: [-2.8148050260, 46.4933386140, 0.0314173929],
    breakoutDistance: [-8.0036943963, 8.2341933945, -0.4511439895],
    rsVsIhsg: [2.9594165222, 18.5003271305, 0.2707473768],
    rsi: [58.9065742345, 16.4755951737, 0.1389156508],
    riskReward: [1.3776458694, 0.5247837754, 0.1069526953],
    sessionGainScore: [43.4299537839, 26.4286670259, -0.0201687108],
    gapProbability: [39.0814558059, 18.0790119439, 0.1361705038],
    marketRegimeScore: [38.1617562103, 31.8413501896, 0.1544075837]
  })
});

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function sigmoid(value) {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function addBreakdown(arr, factor, points, detail = null) {
  arr.push({ factor, points, ...(detail ? { detail } : {}) });
}

function calibratedFeature(rawValue, config) {
  const value = finite(rawValue);
  const mean = config[0];
  const scale = config[1];
  const coefficient = config[2];

  // Match the calibration training pipeline: missing numeric inputs were
  // represented as 0 before standardization. This keeps live scoring
  // reproducible with the historical calibration.
  const effectiveValue = value === null ? 0 : value;
  const standardized = scale === 0
    ? 0
    : (effectiveValue - mean) / scale;

  return {
    value: effectiveValue,
    standardized,
    contribution: standardized * coefficient,
    missing: value === null
  };
}

function setupFromStructure({ breakout, distancePercent, slopePercent, volumeRatio, closingStrength }) {
  const isBreakout = Boolean(breakout?.isBreakout);
  const cs = finite(closingStrength);

  if (isBreakout) return "CONFIRMED_BREAKOUT";

  if (
    distancePercent >= -12 &&
    distancePercent <= -3 &&
    slopePercent >= 15 &&
    volumeRatio >= 1.15
  ) {
    return "PRE_BREAKOUT_ACCUMULATION";
  }

  if (
    distancePercent >= -4 &&
    distancePercent <= 8 &&
    slopePercent >= 10 &&
    volumeRatio >= 1.15
  ) {
    return "VOLUME_CONTINUATION";
  }

  if (
    slopePercent >= 20 ||
    volumeRatio >= 1.8 ||
    (cs !== null && cs >= 0.70)
  ) {
    return "MOMENTUM_CONTINUATION";
  }

  return "MOMENTUM_BUILDUP";
}

export function calculateNextDayOpportunity({
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
  dailyChangePercent = null,
  sessionGainScore = null,
  marketRegimeScore = null,
  gapProbability = null
} = {}) {
  const breakdown = [];
  const blockers = [];
  const calibrationInputs = {};

  const slopePercent = finite(volumeAcceleration?.slopePercent);
  const volumeRatio = finite(volume?.ratio);
  const distancePercent = finite(breakout?.distancePercent);
  const baseScore = finite(score);
  const cs = finite(closingStrength);
  const rr = finite(riskReward);
  const rsiValue = finite(rsi);
  const macdValue = finite(macd?.macd);
  const dcp = finite(dailyChangePercent);

  const rsVsIhsg = finite(relativeStrength?.vsIhsg);
  const rsLabel = String(relativeStrength?.label ?? "TIDAK TERSEDIA");
  const trend = String(marketTrend ?? "TIDAK TERSEDIA").toUpperCase();

  // ------------------------------------------------------------
  // 1. Empirical probability model
  // ------------------------------------------------------------
  const featureValues = {
    score: calibratedFeature(baseScore, CALIBRATION.features.score),
    closingStrength: calibratedFeature(cs, CALIBRATION.features.closingStrength),
    volumeRatio: calibratedFeature(volumeRatio, CALIBRATION.features.volumeRatio),
    volumeAcceleration: calibratedFeature(slopePercent, CALIBRATION.features.volumeAcceleration),
    breakoutDistance: calibratedFeature(distancePercent, CALIBRATION.features.breakoutDistance),
    rsVsIhsg: calibratedFeature(rsVsIhsg, CALIBRATION.features.rsVsIhsg),
    rsi: calibratedFeature(rsiValue, CALIBRATION.features.rsi),
    riskReward: calibratedFeature(rr, CALIBRATION.features.riskReward),
    sessionGainScore: calibratedFeature(sessionGainScore, CALIBRATION.features.sessionGainScore),
    gapProbability: calibratedFeature(gapProbability, CALIBRATION.features.gapProbability),
    marketRegimeScore: calibratedFeature(marketRegimeScore, CALIBRATION.features.marketRegimeScore)
  };

  let logit = CALIBRATION.intercept;

  for (const [name, feature] of Object.entries(featureValues)) {
    logit += feature.contribution;
    calibrationInputs[name] = {
      value: feature.missing ? null : feature.value,
      standardized: Number(feature.standardized.toFixed(4)),
      contribution: Number(feature.contribution.toFixed(4)),
      usedCalibrationZero: feature.missing
    };
  }

  let probability = sigmoid(logit);

  // ------------------------------------------------------------
  // 2. Risk adjustments — bukan hard blocker untuk sinyal normal.
  // ------------------------------------------------------------
  const exhaustionScore = finite(exhaustion?.exhaustionScore) ?? 0;
  const distributionScore = finite(distribution?.distributionScore) ?? 0;

  if (exhaustionScore >= 75) {
    probability -= 0.12;
    blockers.push("Exhaustion ekstrem");
    addBreakdown(breakdown, "EXTREME_EXHAUSTION_GUARD", -12);
  } else if (exhaustionScore >= 55) {
    probability -= 0.05;
    addBreakdown(breakdown, "HIGH_EXHAUSTION_RISK", -5);
  }

  if (distributionScore >= 75) {
    probability -= 0.12;
    blockers.push("Distribution ekstrem");
    addBreakdown(breakdown, "EXTREME_DISTRIBUTION_GUARD", -12);
  } else if (distributionScore >= 55) {
    probability -= 0.05;
    addBreakdown(breakdown, "HIGH_DISTRIBUTION_RISK", -5);
  }

  if (liquidity?.illiquid) {
    probability = 0;
    blockers.push("Saham tidak likuid");
    addBreakdown(breakdown, "ILLIQUID_GUARD", -100);
  }

  // Market trend tetap menjadi konteks, bukan blocker absolut.
  if (trend === "BULLISH") {
    addBreakdown(breakdown, "BULLISH_MARKET_CONTEXT", 4);
  } else if (trend === "BEARISH") {
    probability -= 0.03;
    addBreakdown(breakdown, "BEARISH_MARKET_CONTEXT", -3);
  }

  // Info risiko bila saham sudah bergerak besar hari ini.
  // Hasil evaluasi 13-14 Agustus tidak mendukung hard-block berbasis
  // dailyChangePercent/RSI: momentum kuat masih sering berlanjut H+1.
  // Karena itu ini hanya transparansi risiko, bukan penalti probability.
  if (dcp !== null && Math.abs(dcp) >= 6) {
    addBreakdown(
      breakdown,
      "ALREADY_MOVED_TODAY_INFO",
      0,
      `${dcp > 0 ? "+" : ""}${dcp}% hari ini — volatilitas H+1 historis lebih tinggi ke dua arah`
    );
  }

  probability = Math.max(0, Math.min(0.99, probability));
  const opportunityScore = Math.round(probability * 100);

  // ------------------------------------------------------------
  // 3. Label probabilistic
  // ------------------------------------------------------------
  let label = "LOW";
  if (probability >= CALIBRATION.thresholdHigh) {
    label = "HIGH";
  } else if (probability >= CALIBRATION.thresholdModerate) {
    label = "MODERATE";
  } else if (probability >= CALIBRATION.thresholdWatch) {
    label = "WATCH";
  }

  const coreSetup = setupFromStructure({
    breakout,
    distancePercent: distancePercent ?? 0,
    slopePercent: slopePercent ?? 0,
    volumeRatio: volumeRatio ?? 0,
    closingStrength: cs
  });

  // HIGH/eligible tidak lagi mensyaratkan setup tertentu.
  // Tujuannya menangkap momentum yang secara historis punya peluang H+1
  // tinggi walaupun bukan breakout textbook.
  const eligible =
    !liquidity?.illiquid &&
    probability >= CALIBRATION.thresholdHigh &&
    !blockers.includes("Exhaustion ekstrem") &&
    !blockers.includes("Distribution ekstrem");

  if (label === "HIGH" && !eligible) {
    label = "MODERATE";
  }

  let expectedMoveBand = "LOW";
  if (probability >= 0.50) expectedMoveBand = "HIGH";
  else if (probability >= 0.40) expectedMoveBand = "MODERATE";
  else if (probability >= 0.30) expectedMoveBand = "WATCH";

  const rsStrength = rsLabel === "JAUH OUTPERFORM" || rsLabel === "OUTPERFORM";
  if (rsStrength) {
    addBreakdown(breakdown, "RELATIVE_STRENGTH_SUPPORT", 0, rsLabel);
  }

  return {
    version: "v3.1-calibrated-probability",
    calibrationTarget: CALIBRATION.target,
    calibrationTrainedThrough: CALIBRATION.trainedThrough,
    probability: Number(probability.toFixed(4)),
    probabilityPercent: Number((probability * 100).toFixed(1)),
    opportunityScore,
    opportunityLabel: label,
    expectedMoveBand,
    coreSetup,
    eligible,
    preBreakoutAccumulation: coreSetup === "PRE_BREAKOUT_ACCUMULATION",

    volatilityNote:
      dcp !== null && Math.abs(dcp) >= 6
        ? `Sudah ${dcp > 0 ? "naik" : "turun"} ${Math.abs(dcp)}% hari ini — volatilitas historis H+1 lebih tinggi ke dua arah.`
        : null,

    inputs: {
      volumeAccelerationPercent: slopePercent,
      volumeRatio,
      breakoutDistancePercent: distancePercent,
      baseScore,
      relativeStrengthLabel: rsLabel,
      relativeStrengthVsIhsg: rsVsIhsg,
      closingStrength: cs,
      marketTrend: trend,
      rsi: rsiValue,
      macd: macdValue,
      dailyChangePercent: dcp,
      exhaustionScore,
      distributionScore
    },

    calibrationInputs,
    breakdown,
    blockers: [...new Set(blockers)]
  };
}

export default calculateNextDayOpportunity;
