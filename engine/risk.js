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

// SL diperketat ke 1x ATR (sebelumnya 1.5x) — potensi rugi per posisi
// lebih kecil, cocok untuk hold semalam bukan swing multi-hari.
export function calculateStopLoss(close, atr, multiplier = 1.0) {
  return Number((close - atr * multiplier).toFixed(2));
}

export function calculateTakeProfit(close, atr, multiplier) {
  return Number((close + atr * multiplier).toFixed(2));
}

// 3 level TP, dari yang paling realistis dicapai semalam
// sampai target stretch kalau momentum lanjut di sesi pagi.
export function calculateTakeProfitLevels(close, atr) {
  return {
    tp1: calculateTakeProfit(close, atr, 1.0),   // RR ~1:1, target konservatif
    tp2: calculateTakeProfit(close, atr, 1.75),  // RR ~1.75:1, target utama
    tp3: calculateTakeProfit(close, atr, 2.5)    // RR ~2.5:1, target stretch
  };
}

export function calculateRiskReward(close, stopLoss, takeProfit) {

  const risk = close - stopLoss;
  const reward = takeProfit - close;

  if (risk <= 0) return 0;

  return Number((reward / risk).toFixed(2));
}

export function calculateRiskRewardLevels(close, stopLoss, takeProfitLevels) {
  return {
    tp1: calculateRiskReward(close, stopLoss, takeProfitLevels.tp1),
    tp2: calculateRiskReward(close, stopLoss, takeProfitLevels.tp2),
    tp3: calculateRiskReward(close, stopLoss, takeProfitLevels.tp3)
  };
}
