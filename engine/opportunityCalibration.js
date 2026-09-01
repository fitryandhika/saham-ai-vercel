// ============================================================
// SahamAI Opportunity V3 — Empirical Model + Calibration
// ============================================================
// Model fitted from scan_history_export_2026-09-01.csv.
// Training window: 2026-07-15 .. 2026-08-14 (close-labeled rows)
// Test window:     2026-08-15 .. 2026-08-31
//
// IMPORTANT:
// - This model predicts H+1 opportunity from CLOSE H.
// - It is intentionally independent of the legacy score.
// - Probabilities are calibrated with weighted monotonic (PAV/isotonic)
//   mapping built on training-only predictions.
// - Retrain/recalibrate when enough new close-labeled observations exist.

export const OPPORTUNITY_MODEL_VERSION = "v3.0-empirical-2026-09-02";

export const NUMERIC_FEATURES = [
  "rs_vs_ihsg",
  "volume_ratio",
  "volume_accel_slope_pct",
  "breakout_distance_pct",
  "rsi",
  "macd",
  "risk_reward",
  "closing_strength"
];

// Training mean/std. Used to reproduce the fitted standardized logistic model.
export const FEATURE_STATS = {
  rs_vs_ihsg: { mean: 2.88203923, scale: 15.42438480, min: -33.2647, max: 77.9813 },
  volume_ratio: { mean: 1.09839112, scale: 1.25639343, min: 0.0, max: 8.2655 },
  volume_accel_slope_pct: { mean: -3.86852618, scale: 45.62023872, min: -114.2617, max: 129.1189 },
  breakout_distance_pct: { mean: -8.25641218, scale: 7.81115591, min: -39.3817, max: 6.4 },
  rsi: { mean: 58.74637967, scale: 16.07666691, min: 15.72, max: 100.0 },
  macd: { mean: 11.79229663, scale: 53.91128352, min: -169.8834, max: 335.1950 },
  risk_reward: { mean: 1.39073359, scale: 0.51483293, min: 0.0, max: 1.75 },
  closing_strength: { mean: 0.47027349, scale: 0.30383656, min: 0.0, max: 1.0 }
};

// Coefficients from regularized logistic models.
// setup coefficient is added after numeric feature contribution.
export const LOGISTIC_MODELS = {
  p3: {
    intercept: -0.5195633191,
    coefficients: {
      rs_vs_ihsg: 0.3608976992,
      volume_ratio: 0.1922787427,
      volume_accel_slope_pct: 0.0514418357,
      breakout_distance_pct: -0.4113942719,
      rsi: 0.1090628499,
      macd: -0.0683134520,
      risk_reward: 0.1030631215,
      closing_strength: -0.1004100060
    },
    setup: {
      CONFIRMED_BREAKOUT: 0.0613428619,
      GENERAL: -0.5431256315,
      PRE_BREAKOUT_ACCUMULATION: -0.0540507020,
      REVERSAL_ABSORPTION: -0.0830727546,
      VOLUME_EXPANSION: 0.3079788897
    }
  },

  p5: {
    intercept: -1.1959146340,
    coefficients: {
      rs_vs_ihsg: 0.3790762142,
      volume_ratio: 0.1904781753,
      volume_accel_slope_pct: 0.0450535580,
      breakout_distance_pct: -0.4172259572,
      rsi: 0.1048006009,
      macd: -0.1483260568,
      risk_reward: 0.0787393776,
      closing_strength: -0.0065594312
    },
    setup: {
      CONFIRMED_BREAKOUT: 0.0320251625,
      GENERAL: -0.7365067661,
      PRE_BREAKOUT_ACCUMULATION: -0.0489539559,
      REVERSAL_ABSORPTION: -0.3130581616,
      VOLUME_EXPANSION: 0.0256027575
    }
  },

  p10: {
    intercept: -2.7678133644,
    coefficients: {
      rs_vs_ihsg: 0.4293658325,
      volume_ratio: 0.2967941383,
      volume_accel_slope_pct: -0.0317103965,
      breakout_distance_pct: -0.4775468468,
      rsi: 0.0859597648,
      macd: -0.1236960032,
      risk_reward: 0.0962552868,
      closing_strength: 0.1253396497
    },
    setup: {
      CONFIRMED_BREAKOUT: 0.2822687640,
      GENERAL: -0.5409363035,
      PRE_BREAKOUT_ACCUMULATION: -0.0360068950,
      REVERSAL_ABSORPTION: 0.0357367561,
      VOLUME_EXPANSION: 0.2274381910
    }
  },

  close2: {
    intercept: -1.0828486127,
    coefficients: {
      rs_vs_ihsg: 0.2207018169,
      volume_ratio: -0.0190419832,
      volume_accel_slope_pct: 0.1061206665,
      breakout_distance_pct: -0.1681494861,
      rsi: 0.0196371738,
      macd: 0.0066809495,
      risk_reward: 0.1462052510,
      closing_strength: -0.0683511748
    },
    setup: {
      CONFIRMED_BREAKOUT: 0.0194465378,
      GENERAL: -0.5563375848,
      PRE_BREAKOUT_ACCUMULATION: -0.1893192047,
      REVERSAL_ABSORPTION: -0.2569466550,
      VOLUME_EXPANSION: 0.0858063204
    }
  }
};

// Training-only 12-quantile-bin monotonic calibration.
// Each array is [raw model probability, calibrated probability].
export const CALIBRATION = {
  p3: [
    [0.1299, 0.0864], [0.1642, 0.1420], [0.1844, 0.1559],
    [0.2004, 0.1952], [0.2157, 0.1952], [0.2309, 0.2438],
    [0.2493, 0.2828], [0.2720, 0.3153], [0.3038, 0.3338],
    [0.3475, 0.3586], [0.4199, 0.4683], [0.6101, 0.5502]
  ],
  p5: [
    [0.0610, 0.0355], [0.0784, 0.0525], [0.0875, 0.0795],
    [0.0950, 0.0795], [0.1026, 0.1111], [0.1110, 0.1111],
    [0.1214, 0.1314], [0.1343, 0.1406], [0.1522, 0.1638],
    [0.1811, 0.2040], [0.2356, 0.2736], [0.4199, 0.3972]
  ],
  p10: [
    [0.0145, 0.0062], [0.0196, 0.0108], [0.0223, 0.0231],
    [0.0247, 0.0231], [0.0272, 0.0270], [0.0300, 0.0270],
    [0.0334, 0.0294], [0.0381, 0.0417], [0.0442, 0.0541],
    [0.0552, 0.0726], [0.0787, 0.0773], [0.1947, 0.1901]
  ],
  close2: [
    [0.0992, 0.0802], [0.1194, 0.0988], [0.1325, 0.1358],
    [0.1428, 0.1451], [0.1511, 0.1451], [0.1587, 0.1451],
    [0.1661, 0.1716], [0.1749, 0.1808], [0.1858, 0.2141],
    [0.2012, 0.2141], [0.2281, 0.2643], [0.3138, 0.2782]
  ]
};

export function sigmoid(x) {
  const z = Math.max(-30, Math.min(30, Number(x) || 0));
  return 1 / (1 + Math.exp(-z));
}

export function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function standardizeFeature(name, value) {
  const stats = FEATURE_STATS[name];
  const n = Number(value);
  if (!stats || !Number.isFinite(n)) return 0;

  const clipped = Math.max(stats.min, Math.min(stats.max, n));
  const scale = stats.scale || 1;
  return (clipped - stats.mean) / scale;
}

export function rawModelProbability(modelKey, features = {}, setup = "GENERAL") {
  const model = LOGISTIC_MODELS[modelKey];
  if (!model) return null;

  let z = model.intercept;

  for (const name of NUMERIC_FEATURES) {
    z += (model.coefficients[name] || 0) *
      standardizeFeature(name, features[name]);
  }

  z += model.setup?.[setup] || 0;

  return sigmoid(z);
}

export function calibrateProbability(modelKey, rawProbability) {
  const table = CALIBRATION[modelKey];
  const p = clamp01(rawProbability);

  if (!Array.isArray(table) || table.length === 0) return p;
  if (p <= table[0][0]) return table[0][1];

  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    const [x0, y0] = table[i - 1];

    if (p <= x1) {
      const t = x1 === x0 ? 0 : (p - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }

  return table[table.length - 1][1];
}
