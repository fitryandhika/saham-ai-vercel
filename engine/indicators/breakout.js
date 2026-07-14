// ==========================
// Breakout Detector
// ==========================
//
// Breakout eksplisit: close tembus resistance/high-N-hari DIDUKUNG
// volume >=1.5x-2x rata-rata. Ini sinyal beli-sore yang kuat (buyer
// agresif menembus level lama dengan partisipasi volume nyata), jadi
// harus dikasih bobot besar di skor — bukan dihukum seperti volatilitas
// biasa atau "harga sudah naik banyak".

// highN dihitung dari N hari SEBELUM hari ini (exclude close/high hari
// ini sendiri), supaya "resistance" itu level yang benar-benar sudah
// ada sebelum breakout terjadi, bukan level yang dibentuk oleh candle
// breakout itu sendiri.
export function detectBreakout(candles, { lookback = 20, volumeRatio = 1 } = {}) {
  if (!candles || candles.length <= lookback) {
    return {
      isBreakout: false,
      level: "NONE",
      resistanceN: null,
      distancePercent: 0
    };
  }

  const today = candles.at(-1);
  const prior = candles.slice(-(lookback + 1), -1);

  const resistanceN = Number(
    Math.max(...prior.map(c => c.high)).toFixed(2)
  );

  const brokeLevel = today.close > resistanceN;

  const distancePercent = resistanceN
    ? Number((((today.close - resistanceN) / resistanceN) * 100).toFixed(2))
    : 0;

  let level = "NONE";

  if (brokeLevel && volumeRatio >= 2) {
    level = "STRONG_BREAKOUT"; // tembus + volume eksplosif
  } else if (brokeLevel && volumeRatio >= 1.5) {
    level = "BREAKOUT"; // tembus + volume kuat
  } else if (brokeLevel) {
    level = "WEAK_BREAKOUT"; // tembus tapi volume belum konfirmasi
  }

  return {
    isBreakout: brokeLevel && volumeRatio >= 1.5,
    level,
    resistanceN,
    lookback,
    distancePercent
  };
}

export default detectBreakout;
