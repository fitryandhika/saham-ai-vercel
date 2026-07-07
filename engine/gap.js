export function getGapProbability({
  score,
  confidence,
  momentum,
  volume,
  rsi,
  marketTrend
}) {

  let probability = 50;

  // Trend
  if (marketTrend === "BULLISH")
    probability += 15;

  if (marketTrend === "BEARISH")
    probability -= 15;

  // AI Score
  probability += (score - 50) * 0.20;

  // Confidence
  probability += (confidence - 50) * 0.15;

  // Momentum
  probability += (momentum.score - 50) * 0.15;

  // Volume
  if (volume.signal === "HIGH")
    probability += 8;

  if (volume.signal === "LOW")
    probability -= 8;

  // RSI
  if (rsi > 70)
    probability -= 8;

  if (rsi < 30)
    probability += 5;

  probability = Math.round(
    Math.max(5, Math.min(probability, 95))
  );

  let outlook = "NEUTRAL";

  if (probability >= 75)
    outlook = "HIGH GAP UP";

  else if (probability >= 60)
    outlook = "POSSIBLE GAP UP";

  else if (probability <= 35)
    outlook = "HIGH GAP DOWN";

  else if (probability <= 45)
    outlook = "POSSIBLE GAP DOWN";

  return {
    probability: `${probability}%`,
    outlook
  };
}