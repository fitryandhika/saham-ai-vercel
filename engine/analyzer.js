import {
  calculateTrend,
  calculateRecommendation,
  calculateConfidence
} from "./indicators.js";

import {
  calculateSMA,
  calculateEMA,
  calculateRSI
} from "./technical.js";

export function analyzeStock(data) {

  const trend = calculateTrend(data.close, data.ma20);

  const rekomendasi = calculateRecommendation(
    data.close,
    data.ma20,
    data.rsi
  );

  const confidence = calculateConfidence(
    data.close,
    data.ma20,
    data.rsi
  );

  return {
    kode: data.kode,
    close: data.close,
    ma20: data.ma20,
    rsi: data.rsi,
    trend,
    rekomendasi,
    confidence: `${confidence}%`,
    support: data.low,
    resistance: data.high,
    timestamp: new Date().toISOString()
  };
}

export function analyzeStock(data) {

  const sma20 = calculateSMA(data.closePrices, 20);

  const ema20 = calculateEMA(data.closePrices, 20);

  const rsi = calculateRSI(data.closePrices);

  return {
    kode: data.kode,
    close: data.closePrices.at(-1),
    sma20,
    ema20,
    rsi,
    timestamp: new Date().toISOString()
  };
}