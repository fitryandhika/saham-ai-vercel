// ==========================
// Session Gain Score — potensi kenaikan harga INTRADAY dari open
// ==========================
//
// Skor terpisah dari `score`/`signal` utama (yang fokus ke arah closing
// besok). Ini fokus ke pertanyaan berbeda: "kalau jual pas di harga
// TERTINGGI hari itu (bukan cuma di close), seberapa besar potensinya?"
//
// Dasar: analisa 1.497 baris scan_history yang sudah dilabel
// max_gain_from_open_pct (22 Juli 2026). Temuan utama:
//   - Signal HOLD justru avg gain lebih tinggi (2.41%) dari BUY (1.90%)
//     atau bahkan STRONG BUY (2.19%) — sinyal utama TIDAK bisa dipakai
//     apa adanya untuk tujuan ini.
//   - volume_accelerating=true: avg 2.45% vs 1.88% kalau false.
//   - volume_signal EXPLOSIVE: avg 2.73%, tertinggi dari semua kategori.
//   - Score 51-80 lebih baik (2.2-2.5%) dari score sangat rendah (≤40,
//     cuma 0.70%) MAUPUN score sangat tinggi (81-100, cuma 1.97%).
//   - gap_outlook POSSIBLE GAP DOWN / NEUTRAL / HIGH GAP UP semuanya
//     lebih baik dari POSSIBLE GAP UP (1.79%) — cukup counterintuitive.
//   - Korelasi linear tiap indikator SENDIRIAN lemah (semua <0.11) —
//     kombinasi filter jauh lebih prediktif daripada satu indikator.
//     Kombinasi terbaik yang ditemukan (HOLD + score 51-80 +
//     volume_accelerating=true): avg gain 2.95%, n=149.
//
// CATATAN PENTING: ini pola dari ~1 bulan data, sampel per kombinasi
// masih terbatas (n=149 untuk kombo terbaik) — anggap sebagai heuristik
// awal yang perlu terus dievaluasi ulang seiring data bertambah, BUKAN
// kesimpulan final. Simpan skor ini sebagai kolom terpisah supaya bisa
// dibandingkan lagi dengan hasil aktual, sama seperti `score` utama.

const SIGNAL_POINTS = {
  "HOLD": 20,
  "STRONG BUY": 14,
  "BUY": 8,
  "SELL": 8,
  "STRONG SELL": 0
};

const VOLUME_SIGNAL_POINTS = {
  "EXPLOSIVE": 20,
  "HIGH": 12,
  "NORMAL": 8,
  "LOW": 6
};

const GAP_OUTLOOK_POINTS = {
  "POSSIBLE GAP DOWN": 20,
  "NEUTRAL": 20,
  "HIGH GAP UP": 18,
  "POSSIBLE GAP UP": 8,
  "HIGH GAP DOWN": 0
};

function scoreBucketPoints(score) {
  if (score == null || Number.isNaN(score)) return 0;
  if (score >= 51 && score <= 80) return 20; // rentang paling baik di data
  if (score >= 41 && score <= 50) return 10;
  if (score >= 81) return 10; // skor tinggi tidak berarti gain intraday tinggi
  return 3; // score <=40
}

function volumeAccelPoints(volumeAccelerating) {
  return volumeAccelerating === true ? 20 : 10;
}

// Total maksimal 100 (20+20+20+20+20). Dipecah jadi 5 komponen supaya
// tetap bisa ditelusuri komponen mana yang paling nyumbang, bukan cuma
// angka akhir tanpa penjelasan.
export function calculateSessionGainScore({
  signal,
  score,
  volumeAccelerating,
  volumeSignal,
  gapOutlook
} = {}) {
  const signalPts = SIGNAL_POINTS[signal] ?? 8;
  const scorePts = scoreBucketPoints(score);
  const volAccelPts = volumeAccelPoints(volumeAccelerating);
  const volSignalPts = VOLUME_SIGNAL_POINTS[volumeSignal] ?? 8;
  const gapPts = GAP_OUTLOOK_POINTS[gapOutlook] ?? 10;

  const total = signalPts + scorePts + volAccelPts + volSignalPts + gapPts;

  return {
    sessionGainScore: total, // 0-100
    label: classifySessionGainScore(total),
    breakdown: {
      signalPts,
      scorePts,
      volAccelPts,
      volSignalPts,
      gapPts
    }
  };
}

export function classifySessionGainScore(total) {
  if (total >= 80) return "TINGGI";
  if (total >= 60) return "SEDANG";
  if (total >= 40) return "RENDAH";
  return "SANGAT RENDAH";
}
