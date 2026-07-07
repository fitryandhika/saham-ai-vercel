import { calculateATR } from "./indicators/atr.js";

// Support/resistance dari rentang 20 hari terakhir (bukan 6 bulan penuh),
// supaya lebih relevan untuk swing overnight, bukan level yang sudah basi.
export function calculateSupport(candles, period = 20) {
  const recent = candles.slice(-period);
  return Number(Math.min(...recent.map(c => c.low)).toFixed(2));
}

export function calculateResistance(candles, period = 20) {
  const recent = candles.slice(-period);
  return Number(Math.max(...recent.map(c => c.high)).toFixed(2));
}

// ATR(14) dipakai sebagai ukuran volatilitas nyata saham tsb,
// menggantikan offset tetap (-2% / +5%) yang tidak adaptif.
export function getATR(candles, period = 14) {
  const atr = calculateATR(candles, period);

  if (atr === null || Number.isNaN(atr)) {
    // Fallback kalau data candle kurang dari periode ATR:
    // pakai 2% dari harga close terakhir sebagai perkiraan volatilitas.
    const lastClose = candles[candles.length - 1]?.close || 0;
    return Number((lastClose * 0.02).toFixed(2));
  }

  return Number(atr.toFixed(2));
}

export function calculateStopLoss(close, atr, multiplier = 1.5) {
  return Number((close - atr * multiplier).toFixed(2));
}

export function calculateTakeProfit(close, atr, multiplier = 3) {
  return Number((close + atr * multiplier).toFixed(2));
}

export function calculateRiskReward(close, stopLoss, takeProfit) {

  const risk = close - stopLoss;
  const reward = takeProfit - close;

  if (risk <= 0) return 0;

  return Number((reward / risk).toFixed(2));
}
