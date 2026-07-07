export function getForecast({
  close,
  score,
  confidence,
  marketTrend,
  rsi
}) {

  let week = 0;
  let month = 0;
  let quarter = 0;

  // Trend
  if (marketTrend === "BULLISH") {
    week += 2;
    month += 6;
    quarter += 12;
  }

  if (marketTrend === "SIDEWAYS") {
    week += 0.5;
    month += 2;
    quarter += 4;
  }

  if (marketTrend === "BEARISH") {
    week -= 2;
    month -= 5;
    quarter -= 10;
  }

  // Score
  week += (score - 50) * 0.05;
  month += (score - 50) * 0.10;
  quarter += (score - 50) * 0.15;

  // Confidence
  week += (confidence - 50) * 0.03;
  month += (confidence - 50) * 0.05;
  quarter += (confidence - 50) * 0.08;

  // RSI
  if (rsi > 70) {
    week -= 2;
    month -= 3;
  }

  if (rsi < 30) {
    week += 2;
    month += 4;
  }

  const targetWeek =
    Number((close * (1 + week / 100)).toFixed(2));

  const targetMonth =
    Number((close * (1 + month / 100)).toFixed(2));

  const targetQuarter =
    Number((close * (1 + quarter / 100)).toFixed(2));

  return {

    week: {
      change: `${week.toFixed(1)}%`,
      target: targetWeek
    },

    month: {
      change: `${month.toFixed(1)}%`,
      target: targetMonth
    },

    quarter: {
      change: `${quarter.toFixed(1)}%`,
      target: targetQuarter
    }

  };

}