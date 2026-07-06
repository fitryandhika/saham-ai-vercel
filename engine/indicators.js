export function calculateTrend(close, ma20) {
  return close > ma20 ? "UPTREND" : "DOWNTREND";
}

export function calculateRecommendation(close, ma20, rsi) {
  if (close > ma20 && rsi < 70) {
    return "BUY";
  }

  if (close < ma20 && rsi > 30) {
    return "SELL";
  }

  return "HOLD";
}

export function calculateConfidence(close, ma20, rsi) {
  let score = 60;

  if (close > ma20) score += 15;
  if (rsi >= 40 && rsi <= 60) score += 10;
  if (Math.abs(close - ma20) > 20) score += 5;

  return Math.min(score, 95);
}