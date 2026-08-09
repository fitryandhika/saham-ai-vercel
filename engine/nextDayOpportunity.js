// ==========================
// Next-Day Opportunity Engine V1
// ==========================
// Tujuan:
// Menilai peluang harga bergerak naik BESOK dari harga CLOSE hari ini.
// Target utama: Close H -> High H+1.
// Ini bukan gap/open predictor dan tidak mengubah signal BUY/SELL lama.
//
// Pola awal berasal dari analisis scan_history user:
// - volume acceleration tinggi
// - harga masih berada di bawah resistance (pre-breakout)
// - volume ratio sebagai konfirmasi
// - RS sebagai konfirmasi
// - exhaustion/distribution/liquidity sebagai penalti
//
// Threshold empiris dipakai sebagai scoring, bukan hard BUY filter,
// agar tidak meng-overfit dataset yang masih terbatas.

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
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
  riskReward = null
} = {}) {
  let opportunityScore = 50;
  const breakdown = [];
  const blockers = [];

  const slopePercent = Number(volumeAcceleration?.slopePercent ?? 0);
  const volumeRatio = Number(volume?.ratio ?? 0);
  const distancePercent = Number(breakout?.distancePercent ?? 0);

  // ------------------------------------------------------------
  // CORE: PRE-BREAKOUT ACCUMULATION
  // Empirical pattern:
  // volume acceleration >= 34% + distance to resistance <= -6.7%
  // ------------------------------------------------------------
  const preBreakout =
    slopePercent >= 34 &&
    distancePercent <= -6.7 &&
    !breakout?.isBreakout;

  if (preBreakout) {
    opportunityScore += 30;
    breakdown.push({
      factor: "PRE_BREAKOUT_ACCUMULATION",
      points: 30
    });
  } else {
    // Gradual scoring around the empirical zone; no hard filter.
    if (slopePercent >= 34) {
      opportunityScore += 18;
      breakdown.push({ factor: "HIGH_VOLUME_ACCELERATION", points: 18 });
    } else if (slopePercent >= 15) {
      opportunityScore += 9;
      breakdown.push({ factor: "POSITIVE_VOLUME_ACCELERATION", points: 9 });
    } else if (slopePercent < 0) {
      opportunityScore -= 6;
      breakdown.push({ factor: "DECLINING_VOLUME_ACCELERATION", points: -6 });
    }

    if (distancePercent <= -6.7 && distancePercent >= -20) {
      opportunityScore += 12;
      breakdown.push({ factor: "ROOM_BELOW_RESISTANCE", points: 12 });
    } else if (distancePercent <= -3) {
      opportunityScore += 6;
      breakdown.push({ factor: "SOME_ROOM_BELOW_RESISTANCE", points: 6 });
    }
  }

  // Volume confirmation.
  if (volumeRatio >= 2) {
    opportunityScore += 15;
    breakdown.push({ factor: "VOLUME_RATIO_GE_2", points: 15 });
  } else if (volumeRatio >= 1.5) {
    opportunityScore += 10;
    breakdown.push({ factor: "VOLUME_RATIO_GE_1_5", points: 10 });
  } else if (volumeRatio >= 1.2) {
    opportunityScore += 5;
    breakdown.push({ factor: "VOLUME_RATIO_GE_1_2", points: 5 });
  }

  // Relative strength confirmation.
  const rsLabel = relativeStrength?.label;
  if (rsLabel === "JAUH OUTPERFORM") {
    opportunityScore += 10;
    breakdown.push({ factor: "RS_STRONG_OUTPERFORM", points: 10 });
  } else if (rsLabel === "OUTPERFORM") {
    opportunityScore += 7;
    breakdown.push({ factor: "RS_OUTPERFORM", points: 7 });
  } else if (rsLabel === "UNDERPERFORM") {
    opportunityScore -= 7;
    breakdown.push({ factor: "RS_UNDERPERFORM", points: -7 });
  } else if (rsLabel === "JAUH UNDERPERFORM") {
    opportunityScore -= 12;
    breakdown.push({ factor: "RS_STRONG_UNDERPERFORM", points: -12 });
  }

  // Moderate score is intentionally preferred over "already perfect".
  const baseScore = Number(score);
  if (Number.isFinite(baseScore)) {
    if (baseScore >= 50 && baseScore < 75) {
      opportunityScore += 8;
      breakdown.push({ factor: "MODERATE_CORE_SCORE", points: 8 });
    } else if (baseScore >= 75 && baseScore < 85) {
      opportunityScore += 3;
      breakdown.push({ factor: "HIGH_CORE_SCORE", points: 3 });
    } else if (baseScore >= 90) {
      opportunityScore -= 5;
      breakdown.push({ factor: "VERY_HIGH_SCORE_OVERHEATED_CHECK", points: -5 });
    } else if (baseScore < 40) {
      opportunityScore -= 8;
      breakdown.push({ factor: "WEAK_CORE_SCORE", points: -8 });
    }
  }

  // Exhaustion / distribution are veto-like penalties, not absolute vetoes.
  const exhaustionLevel = String(exhaustion?.level ?? exhaustion?.label ?? "").toUpperCase();
  if (exhaustionLevel.includes("HIGH") || exhaustionLevel.includes("EXTREME")) {
    opportunityScore -= 18;
    breakdown.push({ factor: "HIGH_EXHAUSTION", points: -18 });
    blockers.push("Exhaustion tinggi");
  }

  const distributionLevel = String(distribution?.level ?? distribution?.label ?? "").toUpperCase();
  if (distributionLevel.includes("HIGH") || distributionLevel.includes("STRONG")) {
    opportunityScore -= 18;
    breakdown.push({ factor: "HIGH_DISTRIBUTION", points: -18 });
    blockers.push("Distribution tinggi");
  }

  // Liquidity guard.
  if (liquidity?.illiquid) {
    opportunityScore = 0;
    breakdown.push({ factor: "ILLIQUID_GUARD", points: -100 });
    blockers.push("Saham tidak likuid");
  }

  // Risk/reward confirmation.
  if (Number.isFinite(Number(riskReward))) {
    const rr = Number(riskReward);
    if (rr >= 2) {
      opportunityScore += 5;
      breakdown.push({ factor: "RR_GE_2", points: 5 });
    } else if (rr < 1) {
      opportunityScore -= 8;
      breakdown.push({ factor: "RR_LT_1", points: -8 });
      blockers.push("Risk/reward < 1");
    }
  }

  opportunityScore = Math.round(clamp(opportunityScore));

  let label = "LOW";
  let expectedMoveBand = "LOW";

  if (opportunityScore >= 75) {
    label = "HIGH";
    expectedMoveBand = "HIGH";
  } else if (opportunityScore >= 60) {
    label = "MODERATE";
    expectedMoveBand = "MODERATE";
  } else if (opportunityScore >= 45) {
    label = "WATCH";
    expectedMoveBand = "WATCH";
  }

  const eligible =
    !liquidity?.illiquid &&
    opportunityScore >= 60 &&
    !blockers.includes("Exhaustion tinggi") &&
    !blockers.includes("Distribution tinggi") &&
    !blockers.includes("Saham tidak likuid");

  let coreSetup = "NONE";
  if (preBreakout) coreSetup = "PRE_BREAKOUT_ACCUMULATION";
  else if (slopePercent >= 34) coreSetup = "VOLUME_ACCELERATION";
  else if (volumeRatio >= 1.5 && distancePercent < 0) coreSetup = "VOLUME_PRE_BREAKOUT";

  return {
    version: "v1-shadow",
    opportunityScore,
    opportunityLabel: label,
    expectedMoveBand,
    coreSetup,
    eligible,
    preBreakoutAccumulation: preBreakout,
    inputs: {
      volumeAccelerationPercent: slopePercent,
      volumeRatio,
      breakoutDistancePercent: distancePercent,
      baseScore: Number.isFinite(baseScore) ? baseScore : null,
      relativeStrengthLabel: rsLabel ?? null
    },
    breakdown,
    blockers
  };
}

export default calculateNextDayOpportunity;
