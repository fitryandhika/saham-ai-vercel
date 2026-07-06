export function getMarketTrend({
  sma20,
  sma50,
  ema9,
  ema20
}) {
  let bullish = 0;

  if (sma20 > sma50) bullish++;
  if (ema9 > ema20) bullish++;

  if (bullish >= 2) return "BULLISH";
  if (bullish === 1) return "SIDEWAYS";

  return "BEARISH";
}

export function getRiskLevel({
  rsi,
  riskReward
}) {
  if (rsi >= 70 || rsi <= 30) return "HIGH";

  if (riskReward >= 2) return "LOW";

  if (riskReward >= 1) return "MEDIUM";

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
  signal,
  confidence,
  entry,
  riskLevel
}) {
  if (
    signal === "STRONG BUY" &&
    confidence >= 80 &&
    entry === "NOW" &&
    riskLevel !== "HIGH"
  ) {
    return "Layak dibeli sekarang.";
  }

  if (
    signal === "BUY" &&
    confidence >= 70 &&
    entry !== "AVOID"
  ) {
    return "Menarik untuk dipertimbangkan.";
  }

  if (entry === "WAIT") {
    return "Tunggu konfirmasi atau koreksi harga.";
  }

  return "Belum layak untuk dibeli.";
}