import { calculateNextDayOpportunity } from "./nextDayOpportunity.js";
import { getGapProbability } from "./gap.js";

import { getMomentum } from "./momentum.js";

import {
  getRank,
  getCategory
} from "./ranking.js";

import { generateWarnings } from "./warnings.js";

import { analyzeVolume } from "./volume.js";

import { getForecast } from "./forecast.js";

import {
  getRating,
  getProbability
} from "./rating.js";

import {
  generateReasons,
  calculateConfidence
} from "./reasoning.js";

import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands
} from "./technical.js";

import {
  calculateScore,
  recommendation,
  isReversalCandidate,
  isCapitulationBounceCandidate,
  hasStrongBuyConfirmation
} from "./scorer.js";

import {
  calculateSupport,
  calculateResistance,
  getATR,
  calculateStopLoss,
  calculateTakeProfitLevels,
  calculateRiskReward,
  calculateRiskRewardLevels
} from "./risk.js";

import {
  getMarketTrend,
  getRiskLevel,
  getEntryTiming,
  getFinalVerdict
} from "./verdict.js";

import { analyzeFundamental } from "./fundamental.js";

import { detectBreakout } from "./indicators/breakout.js";

import { calculateClosingStrength, classifyClosingStrength } from "./indicators/closingStrength.js";

import { calculateVolumeAcceleration } from "./indicators/volumeAcceleration.js";

import { calculateRelativeStrength, nDayReturn } from "./relativeStrength.js";

import { calculateSessionGainScore } from "./sessionGainScore.js";

import { checkLiquidity } from "./liquidity.js";

import { calculateExhaustion } from "./indicators/exhaustion.js";

import { calculateDistribution } from "./indicators/distribution.js";

export function analyzeStock(data) {

  const close = data.closePrices.at(-1);

  // Kenaikan hari ini vs close kemarin — DITAMBAHKAN 14 Agustus 2026,
  // dipicu laporan user: saham (VERN, AHAP) yang sudah naik >7% hari ini
  // masih muncul sebagai "PRIORITAS" di Next-Day Opportunity, padahal
  // "TIMING TEKNIKAL" (getEntryTiming, verdict.js) sudah bilang AVOID untuk
  // saham yang sama - dua mesin berjalan sendiri-sendiri tanpa saling
  // tahu. Root cause: TIDAK ADA fitur yang secara langsung mengukur
  // "sudah naik berapa persen hari ini" di seluruh engine (RSI/exhaustion/
  // jarak resistance semua cuma proxy tidak langsung) - jarak resistance
  // 0% + RSI 70an bisa berasal dari rally pelan berhari-hari (aman) ATAU
  // gap up 7%+ dalam satu hari (mengejar harga/chasing, jauh lebih
  // berisiko), tapi kedua kondisi itu sebelumnya diskor SAMA.
  // Dipakai sebagai guard tambahan di engine/nextDayOpportunity.js.
  const previousClose = data.closePrices.at(-2);
  const dailyChangePercent =
    Number.isFinite(previousClose) && previousClose > 0
      ? Number((((close - previousClose) / previousClose) * 100).toFixed(2))
      : null;

  // ==========================
  // Liquidity Guard (saham beku / floor price / gocap)
  // ==========================
  // Dihitung di awal, tapi TIDAK memotong pipeline di bawah — semua
  // indikator lain tetap dihitung normal (perlu tetap konsisten untuk
  // dataset training). Baru dipakai untuk override signal/sessionGain
  // di bagian akhir, supaya fungsi internal (verdict, warnings, gap,
  // dst yang branch dari `signal`) tidak perlu tahu soal ini.
  const liquidity = checkLiquidity(data.candles);

  // ==========================
  // Technical Indicators
  // ==========================

  const sma20 = calculateSMA(data.closePrices, 20);
  const sma50 = calculateSMA(data.closePrices, 50);

  const ema9 = calculateEMA(data.closePrices, 9);
  const ema20 = calculateEMA(data.closePrices, 20);

  const rsi = calculateRSI(data.closePrices);

  const macd = calculateMACD(data.closePrices);

  const bollinger = calculateBollingerBands(data.closePrices);

  const volume = analyzeVolume(
    data.volumes
  );

  // ==========================
  // Breakout, Closing Strength, Volume Acceleration
  // ==========================

  const breakout = detectBreakout(data.candles, {
    lookback: 20,
    volumeRatio: volume.ratio
  });

  const closingStrengthValue = calculateClosingStrength(data.candles.at(-1));
  const closingStrength = closingStrengthValue;
  const closingStrengthLabel = classifyClosingStrength(closingStrengthValue);

  const volumeAcceleration = calculateVolumeAcceleration(data.volumes);

  // ==========================
  // Exhaustion & Distribution (31 Juli 2026) — lihat catatan lengkap
  // di engine/indicators/exhaustion.js & distribution.js. Dihitung
  // dari histori candle saham itu sendiri. ATR dipindah ke sini
  // (dipakai exhaustion) supaya cuma dihitung sekali; bagian Risk
  // Management di bawah pakai variabel `atr` yang sama, bukan hitung
  // ulang.
  // ==========================

  const atr = getATR(data.candles, 14);

  const exhaustion = calculateExhaustion({
    closePrices: data.closePrices,
    atr
  });

  const distribution = calculateDistribution({
    candles: data.candles
  });

  // ==========================
  // Relative Strength vs IHSG & Sektor
  // ==========================
  // data.ihsgCloses & data.sectorReturn diisi oleh caller (api/analyze.js
  // atau api/scan.js) kalau tersedia — kalau tidak, RS dilewati (null),
  // bukan dianggap 0 (netral tapi bukan "tidak diukur").

  const stockReturn = nDayReturn(data.closePrices, 20);
  const ihsgReturn = data.ihsgCloses ? nDayReturn(data.ihsgCloses, 20) : null;

  const relativeStrength = calculateRelativeStrength({
    stockReturn,
    ihsgReturn,
    sectorReturn: data.sectorReturn ?? null
  });

  // ==========================
  // Risk Management (ATR-based) — `atr` sudah dihitung di atas
  // (dipakai exhaustion), dipakai ulang di sini.
  // ==========================

  const support = calculateSupport(data.candles, 20);

  const resistance = calculateResistance(data.candles, 20);

  const stopLoss = calculateStopLoss(close, atr, 1.0);

  const takeProfitLevels = calculateTakeProfitLevels(close, atr, resistance);

  // TP2 dipakai sebagai target utama untuk skor/verdict internal,
  // sementara TP1 & TP3 tersedia untuk take-profit bertahap.
  const takeProfit = takeProfitLevels.tp2;

  const riskReward = calculateRiskReward(
    close,
    stopLoss,
    takeProfit
  );

  const riskRewardLevels = calculateRiskRewardLevels(
    close,
    stopLoss,
    takeProfitLevels
  );

  // ==========================
  // Fundamental Analysis
  // ==========================
  // data.fundamental diisi oleh api/analyze.js sebelum memanggil
  // analyzeStock() — kalau kosong/tidak ada, analyzeFundamental()
  // menetralkan skornya ke 50 (tidak menghukum).
  //
  // CATATAN (3 Agustus 2026): fundamental.score TIDAK LAGI di-blend ke
  // skor akhir (lihat riwayat di bawah) — ketahuan bahwa api/scan.js
  // (batch) tidak pernah mengisi data.fundamental sama sekali, sementara
  // api/analyze.js (manual satu-saham) selalu mengisi. Akibatnya skor
  // yang sama persis bisa beda antara hasil batch scan vs analisa manual
  // untuk saham yang sama (batch selalu dapat skor fundamental netral 50,
  // manual dapat skor fundamental asli) — bisa menggeser sinyal/verdict
  // (mis. BUY vs STRONG BUY) padahal teknikalnya identik. Daripada
  // menambah fetch fundamental ke scan.js (berisiko timeout di Vercel
  // Hobby plan untuk scan universe penuh ~240+ kode), fundamental
  // dilepas dari skor sepenuhnya. fundamental.label & fundamental.warnings
  // tetap dihitung & ditampilkan (di halaman analisa manual saja, karena
  // cuma di situ data.fundamental terisi) sebagai info tambahan, TIDAK
  // memengaruhi score/signal/verdict lagi.

  const fundamental = analyzeFundamental(data.fundamental || {});

  // ==========================
  // AI Score
  // ==========================

  let score = calculateScore({
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    rsi,
    macd,
    volume,
    riskReward,
    breakout,
    closingStrength,
    volumeAcceleration,
    relativeStrength,
    exhaustion,
    distribution
  });

  // Flag terpisah (bukan cuma andalkan bonus di dalam skor) supaya
  // scan_history bisa mencatat mana yang kena bonus reversal ini —
  // dipakai untuk validasi pola nanti, lihat catatan di scorer.js.
  const reversalCandidate = isReversalCandidate({
    rsi,
    macd,
    close,
    sma50,
    closingStrength,
    relativeStrength
  });

  // Sama seperti reversalCandidate di atas — dicatat terpisah supaya
  // scan_history bisa validasi pola "capitulation bounce" (lihat catatan
  // lengkap di scorer.js). Mutually exclusive dengan reversalCandidate
  // (yang satu butuh close > sma50, yang ini close < sma50).
  const capitulationBounceCandidate = isCapitulationBounceCandidate({
    rsi,
    macd,
    close,
    sma50,
    closingStrength,
    relativeStrength
  });

  // Skor akhir MURNI teknikal (lihat catatan "Fundamental Analysis" di
  // atas) — dulu di sini ada blend 80% teknikal + 20% fundamental, sudah
  // dilepas supaya skor konsisten antara batch scan dan analisa manual.
  score = Math.max(0, Math.min(score, 100));

  let signal = recommendation(score);

  // Gate STRONG BUY dengan konfirmasi volume+breakout+RSI (7 Agustus 2026)
  // — lihat catatan lengkap di hasStrongBuyConfirmation() (scorer.js).
  // Kalau skor tembus ambang STRONG BUY (>=90) tapi konfirmasi pola ini
  // tidak ada, diturunkan ke BUY biasa DI SINI (sebelum entry/verdict/
  // warnings/session-gain di bawah dihitung) — supaya semuanya konsisten
  // dengan signal yang sudah digate, bukan cuma label akhirnya doang yang
  // beda tapi verdict/entry masih menganggap STRONG BUY. Flag-nya dicatat
  // terpisah ke scan_history untuk semua signal (bukan cuma STRONG BUY)
  // supaya bisa dievaluasi lebih lanjut dari data yang terus bertambah.
  const strongBuyConfirmed = hasStrongBuyConfirmation({ breakout, volume, rsi });

  if (signal === "STRONG BUY" && !strongBuyConfirmed) {
    signal = "BUY";
  }

  // ==========================
  // Confidence & Reasons
  // ==========================

  const confidence = calculateConfidence({
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    macd,
    riskReward
  });

  const reasons = generateReasons({
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    rsi,
    macd,
    riskReward,
    breakout,
    closingStrength,
    volumeAcceleration,
    relativeStrength
  });

  // ==========================
  // Final Verdict
  // ==========================

  const marketTrend = getMarketTrend({
    close,
    sma20,
    sma50,
    ema9,
    ema20,
    macd
  });

  const riskLevel = getRiskLevel({
    rsi,
    riskReward
  });

  const entry = getEntryTiming({
    signal,
    rsi,
    riskReward,
    breakout,
    exhaustion,
    distribution
  });

  const rating = getRating(score);

  const probability = getProbability({
    score,
    confidence
  });

  const momentum = getMomentum({
    close,
    sma20,
    ema9,
    ema20,
    rsi,
    macd,
    volume
  });

  // Final signal is needed by the multi-day verdict calculation.
  // Define it BEFORE getFinalVerdict() to avoid temporal-dead-zone errors.
  const finalSignal = liquidity.illiquid ? "TIDAK LIKUID" : signal;

  const verdict = getFinalVerdict({
    score,
    signal: finalSignal,
    confidence,
    marketTrend,
    momentum,
    volume,
    breakout,
    relativeStrength,
    rsi,
    macd
  });

  const gap = getGapProbability({
    score,
    confidence,
    momentum,
    volume,
    rsi,
    marketTrend,
    rsLabel: relativeStrength?.label,
    calibrationMap: data.gapCalibration
  });

  const rank = getRank(
    score,
    confidence,
    riskReward
  );

  // ==========================
  // Session Gain Score (potensi gain intraday, lihat sessionGainScore.js)
  // ==========================

  const sessionGain = calculateSessionGainScore({
    signal,
    score,
    volumeAccelerating: volumeAcceleration?.accelerating,
    volumeSignal: volume?.signal,
    volumeRatio: volume?.ratio,
    gapOutlook: gap?.outlook,
    rsLabel: relativeStrength?.label
  });

  // ==========================
  // Next-Day Opportunity Engine (shadow)
  // Fokus: Close H -> High/Close H+1, bukan gap/open.
  // Tidak mengubah signal/verdict lama.
  // ==========================
  const nextDayOpportunity = calculateNextDayOpportunity({
    score,
    volume,
    volumeAcceleration,
    breakout,
    relativeStrength,
    exhaustion,
    distribution,
    liquidity,
    riskReward,
    closingStrength,
    marketTrend,
    rsi,
    macd,
    dailyChangePercent
  });

  // Cross-check dengan TIMING TEKNIKAL (entry, getEntryTiming di atas) —
  // ditambahkan 14 Agustus 2026, respons ke laporan user: VERN/AHAP
  // muncul PRIORITAS/HIGH di Next-Day Opportunity padahal TIMING TEKNIKAL
  // untuk saham yang sama, di waktu yang sama, sudah AVOID. Kedua modul
  // ini SENGAJA menjawab pertanyaan berbeda (lihat catatan di
  // nextDayOpportunity.js: fokus close H -> H+1, bukan "masuk sekarang
  // juga") - jadi perbedaan itu sendiri BUKAN bug. Tapi UI menampilkan
  // "Verdict Next-Day: Strategi Beli Sore" sebagai rekomendasi aksi
  // tanpa menyebut kalau timing entry hari itu sendiri sedang AVOID -
  // berpotensi menyesatkan. Flag ini TIDAK mengubah skor/label
  // manapun, cuma dicatat supaya UI bisa menampilkan catatan silang.
  const entryTimingConflict =
    entry === "AVOID" && nextDayOpportunity.eligible;

  // Saham beku/tidak likuid: signal & session-gain internal (dihitung
  // dari `signal`/`score` di atas) tidak boleh ditampilkan apa adanya,
  // karena tidak ada transaksi wajar untuk disimpulkan arahnya — lihat
  // engine/liquidity.js. `finalSignal` sudah ditentukan sebelum verdict
  // agar tidak terjadi ReferenceError / temporal-dead-zone.
  const finalSessionGain = liquidity.illiquid
    ? {
        sessionGainScore: 0,
        label: "TIDAK LIKUID",
        breakdown: null,
        note: liquidity.detail
      }
    : sessionGain;

  const category = getCategory(rank);

  const technicalWarnings = generateWarnings({
    score,
    signal,
    rsi,
    riskReward,
    volume,
    atr,
    close,
    closingStrength,
    relativeStrength,
    exhaustion,
    distribution
  });

  // Kalau fundamental punya warning nyata, buang placeholder
  // "Tidak ada peringatan penting." dari sisi teknikal supaya
  // tidak muncul kontradiktif berdampingan dengan warning asli.
  let warnings = fundamental.warnings.length
    ? [
        ...technicalWarnings.filter(w => w !== "Tidak ada peringatan penting."),
        ...fundamental.warnings
      ]
    : technicalWarnings;

  if (liquidity.illiquid) {
    warnings = [
      `Saham tidak likuid (${liquidity.reason}): ${liquidity.detail}. Signal & session gain score tidak ditampilkan apa adanya.`,
      ...warnings.filter(w => w !== "Tidak ada peringatan penting.")
    ];
  }

  const forecast = getForecast({
    close,
    score,
    confidence,
    marketTrend,
    rsi
  });

  // ==========================
  // Response
  // ==========================

  return {
    kode: data.kode,

    close,

    sma20,
    sma50,

    ema9,
    ema20,

    rsi,

    macd,

    bollinger,

    volume,

    score,
    signal: finalSignal,
    reversalCandidate,
    capitulationBounceCandidate,
    strongBuyConfirmed,
    volumeRsSynergy: Boolean(finalSessionGain.breakdown?.synergyPts),
    dailyChangePercent,
    entryTimingConflict,

    confidence,
    reasons,

    marketTrend,
    riskLevel,
    entry,
    verdict,
    verdictHorizon: "MULTI_DAY",

    rating,
    probability,

    rank,
    category,
    forecast,

    atr,
    support,
    resistance,

    stopLoss,
    takeProfit,
    takeProfitLevels,

    riskReward,
    riskRewardLevels,
    warnings,

    momentum,
    gap,

    sessionGain: finalSessionGain,

    nextDayOpportunity,

    liquidity,

    breakout,
    closingStrength,
    closingStrengthLabel,
    volumeAcceleration,
    relativeStrength,

    exhaustion,
    distribution,

    fundamental,

    timestamp: new Date().toISOString()
  };

}
