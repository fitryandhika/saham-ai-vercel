export function analyzeVolume(volumes) {

  const latest = volumes.at(-1);

  const avg20 =
    volumes.slice(-20)
      .reduce((a, b) => a + b, 0) / 20;

  const ratio = Number((latest / avg20).toFixed(2));

  let signal = "NORMAL";

  if (ratio >= 2) {
    signal = "EXPLOSIVE";
  } else if (ratio >= 1.5) {
    signal = "HIGH";
  } else if (ratio < 0.8) {
    signal = "LOW";
  }

  return {

    latest,

    average20: Math.round(avg20),

    ratio,

    signal

  };

}