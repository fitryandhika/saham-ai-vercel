export function getRating(score) {

  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";

  return "D";
}

export function getProbability({
  score,
  confidence
}) {

  let profit = Math.round(
    score * 0.6 +
    confidence * 0.4
  );

  if (profit > 95) profit = 95;
  if (profit < 5) profit = 5;

  return {
    profit: `${profit}%`,
    loss: `${100 - profit}%`
  };
}