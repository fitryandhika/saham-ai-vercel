export function calculateSMA(prices, period) {
  if (prices.length < period) return null;

  const data = prices.slice(-period);
  const total = data.reduce((sum, value) => sum + value, 0);

  return Number((total / period).toFixed(2));
}

export function calculateEMA(prices, period) {
  if (prices.length < period) return null;

  const k = 2 / (period + 1);

  let ema = calculateSMA(prices.slice(0, period), period);

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }

  return Number(ema.toFixed(2));
}
export function calculateRSI(prices, period = 14) {

  if (prices.length <= period) return null;

  let gain = 0;
  let loss = 0;

  for (let i = prices.length - period; i < prices.length; i++) {

    const diff = prices[i] - prices[i - 1];

    if (diff > 0) {
      gain += diff;
    } else {
      loss -= diff;
    }
  }

  const avgGain = gain / period;
  const avgLoss = loss / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return Number((100 - (100 / (1 + rs))).toFixed(2));
}