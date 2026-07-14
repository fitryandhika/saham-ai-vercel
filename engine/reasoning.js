export function calculateConfidence(data) {

  let confidence = 40;

  if (data.close > data.sma20) confidence += 10;
  if (data.sma20 > data.sma50) confidence += 10;
  if (data.ema9 > data.ema20) confidence += 10;

  if (data.macd && data.macd.macd > 0)
    confidence += 10;

  if (data.riskReward >= 2)
    confidence += 20;
  else if (data.riskReward < 1)
    confidence -= 15;

  return Math.max(0, Math.min(confidence, 100));
}

export function generateReasons(data) {

  const reasons = [];

  if (data.close > data.sma20)
    reasons.push("Harga berada di atas SMA20.");
  else
    reasons.push("Harga berada di bawah SMA20.");

  if (data.sma20 > data.sma50)
    reasons.push("SMA20 berada di atas SMA50.");

  if (data.ema9 > data.ema20)
    reasons.push("EMA9 berada di atas EMA20.");

  if (data.macd && data.macd.macd > 0)
    reasons.push("MACD bernilai positif.");

  if (data.rsi > 70)
    reasons.push("RSI overbought.");
  else if (data.rsi < 30)
    reasons.push("RSI oversold.");
  else
    reasons.push("RSI berada di zona sehat.");

  if (data.riskReward >= 2)
    reasons.push("Risk/Reward sangat baik.");
  else if (data.riskReward >= 1)
    reasons.push("Risk/Reward cukup baik.");
  else
    reasons.push("Risk/Reward kurang menarik.");

  if (data.breakout && data.breakout.isBreakout) {
    const kekuatan = data.breakout.level === "STRONG_BREAKOUT"
      ? "kuat (volume eksplosif)"
      : "dengan volume mendukung";
    reasons.push(
      `Breakout resistance ${data.breakout.lookback} hari ${kekuatan} (+${data.breakout.distancePercent}% dari level).`
    );
  }

  if (typeof data.closingStrength === "number") {
    if (data.closingStrength >= 0.8)
      reasons.push("Closing strength sangat kuat — close dekat high hari ini.");
    else if (data.closingStrength < 0.2)
      reasons.push("Closing strength lemah — close dekat low, seller dominan.");
  }

  if (data.volumeAcceleration && data.volumeAcceleration.accelerating)
    reasons.push("Volume berakselerasi 3 hari terakhir.");

  if (data.relativeStrength) {
    if (data.relativeStrength.label === "JAUH OUTPERFORM" || data.relativeStrength.label === "OUTPERFORM")
      reasons.push("Outperform IHSG/sektor.");
    else if (data.relativeStrength.label === "JAUH UNDERPERFORM" || data.relativeStrength.label === "UNDERPERFORM")
      reasons.push("Underperform IHSG/sektor.");
  }

  return reasons;
}