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

// UPDATE 14 Agustus 2026 - analisa export scan_history_export_2026-08-14.csv
// (7.221 baris berlabel, ~1 bulan data, 15 Jul-13 Agt 2026). Ditemukan:
// kombinasi volume_signal EXPLOSIVE + rs_label JAUH OUTPERFORM jauh lebih
// prediktif SECARA BERSAMA daripada dijumlah dari kontribusi masing-masing
// komponen di atas (yang murni aditif/independen):
//   - EXPLOSIVE saja: n=860, avg 3.38%, peluang naik >=5% 19.4%
//   - JAUH OUTPERFORM saja: n=2189, avg 3.02%, peluang naik >=5% 17.4%
//   - DUA-DUANYA bareng: n=367, avg 4.45%, peluang naik >=5% 29.2%
//     (bukan cuma penjumlahan, ada efek sinergi ~1.5-1.7x dari yang
//     diharapkan kalau independen)
// Konsisten di semua 22 hari bursa pada data (bukan cuma 1-2 hari
// beruntung) dan tersebar di 186 kode saham berbeda (bukan didominasi
// segelintir saham). Puncak kenaikannya mayoritas (65%) terjadi di
// SESI1_AWAL (lebih awal dari baseline 61%) - jadi sinyal ini soal
// "spike cepat begitu buka", BUKAN jaminan bertahan sampai close
// (next_day_return_pct close-to-close cuma avg 0.66%, median 0%).
//
// Divalidasi balik ke formula existing: kombinasi ini SUDAH dapat 30/100
// poin dari VOLUME_SIGNAL_POINTS+RS_LABEL_POINTS (15+15), tapi itu belum
// cukup mengangkat banyak baris ke bucket TINGGI (skor total >=80) -
// disimulasikan nambah SYNERGY_BONUS +10 khusus utk kombinasi ini,
// bucket TINGGI baru jadi n=390 (dari 255), avg naik dari 3.38%->3.64%,
// peluang >=5% naik dari 19.2%->22.1%. 135 baris yang baru masuk TINGGI
// karena bonus ini rata-rata malah avg 4.12%/peluang 27.4% - jadi bukan
// mengencerkan bucket, tapi menambah baris yang justru KUAT.
//
// CATATAN JUJUR: masih ~1 bulan data. Terus dievaluasi seiring
// scan_history bertambah lewat kolom volume_rs_synergy di db.
const SYNERGY_BONUS_VOLUME_RS = 10;

function volumeRsSynergyPoints(volumeSignal, rsLabel) {
  return volumeSignal === "EXPLOSIVE" && rsLabel === "JAUH OUTPERFORM"
    ? SYNERGY_BONUS_VOLUME_RS
    : 0;
}

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
  const synergyPts = volumeRsSynergyPoints(volumeSignal, rsLabel);

  const total = Math.min(
    100,
    signalPts + scorePts + volAccelPts + volSignalPts + volRatioPts + gapPts + rsPts + synergyPts
  );

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
      rsPts,
      synergyPts
    }
  };
}

export function classifySessionGainScore(total) {
  if (total >= 80) return "TINGGI";
  if (total >= 60) return "SEDANG";
  if (total >= 40) return "RENDAH";
  return "SANGAT RENDAH";
}
