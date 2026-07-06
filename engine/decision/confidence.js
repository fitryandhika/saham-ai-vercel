export function calculateConfidence(score) {
  return Math.min(100, Math.max(0, score));
}

export default calculateConfidence;