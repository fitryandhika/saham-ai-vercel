// ============================================================
// Next-Day Opportunity Engine V2 — CALIBRATED
// ============================================================
// Tujuan:
// Menilai peluang H+1 dari CLOSE H, bukan dari OPEN H+1.
//
// Target strategi:
//   Close H -> harga tertinggi H+1 / Close H+1
//
// Perbaikan penting dari V1:
// 1) "Jauh di bawah resistance" TIDAK lagi otomatis dianggap pre-breakout.
//    V1 menerima distance -26.7% sebagai PRE_BREAKOUT; ini terlalu longgar
//    dan menjadi salah satu sumber false positive seperti DMMX.
// 2) Score dasar/score lama tidak boleh membuat Opportunity langsung HIGH.
//    Score lama hanya fitur pendukung, bukan mesin prediksi H+1.
// 3) Volume wajib dikonfirmasi price action (closing strength), struktur
//    pasar, dan jarak resistance yang masuk akal.
// 4) HIGH + ELIGIBLE hanya boleh muncul jika hard checks lolos.
// 5) Exhaustion/distribution menjadi blocker nyata untuk kandidat HIGH.
// 6) Tidak ada saturation: base score >=90 tidak diberi bonus besar.
//
// CATATAN:
// Threshold ini adalah recalibration defensif berbasis failure mode yang
// terlihat (false HIGH/ELIGIBLE), bukan hasil training statistik baru.
// Setelah outcome H+1 dari close terkumpul, threshold harus divalidasi lagi
// terhadap max_gain_from_close_pct dan next_day_close_return_from_close_pct.

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function addBreakdown(arr, factor, points, detail = null) {
  arr.push({ factor, points, ...(detail ? { detail } : {}) });
}

function calculateEntryQuality({
  dailyChangePercent = null,
  breakout = {},
  rsi = null,
  exhaustion = {},
  distribution = {},
  riskReward = null,
  closingStrength = null
} = {}) {
  let score = 100;
  const reasons = [];
  const dcp = Number(dailyChangePercent);
  const distance = Number(breakout?.distancePercent);
  const rsiValue = Number(rsi);
  const exhaustionScore = Number(exhaustion?.exhaustionScore ?? 0);
  const distributionScore = Number(distribution?.distributionScore ?? 0);
  const rr = Number(riskReward);
  const cs = Number(closingStrength);

  // Opportunity = potensi H+1 dari Close H.
  // Entry Quality = apakah Close H masih layak dibeli sekarang.
  // Keduanya sengaja dipisahkan agar momentum kuat tidak berarti "buy at any price".
  if (Number.isFinite(dcp)) {
    if (dcp >= 10) { score -= 35; reasons.push(`Sudah naik +${dcp}% hari ini`); }
    else if (dcp >= 8) { score -= 25; reasons.push(`Kenaikan harian +${dcp}% sudah tinggi`); }
    else if (dcp >= 6) { score -= 15; reasons.push(`Kenaikan harian +${dcp}% cukup tinggi`); }
    else if (dcp >= 4) { score -= 8; reasons.push(`Kenaikan harian +${dcp}% mulai membatasi entry`); }
    else if (dcp >= 2) { score -= 3; }
  }

  if (Number.isFinite(distance)) {
    if (distance > 8) { score -= 30; reasons.push(`Harga sudah ${distance}% di atas resistance`); }
    else if (distance > 5) { score -= 20; reasons.push(`Harga ${distance}% di atas resistance`); }
    else if (distance > 3) { score -= 12; reasons.push(`Harga ${distance}% di atas resistance`); }
    else if (distance > 1.5) { score -= 6; }
    else if (distance > 0) { score -= 2; }
  }

  if (Number.isFinite(rsiValue)) {
    if (rsiValue >= 80) { score -= 20; reasons.push(`RSI ${rsiValue} sangat overbought`); }
    else if (rsiValue >= 75) { score -= 12; reasons.push(`RSI ${rsiValue} overbought`); }
    else if (rsiValue >= 70) { score -= 6; reasons.push(`RSI ${rsiValue} mulai tinggi`); }
  }

  if (exhaustionScore >= 60) { score -= 20; reasons.push("Rally menunjukkan exhaustion tinggi"); }
  else if (exhaustionScore >= 35) { score -= 10; reasons.push("Rally mulai menunjukkan exhaustion"); }

  if (distributionScore >= 60) { score -= 25; reasons.push("Indikasi distribusi tinggi"); }
  else if (distributionScore >= 35) { score -= 12; reasons.push("Ada indikasi distribusi"); }

  if (Number.isFinite(rr)) {
    if (rr < 1) { score -= 25; reasons.push("Risk/reward < 1"); }
    else if (rr < 1.5) { score -= 12; reasons.push("Risk/reward < 1.5"); }
    else if (rr < 2) { score -= 4; }
  }

  if (Number.isFinite(cs) && cs < 0.55) {
    score -= 10;
    reasons.push("Closing strength belum cukup kuat");
  }

  score = Math.round(clamp(score));

  let label = "AVOID";
  if (score >= 80) label = "GOOD";
  else if (score >= 65) label = "FAIR";
  else if (score >= 50) label = "CAUTION";
  else if (score >= 35) label = "POOR";

  let chaseRisk = "LOW";
  if (dcp >= 10 || distance > 8) chaseRisk = "EXTREME";
  else if (dcp >= 8 || distance > 5 || rsiValue >= 80) chaseRisk = "HIGH";
  else if (dcp >= 6 || distance > 3 || rsiValue >= 75) chaseRisk = "MODERATE";

  let decision = "BUY_NOW";
  if (score < 50 || chaseRisk === "EXTREME") decision = "AVOID";
  else if (score < 65 || chaseRisk === "HIGH") decision = "WAIT_PULLBACK";
  else if (score < 80 || chaseRisk === "MODERATE") decision = "WATCH";

  // Anti-chasing guard khusus strategi beli sore -> jual pagi.
  // Opportunity boleh tetap HIGH, tetapi harga tidak boleh otomatis dianggap layak entry.
  if (dcp >= 8) {
    decision = dcp >= 10 ? "AVOID" : "WAIT_PULLBACK";
    score = Math.min(score, dcp >= 10 ? 49 : 64);
    label = dcp >= 10 ? "POOR" : "CAUTION";
  }

  const entryEligible = score >= 65 && decision === "BUY_NOW";

  return { score, label, chaseRisk, decision, entryEligible, reasons };
}

// ============================================================
// KALIBRASI PROBABILITAS (26 Agustus 2026, atas instruksi user, DIREVISI
// setelah recalibration keempat — bobot market trend dikoreksi & ambang
// naik dari 68 ke 72; lihat catatan lengkap di blok PRICE/MARKET
// STRUCTURE dan blok LABEL di bawah)
// ============================================================
//
// opportunityScore (0-100) itu HASIL PENJUMLAHAN POIN, bukan probabilitas
// — score 65 TIDAK berarti "65% peluang berhasil". Fungsi ini
// menerjemahkan raw score ke estimasi probabilitas SEBENARNYA berdasar
// data historis (scan_history_export_2026-08-26, 9.351 baris close-
// labeled 16 Jul - 24 Agu 2026, sudah termasuk bobot market-trend yang
// dikoreksi), target next_day_max_gain_from_close_pct >= 3%:
//   score <38   -> 18,9% (n=3.438)
//   score 38-58 -> 28,3% (n=3.870)
//   score 59-71 -> 40,9% (n=1.686)
//   score >=72  -> 55,5% (n=357)
//
// dipakai UNTUK TAMPILAN/interpretasi ("kira-kira X% peluang naik >=3%"),
// BUKAN untuk ranking/sorting — ranking tetap pakai opportunityScore
// mentah. Target >=5% ada di estimateOpportunityProbability5Pct di bawah
// untuk saham yang mengincar gain lebih besar.
const PROBABILITY_CALIBRATION_TABLE = [
  { minScore: 0, maxScore: 37, probability: 18.9 },
  { minScore: 38, maxScore: 58, probability: 28.3 },
  { minScore: 59, maxScore: 71, probability: 40.9 },
  { minScore: 72, maxScore: 100, probability: 55.5 }
];

// Probabilitas peluang naik >=5% (bukan cuma >=3%) — sama pembagian
// bucket-nya, dihitung dari kolom next_day_max_gain_from_close_pct >=5%.
const PROBABILITY_CALIBRATION_TABLE_5PCT = [
  { minScore: 0, maxScore: 37, probability: 9.8 },
  { minScore: 38, maxScore: 58, probability: 14.1 },
  { minScore: 59, maxScore: 71, probability: 24.7 },
  { minScore: 72, maxScore: 100, probability: 38.9 }
];

export function estimateOpportunityProbability5Pct(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  const clamped = Math.max(0, Math.min(100, score));
  const bucket = PROBABILITY_CALIBRATION_TABLE_5PCT.find(
    (b) => clamped >= b.minScore && clamped <= b.maxScore
  );
  return bucket ? bucket.probability : null;
}

export function estimateOpportunityProbability(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  const clamped = Math.max(0, Math.min(100, score));
  const bucket = PROBABILITY_CALIBRATION_TABLE.find(
    (b) => clamped >= b.minScore && clamped <= b.maxScore
  );
  return bucket ? bucket.probability : null;
}

export function calculateNextDayOpportunity({
  score = null,
  volume = {},
  volumeAcceleration = {},
  breakout = {},
  relativeStrength = {},
  exhaustion = {},
  distribution = {},
  liquidity = {},
  riskReward = null,
  closingStrength = null,
  marketTrend = null,
  rsi = null,
  macd = {},
  dailyChangePercent = null
} = {}) {
  let opportunityScore = 35;
  const breakdown = [];
  const blockers = [];

  const slopePercent = Number(volumeAcceleration?.slopePercent ?? 0);
  const volumeRatio = Number(volume?.ratio ?? 0);
  const distancePercent = Number(breakout?.distancePercent ?? 0);
  const baseScore = Number(score);
  const cs = Number(closingStrength);
  const rr = Number(riskReward);
  const rsiValue = Number(rsi);
  const macdValue = Number(macd?.macd);

  const rsLabel = String(relativeStrength?.label ?? "TIDAK TERSEDIA");
  const trend = String(marketTrend ?? "TIDAK TERSEDIA").toUpperCase();

  // Dipakai di beberapa blok di bawah (Closing Strength, Resistance
  // Distance, hard-eligibility) — breakout yang SUDAH confirmed (tembus
  // + volume >=1.5x) dievaluasi dengan aturan longgar tersendiri, tidak
  // digabung dengan kasus pre-breakout/extended biasa. Lihat catatan
  // RE-KALIBRASI 21 Agustus 2026 di masing-masing blok.
  const isConfirmedBreakout = Boolean(breakout?.isBreakout);

  // ------------------------------------------------------------
  // 1. PRICE / MARKET STRUCTURE
  //
  // RE-KALIBRASI (26 Agustus 2026, atas instruksi user setelah curiga
  // HIGH kebanyakan): blok ini TIDAK IKUT divalidasi saat rekalibrasi
  // 24 Agustus karena data teknikal (sma20/sma50/ema9/ema20) tidak ada
  // di CSV export saat itu. Sekarang, dengan export yang menyertakan
  // kolom itu, ternyata trend (fungsi getMarketTrend — sebenarnya
  // trend TEKNIKAL PER SAHAM dari SMA/EMA/MACD saham itu sendiri,
  // BUKAN indeks pasar/IHSG) mengklasifikasikan 66-76% dari SEMUA
  // saham sebagai "BULLISH" di hampir semua hari (lagging indicator —
  // SMA20/50 tetap di atas walau harga baru mulai turun). Bobot lama
  // (+8/+2/-10) memberi +8 gratis ke mayoritas populasi TANPA
  // divalidasi, dan terbukti INI PENYEBAB UTAMA HIGH JADI KEBANYAKAN:
  // di 24 & 26 Agustus, 55-73% dari saham berlabel HIGH HANYA lolos
  // ambang 68 karena numpang bonus +8 ini — skor "asli" mereka (tanpa
  // bonus trend) di bawah 68.
  //
  // Backtest ulang (9.351 baris, 26 hari) membandingkan win rate
  // aktual per kategori trend vs baseline (28,1%): BULLISH cuma
  // 30,5% (lift +2,4pp), SIDEWAYS 27,2% (lift -0,9pp), BEARISH 22,4%
  // (lift -5,7pp) — jauh lebih kecil dari swing 18 poin (+8 ke -10)
  // yang dipakai sebelumnya. Bobot diturunkan proporsional ke lift
  // yang sebenarnya: +3/0/-7. Threshold HIGH juga dinaikkan dari 68
  // ke 72 untuk mengkompensasi rata-rata skor yang sekarang naik
  // sedikit karena term ini ikut dihitung (lihat blok LABEL di bawah).
  // Hasil setelah dikalibrasi ulang: HIGH kembali ke ~3,8% populasi
  // (semula melar ke 13,5%), win3=55,5%, win5=38,9% — sesuai target
  // awal (55,2%/38,6%).
  // ------------------------------------------------------------
  if (trend === "BULLISH") {
    opportunityScore += 3;
    addBreakdown(breakdown, "BULLISH_MARKET_STRUCTURE", 3);
  } else if (trend === "SIDEWAYS") {
    addBreakdown(breakdown, "SIDEWAYS_STRUCTURE", 0);
  } else if (trend === "BEARISH") {
    opportunityScore -= 7;
    addBreakdown(breakdown, "BEARISH_MARKET_STRUCTURE", -7);
    blockers.push("Market trend bearish");
  }

  // ------------------------------------------------------------
  // 2. CLOSING STRENGTH
  // Sangat penting untuk strategi beli sore:
  // volume besar tetapi close lemah = supply masih dominan.
  //
  // RE-KALIBRASI (21 Agustus 2026, atas instruksi user): untuk CONFIRMED
  // BREAKOUT (tembus resistance + volume >=1.5x), closing strength lemah
  // TIDAK LAGI dianggap diskualifikasi breakout continuation — dikasih
  // skala sendiri yang lebih longgar, TANPA blocker, walau CS-nya sangat
  // lemah. Rasional: breakout yang sudah terkonfirmasi oleh volume itu
  // sendiri sinyal kuat; closing strength cuma pembeda KUALITAS, bukan
  // syarat lolos/tidak. Skala umum (non-breakout) di bawah TIDAK diubah.
  // ------------------------------------------------------------
  if (Number.isFinite(cs)) {
    if (isConfirmedBreakout) {
      // RE-KALIBRASI KEDUA (21 Agustus 2026): re-test skala -3..+6 di atas
      // terhadap scan_history_export_2026-08-21 (n=331 confirmed breakout,
      // dipecah per bucket CS) menunjukkan arahnya JUSTRU TERBALIK — CS
      // lemah (<0,45) malah win rate TERTINGGI (51,4%, n=35), bukan
      // terendah. TAPI sample kecil & tidak monoton (naik-turun antar
      // bucket), jadi TIDAK dibalik arahnya (berisiko overfit sampel
      // kecil, sama seperti kasus reversal_candidate) — cuma dipersempit
      // jadi -1..+3 supaya CS tidak terlalu menentukan pada confirmed
      // breakout sampai data lebih banyak terkumpul untuk memastikan arah
      // yang benar. Tetap TANPA blocker.
      if (cs >= 0.75) {
        opportunityScore += 3;
        addBreakdown(breakdown, "CONFIRMED_BREAKOUT_VERY_STRONG_CLOSING", 3);
      } else if (cs >= 0.65) {
        opportunityScore += 2;
        addBreakdown(breakdown, "CONFIRMED_BREAKOUT_STRONG_CLOSING", 2);
      } else if (cs >= 0.55) {
        opportunityScore += 1;
        addBreakdown(breakdown, "CONFIRMED_BREAKOUT_ACCEPTABLE_CLOSING", 1);
      } else if (cs >= 0.45) {
        addBreakdown(breakdown, "CONFIRMED_BREAKOUT_NEUTRAL_CLOSING", 0);
      } else {
        opportunityScore -= 1;
        addBreakdown(breakdown, "CONFIRMED_BREAKOUT_WEAK_CLOSING", -1);
        // SENGAJA tidak ada blockers.push() di sini — CS lemah pada
        // confirmed breakout cuma mengurangi poin, tidak mendiskualifikasi.
      }
    } else if (cs >= 0.75) {
      // RE-KALIBRASI (24 Agustus 2026, atas instruksi user, backtest ke
      // scan_history_export_2026-08-24, 8.952 baris close-labeled 16 Jul -
      // 21 Agu): bobot lama (-10 s/d +12, swing 22 poin, PLUS blocker di
      // bawah 0,45) TERBUKTI SALAH ARAH pada sample besar, bukan cuma
      // kasus confirmed-breakout kecil (n=35) yang sudah ditemukan
      // sebelumnya. Bucket CS<0,35 (n=3.521) justru win rate TERTINGGI
      // (32,7% utk >=3%, 17,3% utk >=5%), sementara bucket "tinggi" 0,45-
      // 0,55 (n=1.580) JUSTRU TERENDAH (21,9% / 11,5%) — pola TIDAK
      // monoton dan arahnya kebalikan dari asumsi lama. Karena sinyalnya
      // lemah & tidak konsisten arah (mirip kasus volume_accel_slope
      // sebelumnya), bobot dilucuti jadi sangat kecil (-2..+2) dan SEMUA
      // blocker berbasis CS di jalur non-breakout ini DIHAPUS.
      opportunityScore += 0;
      addBreakdown(breakdown, "VERY_STRONG_CLOSING", 0);
    } else if (cs >= 0.65) {
      opportunityScore += 0;
      addBreakdown(breakdown, "STRONG_CLOSING", 0);
    } else if (cs >= 0.55) {
      opportunityScore += 1;
      addBreakdown(breakdown, "ACCEPTABLE_CLOSING", 1);
    } else if (cs >= 0.45) {
      opportunityScore -= 2;
      addBreakdown(breakdown, "NEUTRAL_CLOSING", -2);
    } else if (cs >= 0.35) {
      opportunityScore += 1;
      addBreakdown(breakdown, "WEAK_CLOSING", 1);
    } else {
      opportunityScore += 2;
      addBreakdown(breakdown, "VERY_WEAK_CLOSING", 2);
    }
  } else {
    // Data tidak tersedia -> netral (bukan penalti), karena arah CS
    // sendiri sudah terbukti lemah/tidak jelas sebagai prediktor.
    addBreakdown(breakdown, "CLOSING_STRENGTH_UNAVAILABLE", 0);
  }

  // ------------------------------------------------------------
  // 3. VOLUME ACCELERATION
  //
  // RE-KALIBRASI (22 Agustus 2026, atas instruksi user): faktor ini
  // ternyata korelasinya PALING LEMAH dari semua faktor lain (r=0,063
  // vs volume_ratio r=0,113, breakout_distance r=0,118, closing_strength
  // r=0,079 — diuji ke 8.942 baris close-labeled scan_history_export_
  // 2026-08-21), tapi dapat bobot TERBESAR (-8 s/d +12, swing 20 poin).
  // Polanya juga TIDAK monoton: tier "0-10%" (18,9% win rate) justru
  // lebih jelek dari tier "menurun/<0%" (28,2%) — kemungkinan noise di
  // sekitar slope≈0 (saham yang "baru mulai stall", bukan benar-benar
  // pola bermakna). Bobot diturunkan jadi -3 s/d +5 (~40% dari sebelum-
  // nya, proporsional ke kekuatan korelasinya), dan tier disederhanakan
  // dari 5 jadi 3 supaya tidak berpura-pura presisi padahal sinyalnya
  // lemah & agak berisik.
  // ------------------------------------------------------------
  if (slopePercent >= 34) {
    opportunityScore += 5;
    addBreakdown(breakdown, "HIGH_VOLUME_ACCELERATION", 5);
  } else if (slopePercent >= 10) {
    opportunityScore += 2;
    addBreakdown(breakdown, "POSITIVE_VOLUME_ACCELERATION", 2);
  } else if (slopePercent < 0) {
    // TIDAK lagi hard blocker (22 Agustus 2026) — data menunjukkan
    // tier "menurun" (<0%, 28,2% win rate) justru LEBIH BAIK dari tier
    // "0-10%" (18,9%, yang malah tidak dapat penalti/blocker sama
    // sekali). Sinyal ini terlalu berisik untuk jadi dasar diskualifikasi
    // — dikembalikan jadi penalti poin ringan saja.
    opportunityScore -= 3;
    addBreakdown(breakdown, "DECLINING_VOLUME_ACCELERATION", -3);
  }

  // ------------------------------------------------------------
  // 4. VOLUME RATIO
  // ------------------------------------------------------------
  if (volumeRatio >= 2.5) {
    opportunityScore += 10;
    addBreakdown(breakdown, "VOLUME_RATIO_GE_2_5", 10);
  } else if (volumeRatio >= 2) {
    opportunityScore += 8;
    addBreakdown(breakdown, "VOLUME_RATIO_GE_2", 8);
  } else if (volumeRatio >= 1.5) {
    opportunityScore += 6;
    addBreakdown(breakdown, "VOLUME_RATIO_GE_1_5", 6);
  } else if (volumeRatio >= 1.2) {
    opportunityScore += 2;
    addBreakdown(breakdown, "VOLUME_RATIO_GE_1_2", 2);
  } else {
    // RE-KALIBRASI (24 Agustus 2026, atas instruksi user): blocker
    // dihapus. Bucket volume_ratio<1,2 mencakup 69,7% dari seluruh data
    // (n=6.239) dengan win rate 26,3%/13,9% — tidak jauh dari baseline
    // keseluruhan (28,4%/15,5%). Blocker di sini adalah salah satu
    // sumber utama kenapa mayoritas saham otomatis gagal eligible;
    // cukup penalti poin ringan, tanpa blocker.
    opportunityScore -= 2;
    addBreakdown(breakdown, "LOW_VOLUME_RATIO", -2);
  }

  // ------------------------------------------------------------
  // 5. RESISTANCE DISTANCE
  //
  // RE-KALIBRASI (21 Agustus 2026, atas instruksi user, berdasar re-test
  // ke scan_history_export_2026-08-21, 8.950 baris):
  //   -20% s/d -12%  -> +6   (sebelumnya +2)
  //   -12% s/d -3%   -> +1   (sebelumnya +10 — sweet spot lama terlalu
  //                           tinggi dibanding data)
  //   -3% s/d 0%     -> -3   (sebelumnya +5 — ini titik TERLEMAH di
  //                           data, 16,8% win rate, dulu malah dikasih
  //                           bonus positif)
  //   0% s/d +8%     -> +8   (sebelumnya +3, breakout naik jadi +8 flat)
  //   > +8%          -> -6 + blocker, tetap (extended TANPA konfirmasi
  //                           volume breakout = masih dicurigai)
  //   < -20%         -> -15 + blocker, TIDAK DIUBAH (di luar cakupan
  //                           instruksi user — guard DMMX -26.7% masih
  //                           berlaku, lihat catatan lama di bawah)
  //
  // CONFIRMED BREAKOUT (isConfirmedBreakout) TIDAK memakai tier jarak di
  // atas sama sekali — begitu breakout sudah terkonfirmasi (tembus +
  // volume >=1.5x), kualitasnya dinilai lewat closing strength (blok
  // CONFIRMED_BREAKOUT_* di atas), bukan seberapa jauh dari resistance.
  //
  // > -20% (tanpa breakout confirmed) = terlalu jauh dari resistance
  // untuk disebut pre-breakout. Ini sengaja dibuat hard blocker agar
  // kasus seperti DMMX (-26.7%) tidak lagi diberi label pre-breakout
  // accumulation.
  // ------------------------------------------------------------
  let preBreakout = false;

  if (isConfirmedBreakout) {
    addBreakdown(
      breakdown,
      "CONFIRMED_BREAKOUT_ZONE",
      0,
      `${distancePercent}% di atas resistance — dinilai lewat closing strength, bukan tier jarak`
    );
  } else if (distancePercent >= -20 && distancePercent < -12) {
    opportunityScore += 7;
    addBreakdown(breakdown, "FAR_FROM_RESISTANCE", 7);
  } else if (distancePercent >= -12 && distancePercent <= -3) {
    // RE-KALIBRASI (24 Agustus 2026, atas instruksi user, backtest
    // scan_history_export_2026-08-24 n=8.952): bucket -12%..-3% ini
    // JUSTRU salah satu yang terlemah (26,6% / 13,4%, n=4.349, sample
    // terbesar) — LEBIH RENDAH dari bucket -20%..-12% (38,0%/22,0%) yang
    // sebelumnya cuma dikasih +6. "Dekat ke pre-breakout" TIDAK terbukti
    // lebih baik dari "jauh dari resistance". Bobot diturunkan dari +1
    // ke +2 (tetap kecil, TIDAK dinaikkan) dan preBreakout tetap dicatat
    // untuk keperluan label coreSetup, tapi TIDAK LAGI dianggap otomatis
    // lebih unggul.
    opportunityScore += 2;
    addBreakdown(breakdown, "PRE_BREAKOUT_ZONE", 2);
    preBreakout = true;
  } else if (distancePercent > -3 && distancePercent < 0) {
    // Bucket TERLEMAH di seluruh data (17,2% / 8,8%, n=1.788) — penalti
    // dinaikkan dari -3 ke -6 (24 Agustus 2026).
    opportunityScore -= 6;
    addBreakdown(breakdown, "NEAR_RESISTANCE", -6);
  } else if (distancePercent >= 0 && distancePercent <= 8) {
    opportunityScore += 9;
    addBreakdown(breakdown, "ABOVE_RESISTANCE_ZONE", 9);
  } else if (distancePercent < -20) {
    // RE-KALIBRASI (24 Agustus 2026, atas instruksi user): blocker
    // "terlalu jauh dari resistance" DIHAPUS. Bucket ini (n=774) justru
    // win rate TERTINGGI kedua dari semua bucket jarak (38,5% / 23,6%)
    // — lebih baik dari PRE_BREAKOUT_ZONE. Guard lama berbasis kasus
    // tunggal (DMMX) ternyata tidak didukung data yang lebih besar.
    // Disamakan dengan bucket -20%..-12% (+7, tanpa blocker).
    opportunityScore += 7;
    addBreakdown(breakdown, "VERY_FAR_FROM_RESISTANCE", 7);
  } else {
    // >8% di atas resistance TANPA breakout confirmed. Data (n=65, kecil)
    // justru menunjukkan win rate TERTINGGI (60% / 52,3%) di bucket ini,
    // tapi sample terlalu kecil untuk dibalik jadi bonus besar (risiko
    // overfit, sama seperti kasus reversal_candidate/CS-breakout
    // sebelumnya). Blocker DIHAPUS, penalti dikecilkan dari -6 ke -2 saja
    // — perlu divalidasi lagi dengan sample lebih besar sebelum diubah
    // lebih jauh.
    opportunityScore -= 2;
    addBreakdown(breakdown, "EXTENDED_ABOVE_RESISTANCE", -2);
  }

  // ------------------------------------------------------------
  // 6. RELATIVE STRENGTH
  // ------------------------------------------------------------
  // RE-KALIBRASI (24 Agustus 2026, atas instruksi user, backtest n=8.952):
  // JAUH OUTPERFORM tetap prediktor terkuat (39,2%/23,4%, n=2.830) —
  // bobot dinaikkan sedikit (8->11). TAPI "OUTPERFORM" (non-JAUH) TERNYATA
  // performanya DI BAWAH baseline (24,2%/10,7%, n=1.069, malah lebih
  // rendah dari UNDERPERFORM 23,0%/11,7%) — bonus +5 lama itu SALAH ARAH.
  // Diubah jadi penalti kecil. JAUH UNDERPERFORM tetap dipertahankan
  // sebagai blocker nyata, konsisten dengan data (22,8%/12,0%, di bawah
  // baseline & sample besar n=2.411).
  if (rsLabel === "JAUH OUTPERFORM") {
    opportunityScore += 11;
    addBreakdown(breakdown, "RS_STRONG_OUTPERFORM", 11);
  } else if (rsLabel === "OUTPERFORM") {
    opportunityScore -= 2;
    addBreakdown(breakdown, "RS_OUTPERFORM_BELOW_BASELINE", -2);
  } else if (rsLabel === "UNDERPERFORM") {
    opportunityScore -= 4;
    addBreakdown(breakdown, "RS_UNDERPERFORM", -4);
  } else if (rsLabel === "JAUH UNDERPERFORM") {
    opportunityScore -= 10;
    addBreakdown(breakdown, "RS_STRONG_UNDERPERFORM", -10);
    blockers.push("Relative strength sangat lemah");
  }

  // ------------------------------------------------------------
  // 7. RSI / MACD
  // ------------------------------------------------------------
  // RE-KALIBRASI (24 Agustus 2026, atas instruksi user, backtest n=8.952):
  // asumsi lama "RSI tinggi = overbought = buruk" TIDAK terbukti. Bucket
  // 75-80 JUSTRU TERBAIK (33,0%/20,0%, n=530), bucket 68-75 kedua
  // terbaik (32,2%/18,0%, n=1.184) — keduanya dulu malah dapat penalti
  // (-5) atau nol. Bucket >=80 "extreme overbought" TIDAK ekstrem buruk
  // (26,6%/16,9%, n=734, dekat baseline) — blocker dihapus. Bucket
  // TERBURUK justru RSI<35 (22,7%/11,5%, n=651), yang dulu tidak dapat
  // penalti sama sekali. Tier dibalik sesuai data.
  if (Number.isFinite(rsiValue)) {
    if (rsiValue >= 75 && rsiValue < 80) {
      opportunityScore += 8;
      addBreakdown(breakdown, "RSI_STRONG_MOMENTUM", 8);
    } else if (rsiValue >= 68 && rsiValue < 75) {
      opportunityScore += 5;
      addBreakdown(breakdown, "RSI_WARM_MOMENTUM", 5);
    } else if (rsiValue >= 45 && rsiValue < 68) {
      opportunityScore += 2;
      addBreakdown(breakdown, "RSI_HEALTHY", 2);
    } else if (rsiValue >= 80) {
      addBreakdown(breakdown, "RSI_EXTREME_NEAR_BASELINE", 0);
    } else if (rsiValue >= 35) {
      addBreakdown(breakdown, "RSI_RECOVERY_ZONE", 0);
    } else {
      opportunityScore -= 6;
      addBreakdown(breakdown, "RSI_WEAK", -6);
    }
  }

  if (Number.isFinite(macdValue)) {
    if (macdValue > 0) {
      opportunityScore += 4;
      addBreakdown(breakdown, "MACD_POSITIVE", 4);
    } else {
      opportunityScore -= 2;
      addBreakdown(breakdown, "MACD_NEGATIVE", -2);
    }
  }

  // ------------------------------------------------------------
  // 8. OLD SCORE — SUPPORTING ONLY
  // ------------------------------------------------------------
  if (Number.isFinite(baseScore)) {
    if (baseScore >= 60 && baseScore < 80) {
      opportunityScore += 3;
      addBreakdown(breakdown, "CORE_SCORE_SUPPORT", 3);
    } else if (baseScore >= 80 && baseScore < 90) {
      opportunityScore += 2;
      addBreakdown(breakdown, "HIGH_CORE_SCORE_SUPPORT", 2);
    } else if (baseScore >= 90) {
      // Tidak ada bonus besar. Score 100 bukan bukti H+1.
      addBreakdown(breakdown, "CORE_SCORE_SATURATED", 0);
    } else if (baseScore < 50) {
      opportunityScore -= 4;
      addBreakdown(breakdown, "WEAK_CORE_SCORE", -4);
    }
  }

  // ------------------------------------------------------------
  // 9. EXHAUSTION / DISTRIBUTION
  // ------------------------------------------------------------
  const exhaustionScore = Number(exhaustion?.exhaustionScore ?? 0);
  const distributionScore = Number(distribution?.distributionScore ?? 0);

  if (exhaustionScore >= 60) {
    opportunityScore -= 15;
    addBreakdown(breakdown, "HIGH_EXHAUSTION", -15);
    blockers.push("Exhaustion tinggi");
  } else if (exhaustionScore >= 35) {
    opportunityScore -= 6;
    addBreakdown(breakdown, "MODERATE_EXHAUSTION", -6);
  }

  if (distributionScore >= 60) {
    opportunityScore -= 15;
    addBreakdown(breakdown, "HIGH_DISTRIBUTION", -15);
    blockers.push("Distribution tinggi");
  } else if (distributionScore >= 35) {
    opportunityScore -= 8;
    addBreakdown(breakdown, "MODERATE_DISTRIBUTION", -8);
  }

  // ------------------------------------------------------------
  // 10. RISK / REWARD
  // ------------------------------------------------------------
  if (Number.isFinite(rr)) {
    if (rr >= 2) {
      opportunityScore += 4;
      addBreakdown(breakdown, "RR_GE_2", 4);
    } else if (rr >= 1.5) {
      opportunityScore += 2;
      addBreakdown(breakdown, "RR_GE_1_5", 2);
    } else if (rr < 1) {
      // RE-KALIBRASI (24 Agustus 2026, atas instruksi user, backtest
      // n=8.952): RR<1 (26,0%/14,4%, n=1.782) cuma beda tipis dari tier
      // 1-1,5 (27,1%/14,5%, n=1.386) — sinyal lemah, penalti dikecilkan
      // lagi dari -6 ke -3 supaya proporsional ke kekuatan sinyalnya.
      opportunityScore -= 3;
      addBreakdown(breakdown, "RR_LT_1", -3);
    }
  }

  // ------------------------------------------------------------
  // 11. SUDAH NAIK BERAPA % HARI INI (info risiko, BUKAN penalti skor)
  //
  // DITAMBAHKAN 14 Agustus 2026 — respons ke laporan user: VERN (+7.48%
  // hari itu) dan AHAP tetap muncul PRIORITAS/HIGH di sini padahal
  // "TIMING TEKNIKAL" (getEntryTiming, verdict.js) untuk saham yang SAMA
  // sudah bilang AVOID pada waktu yang sama.
  //
  // Awalnya ditambahkan sebagai PENALTI skor (asumsi "sudah naik tinggi
  // hari ini = risiko mengejar harga"). SEBELUM dikirim, diuji dulu ke
  // scan_history_export_2026-08-14.csv (6.548 baris dengan daily_change
  // hari-sebelumnya terhitung) — asumsinya TERBUKTI SALAH ARAH sebagian:
  // saham yang sudah naik >=10% hari itu justru median kenaikan besoknya
  // LEBIH TINGGI (1.84% vs 0.85% baseline 0-3%), bukan lebih rendah -
  // kemungkinan pola ARA berantai (limit-up beruntun) yang umum di saham
  // spekulatif IDX. TAPI peluang close MERAH besok juga naik hampir 2x
  // lipat (21.9% vs 13.5%) - jadi bukan "lebih buruk", tapi LEBIH
  // VOLATIL ke dua arah (skewed: sedikit yang lanjut sangat besar,
  // tapi juga lebih sering kena reversal tajam).
  //
  // Karena expected value TIDAK terbukti negatif, TIDAK dijadikan
  // penalti/blocker skor (itu akan menghukum pola yang justru valid) -
  // cuma dicatat sebagai info transparansi risiko di breakdown/inputs,
  // supaya user tahu volatilitasnya lebih tinggi tanpa skornya
  // "dihukum" berdasarkan asumsi yang belum tervalidasi.
  // dailyChangePercent tetap dicatat ke scan_history (lihat api/scan.js)
  // untuk terus dievaluasi seiring data bertambah.
  // ------------------------------------------------------------
  const dcp = Number(dailyChangePercent);

  if (Number.isFinite(dcp) && Math.abs(dcp) >= 6) {
    addBreakdown(breakdown, "ALREADY_MOVED_TODAY_INFO", 0, `${dcp > 0 ? "+" : ""}${dcp}% hari ini — volatilitas historis lebih tinggi ke dua arah, bukan sinyal buruk/baik dengan sendirinya`);
  }

  // ------------------------------------------------------------
  // HARD ELIGIBILITY
  //
  // RE-KALIBRASI BESAR (24 Agustus 2026, atas instruksi user, backtest
  // scan_history_export_2026-08-24, 8.952 baris close-labeled 16 Jul -
  // 21 Agu 2026): root cause kenapa HIGH nyaris tidak pernah muncul
  // (21 Agu = 1 saham, 24 Agu = 0 saham) DITEMUKAN DI SINI, bukan cuma
  // di bobot poin. Sebelumnya HIGH+eligible WAJIB cocok dengan salah
  // satu dari 3 "setup" (validPreBreakout / validBreakout /
  // validContinuation), dan KETIGANYA mewajibkan volumeRatio>=1.5.
  // Karena 69,7% saham di seluruh dataset volumeRatio-nya <1,5, mayoritas
  // saham TIDAK PERNAH BISA eligible sama sekali — walaupun raw score-nya
  // sudah >=80 (banyak contoh coreSetup=NONE dengan score 70-92 di data
  // 21 & 24 Agustus, otomatis diturunkan ke MODERATE oleh aturan
  // "HIGH tidak boleh berdiri sendiri" di bawah). Gate 3-setup ini
  // DIHAPUS. Eligibility sekarang murni skor + blocker nyata (illiquid,
  // relative strength sangat lemah, market trend bearish, exhaustion/
  // distribution tinggi) — coreSetup tetap dihitung untuk ditampilkan,
  // tapi TIDAK LAGI jadi syarat lolos/tidak.
  // ------------------------------------------------------------
  if (liquidity?.illiquid) {
    blockers.push("Saham tidak likuid");
    addBreakdown(breakdown, "ILLIQUID_GUARD", -100);
  }

  // Catatan: blocker berbasis CS/slope/volume-ratio minimum yang dulu
  // ada di sini semuanya DIHAPUS (24 Agustus 2026) — masing-masing sudah
  // terbukti bukan pemisah win/lose yang kuat pada sample besar (lihat
  // catatan di blok skornya masing-masing di atas). Poin sudah cukup
  // untuk membedakan kualitas, tidak perlu didobel dengan blocker.

  const validPreBreakout = preBreakout && volumeRatio >= 1.2;
  const validBreakout = isConfirmedBreakout && volumeRatio >= 1.5;
  const validContinuation =
    distancePercent >= -3 && distancePercent <= 8 && volumeRatio >= 1.2;

  // Deduplicate blockers.
  const uniqueBlockers = [...new Set(blockers)];

  opportunityScore = Math.round(clamp(opportunityScore));

  // ------------------------------------------------------------
  // LABEL
  //
  // RE-KALIBRASI KEEMPAT (26 Agustus 2026, atas instruksi user: HIGH
  // kebanyakan). Threshold naik dari 68 ke 72 KARENA bobot market
  // trend (blok PRICE/MARKET STRUCTURE di atas) sekarang ikut
  // disertakan dalam skor — sebelumnya threshold 68 dikalibrasi dari
  // formula yang skip term itu sama sekali (data teknikal belum ada
  // saat itu). Divalidasi ulang di 9.351 baris (26 hari, 16 Jul-24
  // Agu), termasuk bobot trend yang sudah dikoreksi (lihat catatan di
  // blok PRICE/MARKET STRUCTURE):
  //   score <38   -> LOW      (18,9% >=3%,  9,8% >=5%,  n=3.438)
  //   score 38-58 -> WATCH    (28,3% >=3%, 14,1% >=5%,  n=3.870)
  //   score 59-71 -> MODERATE (40,9% >=3%, 24,7% >=5%,  n=1.686)
  //   score >=72  -> HIGH     (55,5% >=3%, 38,9% >=5%,  n=357, 3,8%
  //                            dari populasi — balik ke target awal;
  //                            semula melar ke 13,5% populasi & win3
  //                            turun ke 46,6% gara-gara bug bobot
  //                            trend +8/+2/-10 yang tidak divalidasi)
  // ------------------------------------------------------------
  let label = "LOW";
  let expectedMoveBand = "LOW";

  if (opportunityScore >= 72) {
    label = "HIGH";
    expectedMoveBand = "HIGH";
  } else if (opportunityScore >= 59) {
    label = "MODERATE";
    expectedMoveBand = "MODERATE";
  } else if (opportunityScore >= 38) {
    label = "WATCH";
    expectedMoveBand = "WATCH";
  }

  // HIGH tidak boleh berdiri sendiri.
  // Kalau hard blocker nyata ada (illiquid / RS sangat lemah / bearish /
  // exhaustion-distribution tinggi), kandidat HIGH diturunkan.
  if (uniqueBlockers.length > 0 && label === "HIGH") {
    label = "MODERATE";
    expectedMoveBand = "MODERATE";
  }

  // "eligible" sekarang murni skor + blocker nyata — TIDAK LAGI
  // mensyaratkan salah satu dari 3 coreSetup (lihat catatan HARD
  // ELIGIBILITY di atas kenapa syarat itu dihapus).
  const eligible = uniqueBlockers.length === 0 && opportunityScore >= 72;

  // Eligible yang gagal karena score tetap tidak boleh disebut HIGH.
  if (label === "HIGH" && !eligible) {
    label = "MODERATE";
    expectedMoveBand = "MODERATE";
  }

  // ------------------------------------------------------------
  // CLOSE-HOLD PATTERN (26 Agustus 2026, atas instruksi user)
  //
  // Temuan dari backtest 405 baris HIGH-tier (data 16 Jul - 21 Agu):
  // di dalam bucket HIGH sendiri, saham yang scan-day-nya SUDAH berada
  // di/atas resistance (distancePercent >= 0) DAN closing_strength-nya
  // sudah kuat (>=0.55) — cenderung "gap-up lalu ambruk": peak biasanya
  // sudah tercapai pagi jam 09:00-09:45 lalu ambles ke close negatif.
  // Saham dengan distancePercent < 0 (masih ada jarak ke resistance) DAN
  // closing_strength < 0.55 (tutup belum "penuh") jauh lebih sering naik
  // & BERTAHAN sampai close: close-positive 42%->54%, avg return next-
  // day-close +0,65% -> +1,86% pada sample 405 itu.
  //
  // VALIDASI OUT-OF-SAMPLE (data 24-25 Agustus, 47 saham HIGH): pola ini
  // TIDAK terkonfirmasi pada satu hari itu — filter justru sedikit lebih
  // buruk (18,5% vs 27,7% baseline). Root cause: 24-25 Agustus adalah
  // hari market-wide selloff (88% dari SELURUH 390 saham yang di-scan,
  // bukan cuma yang HIGH, closenya turun keesokan harinya; market_regime
  // sepanjang hari itu tetap konstan "NEUTRAL"/55 — regime classifier
  // gagal menangkap pelemahan itu). Pada hari selloff market-wide, hampir
  // semua saham individual ikut turun terlepas dari kualitas setup-nya,
  // jadi satu hari ini TIDAK CUKUP untuk menyimpulkan pola ini salah.
  //
  // Karena baru divalidasi 1 sample besar (historis) + 1 hari out-of-
  // sample yang campur (didominasi efek market, bukan stock-picking),
  // field ini dipasang sebagai INFORMASI TAMBAHAN saja — TIDAK dipakai
  // untuk menaikkan/menurunkan score atau label. Perlu dipantau beberapa
  // minggu lagi sebelum dijadikan filter keras.
  // ------------------------------------------------------------
  let closeHoldPattern = "NOT_APPLICABLE";
  if (label === "HIGH" || label === "MODERATE") {
    const favorableHold =
      distancePercent < 0 && Number.isFinite(cs) && cs < 0.55;
    closeHoldPattern = favorableHold
      ? "FAVORABLE_HOLD_TO_CLOSE"
      : "CAUTION_GAP_DUMP_RISK";
  }

  let coreSetup = "NONE";
  if (validPreBreakout) {
    coreSetup = "PRE_BREAKOUT_ACCUMULATION";
  } else if (validBreakout) {
    coreSetup = "CONFIRMED_BREAKOUT";
  } else if (validContinuation) {
    coreSetup = "VOLUME_CONTINUATION";
  }

  const entryQuality = calculateEntryQuality({
    dailyChangePercent: dcp,
    breakout,
    rsi: rsiValue,
    exhaustion,
    distribution,
    riskReward: rr,
    closingStrength: cs
  });

  const tradeDecision = !eligible
    ? "NO_SETUP"
    : entryQuality.decision;

  return {
    version: "v2-calibrated",
    opportunityScore,
    opportunityProbability: estimateOpportunityProbability(opportunityScore),
    opportunityProbability5Pct: estimateOpportunityProbability5Pct(opportunityScore),
    opportunityLabel: label,
    expectedMoveBand,
    coreSetup,
    eligible,
    closeHoldPattern,

    // Layer entry terpisah: tidak mengubah Opportunity Score.
    entryQualityScore: entryQuality.score,
    entryQualityLabel: entryQuality.label,
    chaseRisk: entryQuality.chaseRisk,
    entryDecision: entryQuality.decision,
    entryEligible: entryQuality.entryEligible,
    entryQualityReasons: entryQuality.reasons,
    tradeDecision,

    preBreakoutAccumulation: validPreBreakout,

    // Info transparansi risiko — TIDAK mempengaruhi opportunityScore,
    // lihat catatan panjang di bagian "SUDAH NAIK BERAPA % HARI INI" di
    // atas. Ditampilkan terpisah supaya user tetap tahu volatilitasnya
    // lebih tinggi meski skor peluangnya sendiri tidak diturunkan.
    volatilityNote:
      Number.isFinite(Number(dailyChangePercent)) && Math.abs(Number(dailyChangePercent)) >= 6
        ? `Sudah ${Number(dailyChangePercent) > 0 ? "naik" : "turun"} ${Math.abs(Number(dailyChangePercent))}% hari ini — volatilitas historis lebih tinggi ke dua arah (data 6.548 kejadian: median gain besok lebih tinggi TAPI peluang close merah besok juga ~2x lipat)`
        : null,

    inputs: {
      volumeAccelerationPercent: slopePercent,
      volumeRatio,
      breakoutDistancePercent: distancePercent,
      baseScore: Number.isFinite(baseScore) ? baseScore : null,
      relativeStrengthLabel: rsLabel,
      closingStrength: Number.isFinite(cs) ? cs : null,
      marketTrend: trend,
      rsi: Number.isFinite(rsiValue) ? rsiValue : null,
      macd: Number.isFinite(macdValue) ? macdValue : null,
      dailyChangePercent: Number.isFinite(dcp) ? dcp : null
    },

    breakdown,
    blockers: uniqueBlockers
  };
}

export default calculateNextDayOpportunity;
