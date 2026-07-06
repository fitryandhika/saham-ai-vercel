/**
 * Exponential Moving Average (EMA)
 * @param {number[]} prices
 * @param {number} period
 * @returns {number[]}
 */

export function calculateEMA(prices, period) {
  if (!Array.isArray(prices) || prices.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const ema = [];

  // Hitung SMA awal
  let sma = 0;
  for (let i = 0; i < period; i++) {
    sma += prices[i];
  }

  sma /= period;
  ema.push(sma);

  // Hitung EMA berikutnya
  for (let i = period; i < prices.length; i++) {
    const value =
      (prices[i] - ema[ema.length - 1]) * multiplier +
      ema[ema.length - 1];

    ema.push(value);
  }

  return ema;
}

export default calculateEMA;