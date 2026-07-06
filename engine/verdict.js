export function generateVerdict(data) {

  const {
    score,
    confidence,
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    macd,
    riskReward
  } = data;

  // ==========================
  // Market Trend
  // ==========================

  let bullish = 0;

  if (close > sma20) bullish++;
  if (sma20 > sma50) bullish++;
  if (ema9 > ema20) bullish++;
  if (macd && macd.macd > 0) bullish++;

  let marketTrend = "SIDEWAYS";

  if (bullish >= 3) {
    marketTrend = "BULLISH";
  } else if (bullish <= 1) {
    marketTrend = "BEARISH";
  }

  // ==========================
  // Risk Level
  // ==========================

  let riskLevel = "HIGH";

  if (riskReward >= 2) {
    riskLevel = "LOW";
  } else if (riskReward >= 1) {
    riskLevel = "MEDIUM";
  }

  // ==========================
  // Entry & Verdict
  // ==========================

  let entry = "WAIT";
  let verdict = "Belum ada