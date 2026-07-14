// ==========================
// Volume Acceleration (slope 3 hari)
// ==========================
//
// Rasio volume 1 hari gampang kena noise (satu hari ramai lalu selesai).
// Slope 3 hari menangkap TREN partisipasi volume yang membangun —
// lebih meyakinkan untuk breakout/continuation daripada lonjakan
// satu hari yang bisa langsung mereda besok.

// Least-squares slope sederhana atas 3 titik volume terakhir,
// dinormalisasi terhadap rata-rata volumenya sendiri supaya sebanding
// lintas saham dengan skala volume yang beda-beda (dalam %/hari).
export function calculateVolumeAcceleration(volumes) {
  if (!volumes || volumes.length < 3) {
    return { slope: 0, slopePercent: 0, accelerating: false };
  }

  const last3 = volumes.slice(-3);
  const n = 3;
  const xs = [0, 1, 2];
  const meanX = 1; // rata-rata 0,1,2
  const meanY = last3.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;

  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (last3[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }

  const slope = den === 0 ? 0 : num / den;

  const slopePercent = meanY > 0
    ? Number(((slope / meanY) * 100).toFixed(2))
    : 0;

  // Percepatan nyata: slope positif DAN kedua delta berurutan naik
  // (bukan cuma lonjakan lalu turun lagi di hari terakhir).
  const delta1 = last3[1] - last3[0];
  const delta2 = last3[2] - last3[1];
  const accelerating = slope > 0 && delta2 > 0 && delta2 >= delta1 * 0.5;

  return { slope: Number(slope.toFixed(2)), slopePercent, accelerating };
}

export default calculateVolumeAcceleration;
