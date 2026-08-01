// ==========================
// Exhaustion — rally sudah kepanjangan / momentum melemah
// ==========================
//
// Ditambahkan 31 Juli 2026, dari analisis scan_history akhir Juli:
// STRONG BUY win rate (35.1%) justru LEBIH RENDAH dari HOLD/SELL
// (~37-38%), dan banyak saham yang direkomendasikan BUY malah
// sideways/turun berhari-hari alih-alih naik esok pagi seperti target
// strategi beli-sore-jual-pagi. Modul ini menangkap pola "sudah naik
// terlalu jauh, terlalu cepat" yang rawan profit-taking, dihitung dari
// histori candle saham itu sendiri (bukan snapshot satu hari) supaya
// benar-benar menangkap KELELAHAN rally, bukan cuma overbought sesaat.
//
// Tiga sinyal exhaustion, tiap sinyal punya bobot sendiri:
//   1. Overextension: jarak close ke SMA20 dibanding ATR — makin jauh
//      dari rata-rata & makin besar dibanding volatilitas normalnya,
//      makin "meregang" dan rawan mean-reversion.
//   2. Momentum divergence: harga masih naik 3 hari terakhir, tapi RSI
//      3 hari lalu vs RSI hari ini MENURUN (harga naik, dorongannya
//      melemah) — divergence klasik.
//   3. Consecutive up-days: berapa hari beruntun close > close
//      sebelumnya — semakin panjang, semakin besar kemungkinan hari
//      esok adalah hari jeda/koreksi, bukan lanjutan.
//
// CATATAN JUJUR: ini baru dipasang, BELUM divalidasi dari data nyata.
// Makanya exhaustionScore dicatat terpisah ke scan_history (lihat
// api/scan.js) dan penalti ke scorer.js sengaja kecil dulu — supaya
// bisa dievaluasi dari hasil next_day_return_pct yang sesungguhnya
// sebelum diperbesar bobotnya.

import { calculateSMA, calculateRSI } from "../technical.js";

export function calculateExhaustion({ closePrices, atr }) {
  if (!closePrices || closePrices.length < 25) {
    return { exhaustionScore: 0, label: "TIDAK CUKUP DATA", reasons: [] };
  }

  const reasons = [];
  let score = 0;

  const close = closePrices.at(-1);
  const sma20 = calculateSMA(closePrices, 20);

  // 1. Overextension vs ATR — jarak dari SMA20 dinormalisasi oleh ATR
  // supaya sebanding lintas saham (bukan cuma % jarak mentah).
  if (sma20 && atr && atr > 0) {
    const stretchInAtr = (close - sma20) / atr;

    if (stretchInAtr >= 3) {
      score += 35;
      reasons.push(`Harga sudah ${stretchInAtr.toFixed(1)}x ATR di atas SMA20 — rally sangat meregang.`);
    } else if (stretchInAtr >= 2) {
      score += 20;
      reasons.push(`Harga ${stretchInAtr.toFixed(1)}x ATR di atas SMA20 — mulai meregang.`);
    }
  }

  // 2. Momentum divergence — harga naik 3 hari, tapi RSI melemah.
  if (closePrices.length >= 18) {
    const priceUp3d = close > closePrices.at(-4);
    const rsiNow = calculateRSI(closePrices);
    const rsiPast = calculateRSI(closePrices.slice(0, -3));

    if (priceUp3d && rsiNow !== null && rsiPast !== null && rsiNow < rsiPast - 3) {
      score += 30;
      reasons.push(`Harga naik 3 hari terakhir tapi RSI melemah (${rsiPast} -> ${rsiNow}) — momentum divergence.`);
    }
  }

  // 3. Consecutive up-days — makin panjang beruntun naik, makin rawan jeda.
  let streak = 0;
  for (let i = closePrices.length - 1; i > 0; i--) {
    if (closePrices[i] > closePrices[i - 1]) streak++;
    else break;
  }

  if (streak >= 5) {
    score += 25;
    reasons.push(`Sudah naik ${streak} hari beruntun — rawan hari jeda/koreksi.`);
  } else if (streak >= 3) {
    score += 12;
    reasons.push(`Sudah naik ${streak} hari beruntun.`);
  }

  score = Math.max(0, Math.min(100, score));

  let label = "NORMAL";
  if (score >= 60) label = "SANGAT LELAH";
  else if (score >= 35) label = "MULAI LELAH";

  return { exhaustionScore: score, label, reasons, consecutiveUpDays: streak };
}

export default calculateExhaustion;
