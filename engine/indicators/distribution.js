// ==========================
// Distribution — volume besar tanpa follow-through harga
// ==========================
//
// Ditambahkan 31 Juli 2026, bersamaan dengan exhaustion.js (lihat
// catatan latar belakang di sana). Distribution dalam istilah Wyckoff:
// harga terlihat masih kuat/dekat high, tapi di baliknya pemain besar
// pelan-pelan melepas posisi — cirinya volume besar di hari-hari
// TURUN atau closing strength yang menurun beberapa hari beruntun
// meski harga belum benar-benar jebol. Ini beda dari "seller menang
// hari ini" (sudah ditangani closingStrength.js) — di sini yang
// dicari adalah TREN beberapa hari, bukan satu hari.
//
// Tiga sinyal distribution:
//   1. Down-day pada volume besar: dari 5 hari terakhir, berapa hari
//      yang closenya turun TAPI volumenya di atas rata-rata 20 hari —
//      indikasi klasik distribusi (jual besar-besaran, harga tertahan
//      sementara karena masih ada demand, tapi supply-nya berat).
//   2. Closing strength menurun beruntun: buyer makin kehilangan
//      kendali menjelang closing dari hari ke hari, meski harga masih
//      di area tinggi.
//   3. Harga sideways tapi volume tinggi: rentang 5 hari terakhir
//      sempit (<3%) padahal volume rata-rata jauh di atas normal —
//      "churning", banyak transaksi tapi harga tidak kemana-mana.
//
// CATATAN JUJUR: sama seperti exhaustion.js — BELUM divalidasi dari
// data nyata, penalti di scorer.js sengaja dibuat kecil dan skornya
// dicatat terpisah supaya bisa dievaluasi dari next_day_return_pct.

export function calculateDistribution({ candles }) {
  if (!candles || candles.length < 25) {
    return { distributionScore: 0, label: "TIDAK CUKUP DATA", reasons: [] };
  }

  const reasons = [];
  let score = 0;

  const last20 = candles.slice(-20);
  const avgVolume20 = last20.reduce((sum, c) => sum + c.volume, 0) / last20.length;

  const last5 = candles.slice(-5);

  // 1. Down-day dengan volume besar dalam 5 hari terakhir.
  let downDayHighVol = 0;
  for (let i = 1; i < last5.length; i++) {
    const isDown = last5[i].close < last5[i - 1].close;
    const isHighVol = last5[i].volume > avgVolume20 * 1.3;
    if (isDown && isHighVol) downDayHighVol++;
  }

  if (downDayHighVol >= 2) {
    score += 35;
    reasons.push(`${downDayHighVol} hari turun dengan volume besar dalam 5 hari terakhir — indikasi distribusi.`);
  } else if (downDayHighVol === 1) {
    score += 15;
    reasons.push("Ada hari turun dengan volume besar dalam 5 hari terakhir.");
  }

  // 2. Closing strength menurun beruntun (butuh high/low/close per hari).
  const closingStrengths = last5.map((c) => {
    const range = c.high - c.low;
    if (!range || range <= 0) return 0.5;
    return (c.close - c.low) / range;
  });

  let decliningStreak = 0;
  for (let i = closingStrengths.length - 1; i > 0; i--) {
    if (closingStrengths[i] < closingStrengths[i - 1] - 0.03) decliningStreak++;
    else break;
  }

  if (decliningStreak >= 3) {
    score += 30;
    reasons.push(`Closing strength menurun ${decliningStreak} hari beruntun — buyer makin kehilangan kendali menjelang close.`);
  } else if (decliningStreak >= 2) {
    score += 15;
    reasons.push(`Closing strength menurun ${decliningStreak} hari beruntun.`);
  }

  // 3. Harga sideways tapi volume tinggi ("churning").
  const highs5 = last5.map((c) => c.high);
  const lows5 = last5.map((c) => c.low);
  const range5Pct = ((Math.max(...highs5) - Math.min(...lows5)) / Math.min(...lows5)) * 100;
  const avgVolume5 = last5.reduce((sum, c) => sum + c.volume, 0) / last5.length;

  if (range5Pct < 3 && avgVolume5 > avgVolume20 * 1.3) {
    score += 25;
    reasons.push(`Harga sideways (rentang ${range5Pct.toFixed(1)}% dalam 5 hari) tapi volume jauh di atas rata-rata — churning.`);
  }

  score = Math.max(0, Math.min(100, score));

  let label = "NORMAL";
  if (score >= 60) label = "DISTRIBUSI KUAT";
  else if (score >= 35) label = "INDIKASI DISTRIBUSI";

  return { distributionScore: score, label, reasons, downDayHighVol, decliningClosingStreak: decliningStreak };
}

export default calculateDistribution;
