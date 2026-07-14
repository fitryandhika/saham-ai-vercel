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
  if (macd && macd.macd > 0) bullish++;

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
  riskReward,
  breakout
}) {

  const isConfirmedBreakout = breakout && breakout.isBreakout &&
    (breakout.level === "STRONG_BREAKOUT" || breakout.level === "BREAKOUT");

  // Breakout kuat wajar mendorong RSI ke area overbought — itu bukan
  // alasan untuk memblokir entry seperti kondisi overbought biasa
  // (harga naik pelan tanpa katalis). Longgarkan plafon RSI untuk
  // breakout terkonfirmasi (masih ada batas 80 sebagai sanity check
  // supaya tidak mengejar harga yang sudah terlalu jauh dari resistance).
  if (
    (signal === "BUY" || signal === "STRONG BUY") &&
    riskReward >= 1.5 &&
    (isConfirmedBreakout ? rsi < 80 : rsi < 70)
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

  // STRONG BUY — syarat penuh
  if (
    signal === "STRONG BUY" &&
    score >= 85 &&
    confidence >= 65 &&
    entry === "NOW" &&
    riskLevel !== "HIGH"
  ) {
    return "Layak dibeli sekarang.";
  }

  // BUY — juga jadi fallback untuk STRONG BUY yang gagal
  // di gate confidence/entry/riskLevel di atas, supaya signal
  // dan verdict tidak saling bertentangan (mis. signal STRONG BUY
  // tapi verdict "belum layak" hanya gara-gara confidence kurang
  // beberapa poin dari ambang STRONG BUY).
  if (
    (signal === "BUY" || signal === "STRONG BUY") &&
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
