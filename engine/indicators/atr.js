export function calculateATR(candles, period = 14) {

  if (!candles || candles.length <= period) {
    return null;
  }

  const tr = [];

  for (let i = 1; i < candles.length; i++) {

    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    tr.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      )
    );
  }

  const atr =
    tr.slice(-period).reduce((a, b) => a + b, 0) / period;

  return atr;
}

export default calculateATR;