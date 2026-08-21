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
//
// UPDATE 20 Agustus 2026 — perluasan ke target "beli SORE (close hari
// ini), jual besok" (bukan cuma "beli besok pagi di open"). Skor di
// atas basisnya max_gain_from_open_pct (open H+1 -> high H+1) - beda
// dari yang user benar-benar lakukan (beli di CLOSE hari H, jual di
// high H+1). Kolom yang cocok untuk target itu adalah
// next_day_max_gain_from_close_pct / next_day_high_3pct_realized
// (>=3% dari close). Dianalisa 8.556 baris scan_history_export
// 2026-08-20 (15 Jul - 19 Agt 2026, 26 hari bursa, 100+ kode) khusus
// utk target >=3% dari close ini:
//   - Base rate keseluruhan: 28,5%.
//   - breakout_distance_pct SANGAT NEGATIF (harga jauh di bawah
//     resistance-N-hari, oversold dalam) -> win rate NAIK, bukan
//     turun: <=-14% -> 39,2%, vs -5%..-2% (dekat resistance tapi
//     belum tembus) cuma 19,5% - ini pola MEAN-REVERSION, arahnya
//     kebalikan dari breakout biasa. (breakout_distance_pct sudah ada
//     di gapCalibration.js/engine lain tapi belum pernah dipakai di
//     skor ini.)
//   - closing_strength RENDAH (close lemah, dekat low harian) justru
//     lebih baik dari close kuat: kuartil terendah (<=0,185) -> 34,0%
//     vs kuartil tertinggi (>=0,75) -> 25,0%.
//   - market_regime_score LEBIH RENDAH (pasar netral/tenang, 50-55)
//     -> 34,2% vs regime tinggi/risk-on kuat (67-77) -> 23,5%.
//   - volume_ratio>1,5x tetap prediktor terkuat sendirian (39,1%,
//     sudah tercermin di volumeRatioPoints di bawah).
//   - KOMBINASI oversold-dalam (breakout_distance_pct<=-14%) DENGAN
//     volume_ratio>=1,5x jauh lebih kuat dari keduanya sendiri-
//     sendiri: n=199, win rate 59,3% (2,08x base rate) - disebar di
//     116 kode & 26 hari berbeda, bukan kebetulan beberapa saham/hari.
//     Ditambah rs_label JAUH OUTPERFORM atau market_regime_score<=55,
//     naik lagi ke 66-68% (n=53-82) - tapi sampel makin kecil jadi
//     BELUM ditambahkan bonus terpisah, cukup biarkan komponen²nya
//     saling menjumlah secara alami.
//
// Tiga komponen baru (breakoutDistancePts, closingStrengthPts,
// marketRegimePts) + SYNERGY_BONUS_OVERSOLD_VOLUME ditambahkan di
// bawah berdasarkan temuan ini. SEMUA parameter baru OPSIONAL (fallback
// ke nilai netral kalau tidak dikirim) supaya caller lama yang belum
// update tidak error - lihat komentar di calculateSessionGainScore.
// SAMA seperti temuan sebelumnya di file ini: masih ~1 bulan data,
// heuristik kombinasi, terus dievaluasi & dikalibrasi ulang.

// Tiga fungsi + 1 synergy bonus di bawah ini mengimplementasikan temuan
// UPDATE 20 Agustus 2026 di atas. Tier dibuat mengikuti bentuk win-rate
// per quintile/bucket dari analisa tsb (bukan linear), supaya nilai
// poin merefleksikan bentuk kurva aslinya (mis. breakout_distance_pct
// punya titik terlemah di -5%..-2%, BUKAN di ujung positif).
// RE-KALIBRASI (21 Agustus 2026): re-test terhadap 8.950 baris
// scan_history_export_2026-08-21 dengan bin 3% (bukan cuma 5 titik
// kasar seperti sebelumnya) menunjukkan pola sebenarnya BUKAN "makin
// negatif makin bagus lalu datar" — tapi bentuk U: pullback dalam
// bagus, dekat resistance dari bawah paling jelek, TAPI begitu sudah
// TEMBUS resistance (distancePct POSITIF) win rate naik lagi dengan
// kuat & hampir monoton: (0,3]=31,0% n=252, (3,6]=39,4% n=104,
// (6,9]=51,2% n=41, (9,12]=65,0% n=20. Skema lama menyamaratakan
// SEMUA distancePct>-2 (termasuk breakout +12%) jadi 4 poin flat —
// justru menghukum saham yang JELAS-JELAS sudah breakout kuat
// sama seperti yang baru mepet resistance & belum tembus. Ini
// persis kasus scoring kelewat ketat yang bikin emiten berpotensi
// naik tinggi malah dibuang.
function breakoutDistancePoints(distancePct) {
  if (typeof distancePct !== "number" || Number.isNaN(distancePct)) return 6; // fallback netral
  if (distancePct <= -15) return 14; // pullback dalam - 38-49%
  if (distancePct <= -9) return 11; // 29-38%
  if (distancePct <= -6) return 8; // 29,3%
  if (distancePct <= -3) return 4; // 21,2%
  if (distancePct <= 0) return 2; // titik terlemah: mepet resistance, belum tembus (16,8%)
  if (distancePct <= 3) return 7; // baru tembus - 31,0%
  if (distancePct <= 6) return 11; // 39,4%
  return 15; // breakout terkonfirmasi jauh - 51-65% (n kecil di ekor, jangan lebih tinggi dari cap lain)
}

// RE-KALIBRASI (21 Agustus 2026): re-test bin 0.1 terhadap 8.950 baris
// scan_history_export_2026-08-21 — dua ujungnya (sangat lemah vs
// sangat kuat) tetap konsisten dengan skema lama, TAPI zona tengah
// (0.4-1.0) ternyata TIDAK monoton turun seperti diasumsikan — 0.4-0.5
// (23,0%) justru sedikit LEBIH JELEK dari 0.8-1.0 (24,4-25,4%), lalu
// naik lagi di 0.5-0.6 (27,2%) dan 0.7-0.8 (29,0%) — noise, bukan tren.
// Skema lama membedakan "0.4-0.8" (6 poin) vs ">0.8" (4 poin) padahal
// datanya tidak mendukung pembedaan itu. Disederhanakan jadi 1 pita
// netral supaya tidak menghukum saham closing_strength tinggi lebih
// keras dari yang datanya benarkan.
function closingStrengthPoints(closingStrength) {
  if (typeof closingStrength !== "number" || Number.isNaN(closingStrength)) return 8; // fallback netral
  if (closingStrength <= 0.2) return 15; // close lemah - 39-44%
  if (closingStrength <= 0.4) return 11; // 29-34%
  return 5; // 0.4-1.0 flat/noisy (23-29%), tidak monoton — 1 pita netral
}

function marketRegimePoints(marketRegimeScore) {
  if (typeof marketRegimeScore !== "number" || Number.isNaN(marketRegimeScore)) return 8; // fallback netral
  if (marketRegimeScore <= 55) return 15; // pasar netral/tenang - win rate tertinggi (34,2%)
  if (marketRegimeScore <= 67) return 8;
  return 2; // risk-on kuat - win rate terendah (23,5%)
}

// Sama seperti SYNERGY_BONUS_VOLUME_RS di bawah: kombinasi oversold-dalam
// + volume tinggi jauh lebih kuat SECARA BERSAMA (59,3%, n=199, 116 kode,
// 26 hari) daripada dijumlah dari kontribusinya sendiri-sendiri. Kombinasi
// 3-arah (+rs_label/+regime, naik ke 66-68%) SENGAJA belum dijadikan bonus
// terpisah karena sampelnya sudah kecil (n=53-82) - lihat catatan di atas.
const SYNERGY_BONUS_OVERSOLD_VOLUME = 10;

function oversoldVolumeSynergyPoints(distancePct, volumeRatio) {
  return typeof distancePct === "number" && distancePct <= -14 &&
    typeof volumeRatio === "number" && volumeRatio >= 1.5
    ? SYNERGY_BONUS_OVERSOLD_VOLUME
    : 0;
}

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

// Dipecah jadi banyak komponen kecil supaya tetap bisa ditelusuri
// komponen mana yang paling nyumbang, bukan cuma angka akhir tanpa
// penjelasan (lihat breakdown di return value).
//
// UPDATE 20 Agustus 2026 - breakoutDistancePct, closingStrength, dan
// marketRegimeScore ditambahkan sbg parameter OPSIONAL (lihat 3 fungsi
// + synergy bonus baru di atas). Caller lama yang belum mengirim
// parameter ini tetap jalan (fallback ke poin netral), TAPI skor jadi
// lebih akurat untuk target "beli close H, jual high H+1" begitu 3
// parameter ini dikirim.
//
// Total poin mentah sekarang bisa jauh lebih tinggi dari 100 (teoretis
// maks 170, di data riil 8.556 baris 15 Jul-19 Agt 2026 rentangnya
// 36-145) - CAP LAMA di Math.min(100, ...) DIHAPUS karena tadinya
// membuat ~50% baris rata di TINGGI dengan win rate cuma 34,3% (nyaris
// sama dengan base rate 28,5% - hampir tidak ada daya pembeda lagi).
// Threshold classifySessionGainScore() di bawah diganti ke skala baru
// ini, divalidasi lewat simulasi thd 8.556 baris yg sama:
//   TINGGI   (raw>=94, top ~21% data): win rate 41,1%
//   SEDANG   (raw 77-93):              win rate 27,3%
//   RENDAH   (raw 63-76):              win rate 20,6%
//   SANGAT RENDAH (raw<63):            win rate 12,8%
// Monoton naik dan diskriminasinya jauh lebih tajam dari sebelumnya.
// CATATAN JUJUR: threshold ini fit ke data yang tersedia sekarang
// (~1 bulan) - perlu dicek ulang begitu next_day_high_3pct_realized
// terus bertambah, dan idealnya divalidasi out-of-sample (bukan cuma
// in-sample seperti sekarang).
export function calculateSessionGainScore({
  signal,
  score,
  volumeAccelerating,
  volumeSignal,
  volumeRatio,
  gapOutlook,
  rsLabel,
  breakoutDistancePct,
  closingStrength,
  marketRegimeScore
} = {}) {
  const signalPts = SIGNAL_POINTS[signal] ?? 6;
  const scorePts = scoreBucketPoints(score);
  const volAccelPts = volumeAccelPoints(volumeAccelerating);
  const volSignalPts = VOLUME_SIGNAL_POINTS[volumeSignal] ?? 6;
  const volRatioPts = volumeRatioPoints(volumeRatio);
  const gapPts = GAP_OUTLOOK_POINTS[gapOutlook] ?? 8;
  const rsPts = RS_LABEL_POINTS[rsLabel] ?? 8;
  const synergyPts = volumeRsSynergyPoints(volumeSignal, rsLabel);
  const breakoutDistancePts = breakoutDistancePoints(breakoutDistancePct);
  const closingStrengthPts = closingStrengthPoints(closingStrength);
  const marketRegimePts = marketRegimePoints(marketRegimeScore);
  const oversoldVolumeSynergyPts = oversoldVolumeSynergyPoints(breakoutDistancePct, volumeRatio);

  const total =
    signalPts + scorePts + volAccelPts + volSignalPts + volRatioPts + gapPts + rsPts + synergyPts +
    breakoutDistancePts + closingStrengthPts + marketRegimePts + oversoldVolumeSynergyPts;

  return {
    // UPDATE 20 Agustus 2026: BUKAN skala 0-100 lagi (lihat catatan di
    // atas) - poin mentah, dipakai apa adanya oleh classifySessionGainScore()
    // di bawah. Kalau UI menampilkan ini sebagai progress bar/persen,
    // perlu disesuaikan (mis. dibagi 145 atau range aktual terbaru).
    sessionGainScore: total,
    label: classifySessionGainScore(total),
    breakdown: {
      signalPts,
      scorePts,
      volAccelPts,
      volSignalPts,
      volRatioPts,
      gapPts,
      rsPts,
      synergyPts,
      breakoutDistancePts,
      closingStrengthPts,
      marketRegimePts,
      oversoldVolumeSynergyPts
    }
  };
}

// UPDATE 20 Agustus 2026 - threshold diganti dari skala lama (40/60/80,
// asumsi maks 100) ke skala baru (raw, tanpa cap) berdasarkan simulasi
// thd 8.556 baris scan_history_export_2026-08-20 - lihat catatan di
// calculateSessionGainScore(). Win rate per bucket: TINGGI 41,1%,
// SEDANG 27,3%, RENDAH 20,6%, SANGAT RENDAH 12,8% - monoton & jauh
// lebih tajam dari sebelumnya (dulu TINGGI cuma 34,3% dan berisi ~50%
// dari semua baris).
export function classifySessionGainScore(total) {
  if (total >= 94) return "TINGGI";
  if (total >= 77) return "SEDANG";
  if (total >= 63) return "RENDAH";
  return "SANGAT RENDAH";
}
