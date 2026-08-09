export function getMarketTrend({
  close,
  sma20,
  sma50,
  ema9,
  ema20,
  macd
}) {

  let bullish = 0;

  if (close > sma20) bullish++;
  if (sma20 > sma50) bullish++;
  if (ema9 > ema20) bullish++;
  if (macd && macd.macd > 0) bullish++;

  if (bullish >= 3) return "BULLISH";
  if (bullish >= 2) return "SIDEWAYS";

  return "BEARISH";
}

export function getRiskLevel({
  rsi,
  riskReward
}) {

  if (rsi >= 70 || rsi <= 30) {
    return "HIGH";
  }

  if (riskReward >= 2) {
    return "LOW";
  }

  if (riskReward >= 1) {
    return "MEDIUM";
  }

  return "HIGH";
}

export function getEntryTiming({
  signal,
  rsi,
  riskReward,
  breakout,
  exhaustion,
  distribution
}) {

  const isConfirmedBreakout = breakout && breakout.isBreakout &&
    (breakout.level === "STRONG_BREAKOUT" || breakout.level === "BREAKOUT");

  // Gate exhaustion & distribution (31 Juli 2026) — kalau DUA-DUANYA
  // tinggi sekaligus (bukan cuma salah satu), ini kombinasi rally
  // meregang + tanda-tanda distribusi yang paling rawan "sudah
  // direkomendasikan BUY, besoknya malah sideways/turun lama" (lihat
  // catatan di engine/indicators/exhaustion.js & distribution.js).
  // Diblokir di sini (entry timing), BUKAN cuma lewat penalti skor di
  // scorer.js, supaya tetap ketahuan kalau skornya kebetulan masih
  // tinggi dari kriteria lain — entry-nya tetap tidak "NOW".
  const bothExhaustedAndDistributing =
    exhaustion && distribution &&
    exhaustion.exhaustionScore >= 60 &&
    distribution.distributionScore >= 60;

  if (bothExhaustedAndDistributing) {
    return "AVOID";
  }

  // Breakout kuat wajar mendorong RSI ke area overbought — itu bukan
  // alasan untuk memblokir entry seperti kondisi overbought biasa
  // (harga naik pelan tanpa katalis). Longgarkan plafon RSI untuk
  // breakout terkonfirmasi (masih ada batas 80 sebagai sanity check
  // supaya tidak mengejar harga yang sudah terlalu jauh dari resistance).
  if (
    (signal === "BUY" || signal === "STRONG BUY") &&
    riskReward >= 1.5 &&
    (isConfirmedBreakout ? rsi < 80 : rsi < 70)
  ) {
    return "NOW";
  }

  if (signal === "HOLD") {
    return "WAIT";
  }

  return "AVOID";
}

export function getFinalVerdict({
  score,
  signal,
  confidence,
  marketTrend,
  momentum,
  volume,
  breakout,
  relativeStrength,
  rsi,
  macd
}) {
  // Verdict lama sekarang dipakai sebagai OUTLOOK MULTI-HARI.
  // Tujuannya menjawab: "apakah struktur teknikal saat ini cenderung
  // bullish/bearish untuk beberapa hari ke depan?" BUKAN memprediksi
  // apakah saham pasti naik besok. Timing H+1 ditangani separately oleh
  // nextDayOpportunity.
  const scoreNum = Number(score) || 0;
  const confidenceNum = Number(confidence) || 0;
  const rsiNum = Number(rsi);
  const momentumScore = Number(momentum?.score) || 0;
  const volumeRatio = Number(volume?.ratio) || 0;
  const macdValue = Number(macd?.macd);
  const rsLabel = String(relativeStrength?.label || "").toUpperCase();
  const breakoutConfirmed = Boolean(breakout?.isBreakout);

  const bullishSignals = [
    marketTrend === "BULLISH",
    scoreNum >= 70,
    confidenceNum >= 60,
    momentumScore >= 50,
    Number.isFinite(macdValue) && macdValue > 0,
    volumeRatio >= 1,
    breakoutConfirmed,
    rsLabel === "OUTPERFORM" || rsLabel === "JAUH OUTPERFORM"
  ].filter(Boolean).length;

  const bearishSignals = [
    marketTrend === "BEARISH",
    scoreNum < 50,
    momentumScore < 35,
    Number.isFinite(macdValue) && macdValue < 0,
    rsLabel === "UNDERPERFORM" || rsLabel === "JAUH UNDERPERFORM"
  ].filter(Boolean).length;

  if (bullishSignals >= 7 || (marketTrend === "BULLISH" && scoreNum >= 85 && confidenceNum >= 65)) {
    return "Bullish kuat — berpotensi melanjutkan kenaikan dalam beberapa hari.";
  }

  if (bullishSignals >= 4 || (marketTrend === "BULLISH" && scoreNum >= 70)) {
    return "Bullish — struktur teknikal mendukung potensi kenaikan dalam beberapa hari.";
  }

  if (bearishSignals >= 3 || marketTrend === "BEARISH") {
    return "Bearish — tekanan turun masih dominan dalam beberapa hari ke depan.";
  }

  if (signal === "BUY" || signal === "STRONG BUY") {
    if (Number.isFinite(rsiNum) && rsiNum >= 70) {
      return "Bullish tetapi mulai jenuh — potensi kenaikan masih ada, namun perlu waspada pullback.";
    }
    return "Bullish awal — ada potensi kenaikan, tetapi tren belum terkonfirmasi penuh.";
  }

  if (signal === "HOLD") {
    return "Netral — tunggu konfirmasi arah tren sebelum menarik kesimpulan.";
  }

  return "Netral — sinyal teknikal belum cukup kuat untuk outlook beberapa hari.";
}
