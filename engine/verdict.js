export function getMarketTrend(data) {

  if (
    data.close > data.sma20 &&
    data.sma20 > data.sma50 &&
    data.ema9 > data.ema20
  ) {
    return "BULLISH";
  }

  if (
    data.close < data.sma20 &&
    data.sma20 < data.sma50 &&
    data.ema9 < data.ema20
  ) {
    return "BEARISH";
  }

  return "SIDEWAYS";
}

export function getRiskLevel(data) {

  if (data.riskReward >= 2) {
    return "LOW";
  }

  if (data.riskReward >= 1) {
    return "MEDIUM";
  }

  return "HIGH";
}

export function getEntrySignal(data) {

  if (
    data.signal === "BUY" &&
    data.riskReward >= 2 &&
    data.rsi < 70
  ) {
    return "ENTRY";
  }

  if (data.signal === "HOLD") {
    return "WAIT";
  }

  return "AVOID";
}

export function getVerdict(data) {

  if (
    data.signal === "BUY" &&
    data.riskReward >= 2 &&
    data.rsi < 70
  ) {
    return "Layak dibeli.";
  }

  if (data.signal === "HOLD") {
    return "Tunggu konfirmasi atau koreksi harga.";
  }

  return "Belum layak untuk dibeli.";
}