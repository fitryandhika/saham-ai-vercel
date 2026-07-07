export function calculateScore(data) {

  let score = 50;

  // Trend
  if (data.close > data.sma20) score += 10;
  if (data.sma20 > data.sma50) score += 10;

  // EMA
  if (data.ema9 > data.ema20) score += 10;

  // RSI
  if (data.rsi >= 45 && data.rsi <= 65) {
    score += 10;
  } else if (data.rsi > 70) {
    score -= 10;
  } else if (data.rsi < 30) {
    score += 8;
  }

  // MACD
  if (data.macd && data.macd.macd > 0) {
    score += 10;
  }
  
  // Volume
  if (data.volume) {

  if (data.volume.signal === "EXPLOSIVE") {
    score += 10;
  } else if (data.volume.signal === "HIGH") {
    score += 5;
  } else if (data.volume.signal === "LOW") {
    score -= 5;
  }

}

  // Risk Reward
  if (data.riskReward >= 2) {
    score += 10;
  } else if (data.riskReward < 1) {
    score -= 15;
  }

  return Math.max(0, Math.min(score, 100));
}

export function recommendation(score) {

  if (score >= 90) return "STRONG BUY";
  if (score >= 75) return "BUY";
  if (score >= 55) return "HOLD";
  if (score >= 35) return "SELL";

  return "STRONG SELL";
}