import { calculateEMA } from "./ema.js";

export function calculateMACD(
  prices,
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
) {
  if (!Array.isArray(prices) || prices.length < slowPeriod + signalPeriod) {
    return null;
  }

  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  const startIndex = fastEMA.length - slowEMA.length;

  const macdLine = slowEMA.map((slow, index) => {
    return fastEMA[index + startIndex] - slow;
  });

  const signalLine = calculateEMA(macdLine, signalPeriod);

  const signalStart = macdLine.length - signalLine.length;

  const histogram = signalLine.map((signal, index) => {
    return macdLine[index + signalStart] - signal;
  });

  return {
    macd: macdLine.at(-1),
    signal: signalLine.at(-1),
    histogram: histogram.at(-1)
  };
}

export default calculateMACD;