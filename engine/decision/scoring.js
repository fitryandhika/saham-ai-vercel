export function calculateScore(indicators) {
  let score = 0;

  // EMA Trend
  if (indicators.ema20 > indicators.ema50) score += 25;

  // RSI
  if (indicators.rsi >= 50 && indicators.rsi <= 70) score += 20;

  // MACD
  if (indicators.macd > indicators.signal) score += 20;

  // Momentum
  if (indicators.momentum > 0) score += 15;

  // Volume
  if (indicators.volumeSpike) score += 20;

  return Math.min(score, 100);
}

export default calculateScore;