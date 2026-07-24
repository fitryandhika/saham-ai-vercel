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
  recommendation
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

export function analyzeStock(data) {

  const close = data.closePrices.at(-1);

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
  // Risk Management (ATR-based)
  // ==========================

  const atr = getATR(data.candles, 14);

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
    relativeStrength
  });

  // Blend skor teknikal (80%) dengan skor fundamental (20%).
  // Bobot fundamental sengaja kecil — strategi beli-sore-jual-pagi
  // tetap didominasi price action jangka pendek, fundamental cuma
  // jadi filter kualitas tambahan, bukan penentu utama.
  score = Math.round(score * 0.8 + fundamental.score * 0.2);
  score = Math.max(0, Math.min(score, 100));

  const signal = recommendation(score);

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
    breakout
  });

  const verdict = getFinalVerdict({
    score,
    signal,
    confidence,
    entry,
    riskLevel
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

  const gap = getGapProbability({
    score,
    confidence,
    momentum,
    volume,
    rsi,
    marketTrend
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

  // Saham beku/tidak likuid: signal & session-gain internal (dihitung
  // dari `signal`/`score` di atas) tidak boleh ditampilkan apa adanya,
  // karena tidak ada transaksi wajar untuk disimpulkan arahnya — lihat
  // engine/liquidity.js. Override HANYA di sini (output), supaya semua
  // fungsi internal di atas (verdict, warnings, gap, entry) tetap
  // konsisten secara matematis dan tidak perlu logic khusus.
  const finalSignal = liquidity.illiquid ? "TIDAK LIKUID" : signal;
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
    relativeStrength
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

    confidence,
    reasons,

    marketTrend,
    riskLevel,
    entry,
    verdict,

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

    liquidity,

    breakout,
    closingStrength,
    closingStrengthLabel,
    volumeAcceleration,
    relativeStrength,

    fundamental,

    timestamp: new Date().toISOString()
  };

}
