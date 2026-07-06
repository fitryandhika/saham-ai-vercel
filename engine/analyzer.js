import {
  generateReasons,
  calculateConfidence
} from "./reasoning.js";

import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands
} from "./technical.js";

import {
  calculateScore,
  recommendation
} from "./scorer.js";

import {
  calculateSupport,
  calculateResistance,
  calculateStopLoss,
  calculateTakeProfit,
  calculateRiskReward
} from "./risk.js";

export function analyzeStock(data) {

  const close = data.closePrices.at(-1);

  // ==========================
  // Technical Indicators
  // ==========================

  const sma20 = calculateSMA(data.closePrices, 20);
  const sma50 = calculateSMA(data.closePrices, 50);

  const ema9 = calculateEMA(data.closePrices, 9);
  const ema20 = calculateEMA(data.closePrices, 20);

  const rsi = calculateRSI(data.closePrices);

  const macd = calculateMACD(data.closePrices);

  const bollinger = calculateBollingerBands(data.closePrices);

  // ==========================
  // Risk Management
  // ==========================

  const support = calculateSupport(data.closePrices);

  const resistance = calculateResistance(data.closePrices);

  const stopLoss = calculateStopLoss(support);

  const takeProfit = calculateTakeProfit(resistance);

  const riskReward = calculateRiskReward(
    close,
    stopLoss,
    takeProfit
  );

  // ==========================
  // AI Score
  // ==========================

  const score = calculateScore({
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    rsi,
    macd,
    riskReward
  });

  const signal = recommendation(score);

  // ==========================
  // Confidence & Reasons
  // ==========================

  const confidence = calculateConfidence({
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    macd,
    riskReward
  });

  const reasons = generateReasons({
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    rsi,
    macd,
    riskReward
  });

  // ==========================
  // Final Result
  // ==========================

  return {
    kode: data.kode,

    close,

    sma20,
    sma50,

    ema9,
    ema20,

    rsi,

    macd,

    bollinger,

    score,

    signal,

    confidence,

    reasons,

    support,

    resistance,

    stopLoss,

    takeProfit,

    riskReward,

    timestamp: new Date().toISOString()
  };
}