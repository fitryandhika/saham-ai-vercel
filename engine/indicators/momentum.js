export function momentum(
  prices,
  period = 10
) {

  if (!prices || prices.length <= period) {
    return null;
  }

  const current = prices.at(-1);

  const previous = prices.at(-(period + 1));

  return ((current - previous) / previous) * 100;
}

export default momentum;