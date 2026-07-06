import {
  calculateSMA,
  calculateEMA,
  calculateRSI
} from "./technical.js";

import {
  calculateScore,
  recommendation
} from "./scorer.js";

export function analyzeStock(data) {

  const close = data.closePrices.at(-1);

  const sma20 = calculateSMA(data.closePrices, 20);
  const sma50 = calculateSMA(data.closePrices, 50);

  const ema9 = calculateEMA(data.closePrices, 9);
  const ema20 = calculateEMA(data.closePrices, 20);

  const rsi = calculateRSI(data.closePrices);

  const score = calculateScore({
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    rsi,
    volumeRatio: 1.2
  });

  const signal = recommendation(score);

  return {
    kode: data.kode,
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    rsi,
    score,
    signal,
    timestamp: new Date().toISOString()
  };
}