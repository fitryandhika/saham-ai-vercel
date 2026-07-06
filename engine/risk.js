export function calculateSupport(prices) {
  return Math.min(...prices);
}

export function calculateResistance(prices) {
  return Math.max(...prices);
}

export function calculateStopLoss(support) {
  return Number((support * 0.98).toFixed(2));
}

export function calculateTakeProfit(resistance) {
  return Number((resistance * 1.05).toFixed(2));
}

export function calculateRiskReward(close, stopLoss, takeProfit) {

  const risk = close - stopLoss;
  const reward = takeProfit - close;

  if (risk <= 0) return 0;

  return Number((reward / risk).toFixed(2));
}