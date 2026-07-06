export function generateSignal(score) {
  if (score >= 80) return "STRONG BUY";

  if (score >= 65) return "BUY";

  if (score >= 45) return "HOLD";

  return "SELL";
}

export default generateSignal;