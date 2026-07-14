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

  // Breakout — sinyal kuat, dikasih bobot besar dan TIDAK dihukum
  // kalau tidak breakout (breakout absen = netral, bukan minus).
  if (data.breakout) {
    if (data.breakout.level === "STRONG_BREAKOUT") score += 20;
    else if (data.breakout.level === "BREAKOUT") score += 15;
    else if (data.breakout.level === "WEAK_BREAKOUT") score += 5;
  }

  // Closing Strength — close dekat high = buyer dominan menjelang close.
  if (typeof data.closingStrength === "number") {
    if (data.closingStrength >= 0.8) score += 8;
    else if (data.closingStrength >= 0.6) score += 4;
    else if (data.closingStrength < 0.2) score -= 6;
    else if (data.closingStrength < 0.4) score -= 3;
  }

  // Volume Acceleration (slope 3 hari) — partisipasi volume yang
  // membangun lebih meyakinkan daripada lonjakan satu hari.
  if (data.volumeAcceleration) {
    if (data.volumeAcceleration.accelerating) score += 8;
    else if (data.volumeAcceleration.slopePercent <= -20) score -= 4;
  }

  // Relative Strength vs IHSG / sektor — saham yang outperform pasar
  // & sektornya sendiri lebih meyakinkan daripada yang cuma ikut naik.
  if (data.relativeStrength) {
    const label = data.relativeStrength.label;
    if (label === "JAUH OUTPERFORM") score += 8;
    else if (label === "OUTPERFORM") score += 4;
    else if (label === "UNDERPERFORM") score -= 3;
    else if (label === "JAUH UNDERPERFORM") score -= 6;
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