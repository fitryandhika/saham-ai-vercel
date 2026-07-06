export function buildRecommendation(indicators, score) {
  return {
    signal:
      score >= 80
        ? "STRONG BUY"
        : score >= 65
        ? "BUY"
        : score >= 45
        ? "HOLD"
        : "SELL",

    confidence: score,

    reason: {
      ema: indicators.ema20 > indicators.ema50,
      rsi: indicators.rsi,
      macd: indicators.macd > indicators.signal,
      momentum: indicators.momentum,
      volumeSpike: indicators.volumeSpike
    }
  };
}

export default buildRecommendation;