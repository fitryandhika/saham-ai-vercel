/**
 * ==========================================
 * SahamAI v2.1
 * Exhaustion Detector
 * ------------------------------------------
 * Tujuan:
 * Mengurangi sinyal BUY ketika saham sudah
 * terlalu overextended.
 *
 * Output:
 * {
 *   score,
 *   level,
 *   reasons
 * }
 * ==========================================
 */

export function calculateExhaustion({
  candles = [],
  closePrices = [],
  highPrices = [],
  lowPrices = [],
  volumes = [],
  rsi = 50,
  bollinger = null
}) {

  let score = 0;

  const reasons = [];

  if (!closePrices.length) {
    return {
      score: 0,
      level: "NORMAL",
      reasons: []
    };
  }

  const close = closePrices.at(-1);

  // ==============================
  // RSI
  // ==============================

  if (rsi >= 85) {
    score += 25;
    reasons.push("RSI sangat overbought");
  }

  else if (rsi >= 80) {
    score += 18;
    reasons.push("RSI ekstrem");
  }

  else if (rsi >= 72) {
    score += 10;
    reasons.push("RSI overbought");
  }

  // ==============================
  // Rally 3 Hari
  // ==============================

  if (closePrices.length >= 4) {

    const gain3 =
      ((close - closePrices.at(-4))
      / closePrices.at(-4)) * 100;

    if (gain3 >= 15) {

      score += 15;

      reasons.push("Naik >15% dalam 3 hari");

    }

    else if (gain3 >= 10) {

      score += 10;

      reasons.push("Naik >10% dalam 3 hari");

    }

  }

  // ==============================
  // Rally 5 Hari
  // ==============================

  if (closePrices.length >= 6) {

    const gain5 =
      ((close - closePrices.at(-6))
      / closePrices.at(-6)) * 100;

    if (gain5 >= 25) {

      score += 20;

      reasons.push("Naik >25% dalam 5 hari");

    }

    else if (gain5 >= 18) {

      score += 12;

      reasons.push("Naik >18% dalam 5 hari");

    }

  }

  // ==============================
  // Bollinger
  // ==============================

  if (bollinger && bollinger.upper) {

    if (close > bollinger.upper) {

      score += 10;

      reasons.push("Close di atas Upper Bollinger");

    }

    else {

      const distance =
        ((bollinger.upper - close)
        / close) * 100;

      if (distance <= 1) {

        score += 5;

        reasons.push("Sangat dekat Upper Bollinger");

      }

    }

  }

  // ==============================
  // Long Upper Shadow
  // ==============================

  if (
    highPrices.length &&
    lowPrices.length
  ) {

    const high = highPrices.at(-1);

    const low = lowPrices.at(-1);

    const body = Math.abs(close - low);

    const upperShadow = high - close;

    if (
      body > 0 &&
      upperShadow >= body * 2
    ) {

      score += 10;

      reasons.push("Upper shadow panjang");

    }

  }

  // ==============================
  // Volume Menurun
  // ==============================

  if (volumes.length >= 3) {

    const v1 = volumes.at(-3);

    const v2 = volumes.at(-2);

    const v3 = volumes.at(-1);

    if (
      v1 > v2 &&
      v2 > v3
    ) {

      score += 10;

      reasons.push("Volume terus menurun");

    }

  }

  // ==============================
  // ATR Expansion
  // ==============================

  if (candles.length >= 6) {

    const ranges = candles
      .slice(-5)
      .map(c => c.high - c.low);

    const avg =
      ranges.reduce((a,b)=>a+b,0)
      / ranges.length;

    const today =
      candles.at(-1).high -
      candles.at(-1).low;

    if (today >= avg * 1.8) {

      score += 5;

      reasons.push("Range harian terlalu besar");

    }

  }

  // ==============================
  // Final Level
  // ==============================

  let level = "NORMAL";

  if (score >= 50)
    level = "EXTREME";

  else if (score >= 30)
    level = "HIGH";

  else if (score >= 15)
    level = "WARNING";

  return {

    score,

    level,

    reasons

  };

}