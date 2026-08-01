import { getBucketKey } from "./gapCalibration.js";

// Konstanta shrinkage Bayesian — makin besar K, makin butuh sampel
// banyak sebelum data historis "dipercaya" mengalahkan heuristik.
// K=30 dipilih supaya bucket dengan ~30 sampel dapat bobot 50:50, dan
// bucket dengan ratusan sampel (bucket besar seperti HOLD/skor
// menengah) dominan dipimpin data historis, sementara bucket yang
// jarang kejadian (misal STRONG BUY + OVERSOLD + LOW volume) tetap
// aman fallback ke heuristik karena sampelnya tipis.
const SHRINKAGE_K = 30;

export function getGapProbability({
  score,
  confidence,
  momentum,
  volume,
  rsi,
  marketTrend,
  calibrationMap
}) {

  let probability = 50;

  // Trend
  if (marketTrend === "BULLISH")
    probability += 10;

  if (marketTrend === "BEARISH")
    probability -= 10;

  // AI Score — bobot diturunkan, faktor ini berkorelasi dengan
  // confidence & momentum di bawah (sama-sama turunan RSI/MACD/EMA/volume)
  probability += (score - 50) * 0.12;

  // Confidence
  probability += (confidence - 50) * 0.08;

  // Momentum
  probability += (momentum.score - 50) * 0.08;

  // Volume
  if (volume.signal === "HIGH")
    probability += 5;

  if (volume.signal === "LOW")
    probability -= 5;

  // RSI
  if (rsi > 70)
    probability -= 5;

  if (rsi < 30)
    probability += 3;

  // ==========================
  // Hybrid: blend heuristik di atas (jadi "prior") dengan win rate
  // EMPIRIS dari scan_history (lihat engine/gapCalibration.js untuk
  // definisi bucket & api/label-outcomes-close.js untuk kapan tabel
  // ini dihitung ulang). Ditambahkan 2 Agustus 2026.
  //
  // Bayesian shrinkage: makin banyak sampel historis di bucket yang
  // cocok, makin besar bobotnya dibanding heuristik — bucket dengan
  // sampel sedikit otomatis fallback ke heuristik (weight mendekati 0)
  // supaya noise dari sampel kecil tidak mendominasi.
  // ==========================
  let calibrationApplied = false;
  let bucketSampleCount = 0;

  if (calibrationMap && calibrationMap.size > 0) {
    const key = getBucketKey({ score, rsi, volumeSignal: volume?.signal });
    const bucket = key ? calibrationMap.get(key) : null;

    if (bucket && bucket.sample_count > 0) {
      const empiricalProbability = bucket.win_rate * 100;
      const weight = bucket.sample_count / (bucket.sample_count + SHRINKAGE_K);

      probability = weight * empiricalProbability + (1 - weight) * probability;
      calibrationApplied = true;
      bucketSampleCount = bucket.sample_count;
    }
  }

  // Plafon diturunkan dari 95/5 ke 80/20 — model ini berbasis data
  // harian, jadi kepastian setinggi 90%+ tidak realistis untuk
  // memprediksi gap overnight.
  probability = Math.round(
    Math.max(20, Math.min(probability, 80))
  );

  let outlook = "NEUTRAL";

  if (probability >= 70)
    outlook = "HIGH GAP UP";

  else if (probability >= 58)
    outlook = "POSSIBLE GAP UP";

  else if (probability <= 30)
    outlook = "HIGH GAP DOWN";

  else if (probability <= 42)
    outlook = "POSSIBLE GAP DOWN";

  return {
    probability: `${probability}%`,
    outlook,
    calibrationApplied,
    bucketSampleCount
  };
}
