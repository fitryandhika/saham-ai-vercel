// ============================================================
// SahamAI Opportunity V4 — Empirical Model + Calibration
// ============================================================
// Fitted from scan_history_export_2026-09-02.csv
// Rows: 11129 close-labeled scans, 2026-07-16 .. 2026-09-01
//
// APA YANG BERUBAH DARI V3 (dan kenapa V3 gagal):
//
// 1) V3 sama sekali tidak punya fitur VOLATILITAS. Padahal atr_pct
//    adalah prediktor tunggal terkuat untuk "naik >=5% besok"
//    (Spearman +0.36 terhadap max gain; semua fitur lain <0.17).
//    Tanpa ATR, V3 memberi skor tinggi ke saham yang secara fisik
//    tidak sanggup bergerak 5% dalam sehari.
//
// 2) breakout_distance_pct dipakai LINEAR dengan koefisien negatif.
//    Hubungan sebenarnya berbentuk U:
//      distance <= -20%  -> win rate 25.5%
//      -10% s/d -5%      -> 13.7%
//      -2% s/d 0%        ->  9.3%   <- zona mati
//      di atas resistance-> 33.3%   <- TERBAIK, tapi diberi skor rendah
//    Model linear memaksa satu arah, jadi sisi terbaiknya hilang.
//    V4 memecah jadi dist_below / dist_above / above_res.
//
// 3) macd dipakai sebagai nilai absolut. MACD 100 pada saham Rp5.000
//    dan MACD 1 pada saham Rp100 adalah momentum yang sama. V4 memakai
//    macd_pct = macd / close * 100.
//
// 4) Tidak ada fitur level harga. Di IDX, fraksi harga membuat saham
//    Rp100 bergerak >=2% hanya dari satu tick. V4 memakai log_close
//    supaya efek mekanis ini dimodelkan, bukan bocor lewat fitur lain.
//
// HASIL OUT-OF-SAMPLE (dilatih <=14 Ags, diuji 18 Ags - 1 Sep):
//   AUC target >=5%:  V3 = 0.570  ->  V4 = 0.719
//   Label HIGH  :  V3 n=115, win >=5% 35.7%, median peak 2.33%,
//                  EV target +3% = -0.55%, hold-to-close = -0.24%
//                  V4 n=586, win >=5% 42.2%, median peak 4.02%,
//                  EV target +3% = +0.66%, hold-to-close = +0.75%
//
// Retrain ketika ada ~1.500 baris close-labeled baru.

export const OPPORTUNITY_MODEL_VERSION = "v4.0-empirical-2026-09-03";

export const NUMERIC_FEATURES = [
  "atr_pct",
  "log_close",
  "dist_below",
  "dist_above",
  "above_res",
  "log_vr",
  "va",
  "rs",
  "rsi_c",
  "macd_pct",
  "cs",
  "ext20",
  "ext50"
];

// Mean/scale dari data training. Dipakai untuk mereproduksi model
// logistik terstandarisasi.
export const FEATURE_STATS = {
  "atr_pct": {
    "mean": 4.85822771,
    "scale": 2.64439206
  },
  "log_close": {
    "mean": 6.02645475,
    "scale": 1.46937346
  },
  "dist_below": {
    "mean": -8.83418007,
    "scale": 7.71343778
  },
  "dist_above": {
    "mean": 0.21878785,
    "scale": 1.30308558
  },
  "above_res": {
    "mean": 0.05508132,
    "scale": 0.22813892
  },
  "log_vr": {
    "mean": 0.65879119,
    "scale": 0.42146452
  },
  "va": {
    "mean": -2.11392039,
    "scale": 46.05878007
  },
  "rs": {
    "mean": 3.46415581,
    "scale": 16.83406375
  },
  "rsi_c": {
    "mean": 57.81255459,
    "scale": 16.39616402
  },
  "macd_pct": {
    "mean": 1.20279924,
    "scale": 3.43432617
  },
  "cs": {
    "mean": 0.4680328,
    "scale": 0.30842262
  },
  "ext20": {
    "mean": 3.86197807,
    "scale": 9.40265425
  },
  "ext50": {
    "mean": 6.81640902,
    "scale": 14.859301
  }
};

export const LOGISTIC_MODELS = {
  p3: { intercept: -0.95332861, coefficients: {
  "atr_pct": 0.60339798,
  "log_close": -0.12864327,
  "dist_below": -0.04639756,
  "dist_above": 0.02637835,
  "above_res": 0.03556413,
  "log_vr": 0.25849265,
  "va": 0.02301647,
  "rs": -0.02243645,
  "rsi_c": 0.00782084,
  "macd_pct": 0.18335693,
  "cs": -0.15459752,
  "ext20": 0.20005351,
  "ext50": -0.25288436
} },
  p5: { intercept: -1.84466412, coefficients: {
  "atr_pct": 0.56536602,
  "log_close": -0.20757084,
  "dist_below": -0.12936954,
  "dist_above": 0.05294386,
  "above_res": 0.02192381,
  "log_vr": 0.27437371,
  "va": 0.01087722,
  "rs": -0.08011795,
  "rsi_c": -0.01153437,
  "macd_pct": 0.12922956,
  "cs": -0.06276835,
  "ext20": 0.28948157,
  "ext50": -0.17340927
} },
  p8: { intercept: -2.79258882, coefficients: {
  "atr_pct": 0.56098165,
  "log_close": -0.25991013,
  "dist_below": -0.18453749,
  "dist_above": 0.06641596,
  "above_res": -0.03057995,
  "log_vr": 0.29894068,
  "va": 0.03707409,
  "rs": -0.10737821,
  "rsi_c": -0.10128807,
  "macd_pct": 0.08846894,
  "cs": 0.03402216,
  "ext20": 0.46353498,
  "ext50": -0.19750685
} },
  close2: { intercept: -1.51035104, coefficients: {
  "atr_pct": 0.22932109,
  "log_close": 0.00708785,
  "dist_below": -0.09933773,
  "dist_above": 0.01540316,
  "above_res": 0.03523239,
  "log_vr": 0.12302413,
  "va": 0.0710676,
  "rs": 0.14449707,
  "rsi_c": -0.05029637,
  "macd_pct": 0.20498776,
  "cs": -0.1714146,
  "ext20": 0.11580769,
  "ext50": -0.32957566
} }
};

// Kalibrasi monotonik 12-bin (isotonic/PAV) — [raw prob, calibrated prob].
export const CALIBRATION = {
  "p3": [
    [
      0.1294,
      0.0539
    ],
    [
      0.1583,
      0.1036
    ],
    [
      0.1834,
      0.167
    ],
    [
      0.2062,
      0.2017
    ],
    [
      0.2306,
      0.2201
    ],
    [
      0.256,
      0.2468
    ],
    [
      0.2866,
      0.342
    ],
    [
      0.3245,
      0.342
    ],
    [
      0.3728,
      0.3567
    ],
    [
      0.4464,
      0.4304
    ],
    [
      0.5561,
      0.5329
    ],
    [
      0.9055,
      0.5884
    ]
  ],
  "p5": [
    [
      0.0544,
      0.0172
    ],
    [
      0.0677,
      0.0399
    ],
    [
      0.0804,
      0.0593
    ],
    [
      0.0932,
      0.0928
    ],
    [
      0.1071,
      0.0928
    ],
    [
      0.1239,
      0.1293
    ],
    [
      0.1432,
      0.1478
    ],
    [
      0.1677,
      0.1672
    ],
    [
      0.2016,
      0.1875
    ],
    [
      0.2558,
      0.2535
    ],
    [
      0.3552,
      0.3463
    ],
    [
      0.8199,
      0.4267
    ]
  ],
  "p8": [
    [
      0.0198,
      0.0032
    ],
    [
      0.0256,
      0.0086
    ],
    [
      0.0309,
      0.0248
    ],
    [
      0.0369,
      0.0248
    ],
    [
      0.0436,
      0.0378
    ],
    [
      0.0521,
      0.0463
    ],
    [
      0.0617,
      0.0712
    ],
    [
      0.0748,
      0.0712
    ],
    [
      0.0929,
      0.0905
    ],
    [
      0.1256,
      0.1521
    ],
    [
      0.1875,
      0.1661
    ],
    [
      0.7836,
      0.2769
    ]
  ],
  "close2": [
    [
      0.1134,
      0.0679
    ],
    [
      0.1295,
      0.1079
    ],
    [
      0.142,
      0.1282
    ],
    [
      0.1529,
      0.1392
    ],
    [
      0.1635,
      0.1899
    ],
    [
      0.1743,
      0.1899
    ],
    [
      0.1865,
      0.1899
    ],
    [
      0.201,
      0.2168
    ],
    [
      0.2193,
      0.2168
    ],
    [
      0.2467,
      0.2665
    ],
    [
      0.2902,
      0.2934
    ],
    [
      0.6773,
      0.305
    ]
  ]
};

export function sigmoid(x) {
  const z = Math.max(-30, Math.min(30, Number(x) || 0));
  return 1 / (1 + Math.exp(-z));
}

export function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

export function standardizeFeature(name, value) {
  const s = FEATURE_STATS[name];
  const n = Number(value);
  if (!s || !Number.isFinite(n)) return 0;
  return (n - s.mean) / (s.scale || 1);
}

export function rawModelProbability(modelKey, features = {}) {
  const model = LOGISTIC_MODELS[modelKey];
  if (!model) return null;
  let z = model.intercept;
  for (const name of NUMERIC_FEATURES) {
    z += (model.coefficients[name] || 0) * standardizeFeature(name, features[name]);
  }
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
