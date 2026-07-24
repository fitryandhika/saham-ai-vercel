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
//     atau bahkan STRONG BUY (2.19%) - sinyal utama TIDAK bisa dipakai
//     apa adanya untuk tujuan ini.
//   - volume_accelerating=true: avg 2.45% vs 1.88% kalau false.
//   - volume_signal EXPLOSIVE: avg 2.73%, tertinggi dari semua kategori.
//   - Score 51-80 lebih baik (2.2-2.5%) dari score sangat rendah (<=40,
//     cuma 0.70%) MAUPUN score sangat tinggi (81-100, cuma 1.97%).
//   - gap_outlook POSSIBLE GAP DOWN / NEUTRAL / HIGH GAP UP semuanya
//     lebih baik dari POSSIBLE GAP UP (1.79%) - cukup counterintuitive.
//   - Korelasi linear tiap indikator SENDIRIAN lemah (semua <0.11) -
//     kombinasi filter jauh lebih prediktif daripada satu indikator.
//     Kombinasi terbaik yang ditemukan (HOLD + score 51-80 +
//     volume_accelerating=true): avg gain 2.95%, n=149.
//
// UPDATE 24 Juli 2026 - analisa susulan 1.979 baris bersih (RSI edge-case
// & saham beku dibuang, lihat engine/liquidity.js), khusus mengukur
// korelasi tiap indikator dengan max_gain_from_open_pct:
//   rs_vs_ihsg r=0.105, volume_ratio r=0.100 -> DUA indikator ini
//     ternyata sedikit lebih kuat dari gap_probability (r=-0.050, nyaris
//     terbalik) dan breakout_distance_pct (r=-0.082) - jadi ditambahkan
//     sebagai komponen baru, sementara bobot gap_outlook DITURUNKAN
//     (bukan dihapus - arah polanya, POSSIBLE GAP DOWN/NEUTRAL lebih
//     baik dari POSSIBLE GAP UP, masih konsisten di data baru, r kecil
//     tapi bukan nol).
//
// CATATAN PENTING: semua korelasi di atas masih LEMAH (<0.15) dan dari
// ~1-1.5 bulan data - ini heuristik kombinasi, BUKAN model yang sudah
// tervalidasi. Jangan dipakai sebagai satu-satunya dasar keputusan beli;
// terus bandingkan skor ini dengan max_gain_from_open_pct aktual seiring
// data bertambah, dan siap dikalibrasi ulang.

const SIGNAL_POINTS = {
  "HOLD": 15,
  "STRONG BUY": 11,
  "BUY": 6,
  "SELL": 6,
  "STRONG SELL": 0
};

const VOLUME_SIGNAL_POINTS = {
  "EXPLOSIVE": 15,
  "HIGH": 9,
  "NORMAL": 6,
  "LOW": 4
};

const GAP_OUTLOOK_POINTS = {
  "POSSIBLE GAP DOWN": 15,
  "NEUTRAL": 15,
  "HIGH GAP UP": 13,
  "POSSIBLE GAP UP": 6,
  "HIGH GAP DOWN": 0
};

// Baru (24 Juli 2026) - dari rs_label yang sudah ada di relativeStrength.js.
// Korelasi rs_vs_ihsg numerik r=0.105 dengan max_gain_from_open_pct:
// saham yang outperform IHSG cenderung puncak intraday-nya sedikit lebih
// tinggi.
const RS_LABEL_POINTS = {
  "JAUH OUTPERFORM": 15,
  "OUTPERFORM": 12,
  "NETRAL": 8,
  "UNDERPERFORM": 5,
  "JAUH UNDERPERFORM": 2,
  "TIDAK TERSEDIA": 8
};

function scoreBucketPoints(score) {
  if (score == null || Number.isNaN(score)) return 0;
  if (score >= 51 && score <= 80) return 15; // rentang paling baik di data
  if (score >= 41 && score <= 50) return 8;
  if (score >= 81) return 8; // skor tinggi tidak berarti gain intraday tinggi
  return 2; // score <=40
}

function volumeAccelPoints(volumeAccelerating) {
  return volumeAccelerating === true ? 15 : 8;
}

// Baru (24 Juli 2026) - volume_ratio numerik (volume hari ini / rata-rata
// 20 hari), r=0.100 dengan max_gain_from_open_pct. Beda dengan
// volume_signal (kategori EXPLOSIVE/HIGH/dst) yang sudah ada di atas;
// ini pakai angka mentahnya supaya lebih granular.
function volumeRatioPoints(volumeRatio) {
  if (volumeRatio == null || Number.isNaN(volumeRatio)) return 4;
  if (volumeRatio >= 2) return 10;
  if (volumeRatio >= 1.5) return 8;
  if (volumeRatio >= 1) return 6;
  if (volumeRatio >= 0.5) return 4;
  return 2;
}

// Total maksimal 100 (15+15+15+15+15+15+10). Dipecah jadi 7 komponen
// supaya tetap bisa ditelusuri komponen mana yang paling nyumbang,
// bukan cuma angka akhir tanpa penjelasan.
export function calculateSessionGainScore({
  signal,
  score,
  volumeAccelerating,
  volumeSignal,
  volumeRatio,
  gapOutlook,
  rsLabel
} = {}) {
  const signalPts = SIGNAL_POINTS[signal] ?? 6;
  const scorePts = scoreBucketPoints(score);
  const volAccelPts = volumeAccelPoints(volumeAccelerating);
  const volSignalPts = VOLUME_SIGNAL_POINTS[volumeSignal] ?? 6;
  const volRatioPts = volumeRatioPoints(volumeRatio);
  const gapPts = GAP_OUTLOOK_POINTS[gapOutlook] ?? 8;
  const rsPts = RS_LABEL_POINTS[rsLabel] ?? 8;

  const total = signalPts + scorePts + volAccelPts + volSignalPts + volRatioPts + gapPts + rsPts;

  return {
    sessionGainScore: total, // 0-100
    label: classifySessionGainScore(total),
    breakdown: {
      signalPts,
      scorePts,
      volAccelPts,
      volSignalPts,
      volRatioPts,
      gapPts,
      rsPts
    }
  };
}

export function classifySessionGainScore(total) {
  if (total >= 80) return "TINGGI";
  if (total >= 60) return "SEDANG";
  if (total >= 40) return "RENDAH";
  return "SANGAT RENDAH";
}
