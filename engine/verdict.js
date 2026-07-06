export function getMarketTrend({
  close,
  sma20,
  sma50,
  ema9,
  ema20,
  macd
}) {

  let bullish = 0;

  if (close > sma20) bullish++;
  if (sma20 > sma50) bullish++;
  if (ema9 > ema20) bullish++;
  if (macd.macd > 0) bullish++;

  if (bullish >= 3) return "BULLISH";
  if (bullish >= 2) return "SIDEWAYS";

  return "BEARISH";
}

export function getRiskLevel({
  rsi,
  riskReward
}) {

  if (rsi >= 70 || rsi <= 30) {
    return "HIGH";
  }

  if (riskReward >= 2) {
    return "LOW";
  }

  if (riskReward >= 1) {
    return "MEDIUM";
  }

  return "HIGH";
}

export function getEntryTiming({
  signal,
  rsi,
  riskReward
}) {

  if (
    (signal === "BUY" || signal === "STRONG BUY") &&
    rsi < 70 &&
    riskReward >= 1.5
  ) {
    return "NOW";
  }

  if (signal === "HOLD") {
    return "WAIT";
  }

  return "AVOID";
}

export function getFinalVerdict({
  score,
  signal,
  confidence,
  entry,
  riskLevel
}) {

  // STRONG BUY
  if (
    signal === "STRONG BUY" &&
    score >= 85 &&
    confidence >= 65 &&
    entry === "NOW" &&
    riskLevel !== "HIGH"
  ) {
    return "Layak dibeli sekarang.";
  }

  // BUY
  if (
    signal === "BUY" &&
    score >= 70 &&
    confidence >= 60 &&
    entry !== "AVOID"
  ) {
    return "Menarik untuk dipertimbangkan.";
  }

  // HOLD
  if (signal === "HOLD") {
    return "Tunggu konfirmasi atau koreksi harga.";
  }

  return "Belum layak untuk dibeli.";
}