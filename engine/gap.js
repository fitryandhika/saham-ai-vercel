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
    probability += 10;

  if (marketTrend === "BEARISH")
    probability -= 10;

  // AI Score — bobot diturunkan, faktor ini berkorelasi dengan
  // confidence & momentum di bawah (sama-sama turunan RSI/MACD/EMA/volume)
  probability += (score - 50) * 0.12;

  // Confidence
  probability += (confidence - 50) * 0.08;

  // Momentum
  probability += (momentum.score - 50) * 0.08;

  // Volume
  if (volume.signal === "HIGH")
    probability += 5;

  if (volume.signal === "LOW")
    probability -= 5;

  // RSI
  if (rsi > 70)
    probability -= 5;

  if (rsi < 30)
    probability += 3;

  // Plafon diturunkan dari 95/5 ke 80/20 — model ini berbasis data
  // harian, jadi kepastian setinggi 90%+ tidak realistis untuk
  // memprediksi gap overnight.
  probability = Math.round(
    Math.max(20, Math.min(probability, 80))
  );

  let outlook = "NEUTRAL";

  if (probability >= 70)
    outlook = "HIGH GAP UP";

  else if (probability >= 58)
    outlook = "POSSIBLE GAP UP";

  else if (probability <= 30)
    outlook = "HIGH GAP DOWN";

  else if (probability <= 42)
    outlook = "POSSIBLE GAP DOWN";

  return {
    probability: `${probability}%`,
    outlook
  };
}
