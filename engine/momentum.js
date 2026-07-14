export function getMomentum({
  close,
  sma20,
  ema9,
  ema20,
  rsi,
  macd,
  volume
}) {

  let score = 0;

  // Harga
  if (close > sma20)
    score += 20;

  // EMA
  if (ema9 > ema20)
    score += 20;

  // MACD
  if (macd && macd.macd > 0)
    score += 20;

  // RSI
  if (rsi >= 45 && rsi <= 65)
    score += 20;
  else if (rsi > 70)
    score -= 10;

  // Volume
  if (volume.signal === "HIGH")
    score += 20;
  else if (volume.signal === "LOW")
    score -= 10;

  score = Math.max(0, Math.min(score, 100));

  let strength = "WEAK";

  if (score >= 80)
    strength = "VERY STRONG";
  else if (score >= 60)
    strength = "STRONG";
  else if (score >= 40)
    strength = "MODERATE";

  return {
    score,
    strength
  };
}