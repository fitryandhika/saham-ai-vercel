export function volumeSpike(
  volumes,
  period = 20,
  multiplier = 1.5
) {

  if (!volumes || volumes.length <= period) {
    return false;
  }

  const latest = volumes.at(-1);

  const avg =
    volumes
      .slice(-(period + 1), -1)
      .reduce((a, b) => a + b, 0) /
    period;

  return latest >= avg * multiplier;
}

export default volumeSpike;