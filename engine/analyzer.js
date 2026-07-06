import {
  calculateTrend,
  calculateRecommendation,
  calculateConfidence
} from "./indicators.js";

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