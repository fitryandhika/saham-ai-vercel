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