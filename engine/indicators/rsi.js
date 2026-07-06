/**
 * Relative Strength Index (RSI)
 */

export function calculateRSI(prices, period = 14) {
  if (!Array.isArray(prices) || prices.length <= period) {
    return null;
  }

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];

    if (change >= 0) gain += change;
    else loss -= change;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];

    if (change >= 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

export default calculateRSI;