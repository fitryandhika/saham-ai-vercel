// ==========================
// Gap Calibration — kalibrasi Gap Probability dari data historis
// ==========================
//
// Ditambahkan 2 Agustus 2026, tahap lanjutan setelah exhaustion &
// distribution engine. engine/gap.js sebelumnya MURNI rumus heuristik
// (bobot ditebak manual, tidak pernah divalidasi ke hasil aktual).
// Modul ini menghitung win rate EMPIRIS dari scan_history (kolom
// gap_up_realized & next_day_return_pct yang sudah dikumpulkan sejak
// awal proyek) per kombinasi bucket, supaya gap.js bisa di-blend
// dengan angka yang benar-benar terjadi — bukan cuma tebakan.
//
// Bucket sengaja dibuat rendah-dimensi (score bucket x RSI zone x
// volume signal x arah relative strength = maksimal 5x3x3x2 = 90
// kombinasi) supaya dengan ~5.700 baris data yang ada sekarang, tiap
// bucket masih punya cukup sampel (median ~27 baris per bucket 4-dimensi
// ini, per validasi 7 Agustus 2026). Kalau nanti datanya sudah puluhan
// ribu baris, granularitas ini bisa dipertajam lagi (misal tambah
// market_regime) — TAPI itu keputusan terpisah, jangan ubah tanpa cek
// dulu sampel per bucket tidak jadi terlalu tipis (lihat
// MIN_SAMPLE_FOR_TRUST di bawah, dan SHRINKAGE_K di engine/gap.js).
//
// Dipakai di 2 tempat:
//   1. api/label-outcomes-close.js (best-effort, setelah label harian
//      selesai) -> hitung ulang tabel dari SEMUA baris yang sudah
//      dilabel, simpan ke tabel gap_calibration lewat
//      services/gapCalibrationService.js.
//   2. engine/gap.js -> baca tabel yang sudah dihitung (bukan hitung
//      ulang saat itu juga, supaya scan harian tetap cepat), dipakai
//      untuk blending Bayesian shrinkage.

// Sama persis dengan SCORE_BUCKETS di engine/evaluationStats.js —
// supaya bucket di kalibrasi ini nyambung langsung dengan tampilan
// "Win rate per bucket skor AI" yang sudah ada di halaman Riwayat AI.
const SCORE_BUCKETS = [
  { label: "0-34", min: 0, max: 34 },
  { label: "35-54", min: 35, max: 54 },
  { label: "55-74", min: 55, max: 74 },
  { label: "75-89", min: 75, max: 89 },
  { label: "90-100", min: 90, max: 100 }
];

function scoreBucketLabel(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  const bucket = SCORE_BUCKETS.find((b) => score >= b.min && score <= b.max);
  return bucket ? bucket.label : null;
}

function rsiZone(rsi) {
  if (typeof rsi !== "number" || Number.isNaN(rsi)) return null;
  if (rsi < 30) return "OVERSOLD";
  if (rsi > 70) return "OVERBOUGHT";
  return "NORMAL";
}

// Ditambahkan 7 Agustus 2026: arah relative strength (underperform pasar
// atau tidak). Sebelumnya bucket HANYA score x RSI zone x volume — tidak
// bisa membedakan saham yang lagi underperform pasar (rawan capitulation
// bounce, lihat isCapitulationBounceCandidate di engine/scorer.js) dari
// yang tidak. Validasi terhadap 5.692 baris scan_history (15 Jul-6 Agt
// 2026): dalam bucket score-RSI-volume yang SAMA, win rate gap_up_realized
// bisa beda jauh antara UNDER vs NOT_UNDER (kadang UNDER lebih tinggi,
// kadang lebih rendah, tergantung bucket) — arahnya TIDAK konsisten satu
// arah, jadi tidak aman ditambal sebagai adjustment heuristik manual di
// gap.js. Lebih aman dibiarkan mesin Bayesian shrinkage yang sudah ada
// yang belajar arah yang benar PER bucket dari data, dengan bucket kecil
// otomatis fallback ke heuristik (lihat SHRINKAGE_K di gap.js). Sengaja
// cuma 2 level (bukan 5 level rs_label penuh) supaya sampel per bucket
// tidak jadi terlalu tipis — median sampel per bucket 4-dimensi ini masih
// ~27 baris dari data saat ini.
function rsDirection(rsLabel) {
  if (rsLabel === "UNDERPERFORM" || rsLabel === "JAUH UNDERPERFORM") return "UNDER";
  if (rsLabel === "OUTPERFORM" || rsLabel === "JAUH OUTPERFORM" || rsLabel === "NETRAL") return "NOT_UNDER";
  return null;
}

// Kunci bucket dipakai untuk MENYIMPAN (dari histori) maupun MEMBACA
// (dari saham yang sedang dianalisa) — harus identik supaya lookup
// nyambung. Kembalikan null kalau salah satu komponen tidak valid,
// supaya pemanggil tahu bucket ini tidak bisa dipercaya (bukan
// nyasar ke bucket "UNKNOWN|UNKNOWN|UNKNOWN|UNKNOWN" yang menyesatkan).
export function getBucketKey({ score, rsi, volumeSignal, rsLabel }) {
  const sb = scoreBucketLabel(score);
  const rz = rsiZone(rsi);
  const rd = rsDirection(rsLabel);
  if (!sb || !rz || !volumeSignal || !rd) return null;
  return `${sb}|${rz}|${volumeSignal}|${rd}`;
}

function avg(nums) {
  const valid = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function round(n, digits) {
  if (n === null || n === undefined) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

// Hitung tabel kalibrasi dari baris scan_history yang SUDAH dilabel
// (gap_up_realized terisi). Baris tanpa score/rsi/volume_signal valid
// dilewati (tidak masuk bucket manapun) — lebih baik dibuang daripada
// mencemari bucket lain dengan data tidak lengkap.
export function computeGapCalibration(rows) {
  const groups = new Map();

  for (const r of rows) {
    if (r.gap_up_realized === null || r.gap_up_realized === undefined) continue;

    const key = getBucketKey({ score: r.score, rsi: r.rsi, volumeSignal: r.volume_signal, rsLabel: r.rs_label });
    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const table = [];
  for (const [bucketKey, group] of groups.entries()) {
    const wins = group.filter((r) => r.gap_up_realized === true).length;
    table.push({
      bucket_key: bucketKey,
      sample_count: group.length,
      win_rate: round(wins / group.length, 4),
      avg_return_pct: round(avg(group.map((r) => r.next_day_return_pct)), 2)
    });
  }

  return table;
}

export default computeGapCalibration;
