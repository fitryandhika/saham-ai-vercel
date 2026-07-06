export function generateReasons(data) {

  const reasons = [];

  if (data.close > data.sma20) {
    reasons.push("Harga berada di atas SMA20.");
  } else {
    reasons.push("Harga berada di bawah SMA20.");
  }

  if (data.sma20 > data.sma50) {
    reasons.push("SMA20 berada di atas SMA50.");
  }

  if (data.ema9 > data.ema20) {
    reasons.push("EMA9 berada di atas EMA20.");
  }

  if (data.rsi >= 45 && data.rsi <= 65) {
    reasons.push("RSI berada pada zona sehat.");
  } else if (data.rsi > 70) {
    reasons.push("RSI menunjukkan kondisi overbought.");
  } else if (data.rsi < 30) {
    reasons.push("RSI menunjukkan kondisi oversold.");
  }

  if (data.macd && data.macd.macd > 0) {
    reasons.push("MACD bernilai positif.");
  }

  if (data.riskReward >= 2) {
    reasons.push("Risk/Reward sangat baik.");
  } else if (data.riskReward >= 1) {
    reasons.push("Risk/Reward cukup baik.");
  } else {
    reasons.push("Risk/Reward kurang menarik.");
  }

  return reasons;
}

export function calculateConfidence(data) {

  let confidence = 50;

  if (data.close > data.sma20) confidence += 10;
  if (data.sma20 > data.sma50) confidence += 10;
  if (data.ema9 > data.ema20) confidence += 10;
  if (data.macd && data.macd.macd > 0) confidence += 10;
  if (data.riskReward >= 2) confidence += 10;

  return Math.min(confidence, 100);
}