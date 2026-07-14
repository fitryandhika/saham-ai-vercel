export function getRank(score, confidence, riskReward) {

  let point = 0;

  point += score * 0.5;
  point += confidence * 0.3;
  point += Math.min(riskReward, 3) * 10;

  return Number(point.toFixed(2));
}

export function getCategory(rank) {

  if (rank >= 85)
    return "⭐ PRIORITAS UTAMA";

  if (rank >= 75)
    return "✅ MENARIK";

  if (rank >= 65)
    return "👀 PANTAU";

  return "❌ LEWATI";
}