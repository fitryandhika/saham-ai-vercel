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
// KALIBRASI PROBABILITAS (22 Agustus 2026, atas instruksi user, DIREVISI
// setelah backtest kedua atas scan_history_export_2026-08-20 — lihat
// catatan lengkap di blok LABEL di bawah untuk kenapa breakpoint pindah
// dari 90/80/60 ke 80/60/20)
// ============================================================
//
// opportunityScore (0-100) itu HASIL PENJUMLAHAN POIN, bukan probabilitas
// — score 65 TIDAK berarti "65% peluang berhasil". Fungsi ini
// menerjemahkan raw score ke estimasi probabilitas SEBENARNYA berdasar
// data historis (scan_history_export_2026-08-20, 8.942 baris close-
// labeled, target next_day_high_3pct_realized OR next_day_close_2pct_
// realized):
//   score <20   -> 28,4%
//   score 20-59 -> 30,1%
//   score 60-79 -> 35,6%
//   score >=80  -> 44,1%
//
// dipakai UNTUK TAMPILAN/interpretasi ("kira-kira X% peluang"), BUKAN
// untuk ranking/sorting — ranking tetap pakai opportunityScore mentah.
const PROBABILITY_CALIBRATION_TABLE = [
  { minScore: 0, maxScore: 19, probability: 28.4 },
  { minScore: 20, maxScore: 59, probability: 30.1 },
  { minScore: 60, maxScore: 79, probability: 35.6 },
  { minScore: 80, maxScore: 100, probability: 44.1 }
];

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
  // ------------------------------------------------------------
  if (trend === "BULLISH") {
    opportunityScore += 8;
    addBreakdown(breakdown, "BULLISH_MARKET_STRUCTURE", 8);
  } else if (trend === "SIDEWAYS") {
    opportunityScore += 2;
    addBreakdown(breakdown, "SIDEWAYS_STRUCTURE", 2);
  } else if (trend === "BEARISH") {
    opportunityScore -= 10;
    addBreakdown(breakdown, "BEARISH_MARKET_STRUCTURE", -10);
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
      opportunityScore += 12;
      addBreakdown(breakdown, "VERY_STRONG_CLOSING", 12);
    } else if (cs >= 0.65) {
      opportunityScore += 9;
      addBreakdown(breakdown, "STRONG_CLOSING", 9);
    } else if (cs >= 0.55) {
      opportunityScore += 5;
      addBreakdown(breakdown, "ACCEPTABLE_CLOSING", 5);
    } else if (cs >= 0.45) {
      addBreakdown(breakdown, "NEUTRAL_CLOSING", 0);
    } else if (cs >= 0.35) {
      opportunityScore -= 5;
      addBreakdown(breakdown, "WEAK_CLOSING", -5);
      blockers.push("Closing strength lemah");
    } else {
      opportunityScore -= 10;
      addBreakdown(breakdown, "VERY_WEAK_CLOSING", -10);
      blockers.push("Closing strength sangat lemah");
    }
  } else {
    // Jangan menganggap data yang tidak tersedia sebagai konfirmasi.
    opportunityScore -= 4;
    addBreakdown(breakdown, "CLOSING_STRENGTH_UNAVAILABLE", -4);
    blockers.push("Closing strength tidak tersedia");
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
    opportunityScore -= 3;
    addBreakdown(breakdown, "LOW_VOLUME_RATIO", -3);
    blockers.push("Volume ratio terlalu rendah");
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
    opportunityScore += 6;
    addBreakdown(breakdown, "FAR_FROM_RESISTANCE", 6);
  } else if (distancePercent >= -12 && distancePercent <= -3) {
    opportunityScore += 1;
    addBreakdown(breakdown, "PRE_BREAKOUT_ZONE", 1);
    preBreakout = true;
  } else if (distancePercent > -3 && distancePercent < 0) {
    opportunityScore -= 3;
    addBreakdown(breakdown, "NEAR_RESISTANCE", -3);
  } else if (distancePercent >= 0 && distancePercent <= 8) {
    opportunityScore += 8;
    addBreakdown(breakdown, "ABOVE_RESISTANCE_ZONE", 8);
  } else if (distancePercent < -20) {
    opportunityScore -= 15;
    addBreakdown(breakdown, "TOO_FAR_FROM_RESISTANCE", -15);
    blockers.push("Terlalu jauh dari resistance untuk dianggap pre-breakout");
  } else {
    // >8% di atas resistance TANPA breakout confirmed: sudah extended,
    // masih dicurigai (beda dengan >8% YANG confirmed, lihat cabang
    // isConfirmedBreakout di atas).
    opportunityScore -= 6;
    addBreakdown(breakdown, "EXTENDED_ABOVE_RESISTANCE", -6);
    blockers.push("Harga sudah terlalu jauh di atas resistance");
  }

  // ------------------------------------------------------------
  // 6. RELATIVE STRENGTH
  // ------------------------------------------------------------
  if (rsLabel === "JAUH OUTPERFORM") {
    opportunityScore += 8;
    addBreakdown(breakdown, "RS_STRONG_OUTPERFORM", 8);
  } else if (rsLabel === "OUTPERFORM") {
    opportunityScore += 5;
    addBreakdown(breakdown, "RS_OUTPERFORM", 5);
  } else if (rsLabel === "UNDERPERFORM") {
    opportunityScore -= 6;
    addBreakdown(breakdown, "RS_UNDERPERFORM", -6);
  } else if (rsLabel === "JAUH UNDERPERFORM") {
    opportunityScore -= 10;
    addBreakdown(breakdown, "RS_STRONG_UNDERPERFORM", -10);
    blockers.push("Relative strength sangat lemah");
  }

  // ------------------------------------------------------------
  // 7. RSI / MACD
  // ------------------------------------------------------------
  if (Number.isFinite(rsiValue)) {
    if (rsiValue >= 45 && rsiValue <= 68) {
      opportunityScore += 5;
      addBreakdown(breakdown, "RSI_HEALTHY", 5);
    } else if (rsiValue > 68 && rsiValue < 75) {
      addBreakdown(breakdown, "RSI_WARM", 0);
    } else if (rsiValue >= 75 && rsiValue < 80) {
      opportunityScore -= 5;
      addBreakdown(breakdown, "RSI_OVEREXTENDED", -5);
    } else if (rsiValue >= 80) {
      opportunityScore -= 12;
      addBreakdown(breakdown, "RSI_EXTREME_OVERBOUGHT", -12);
      blockers.push("RSI terlalu overbought");
    } else if (rsiValue >= 35) {
      opportunityScore += 2;
      addBreakdown(breakdown, "RSI_RECOVERY_ZONE", 2);
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
      // RE-KALIBRASI (22 Agustus 2026): re-test terhadap scan_history_
      // export_2026-08-20 — RR<1 (27,1%) cuma beda 3,6 poin dari tier
      // 1-1,5 (28,5%), tidak cukup ekstrem untuk hard blocker. Penalti
      // poin dipertahankan, blocker dihapus.
      opportunityScore -= 6;
      addBreakdown(breakdown, "RR_LT_1", -6);
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
  // ------------------------------------------------------------
  if (liquidity?.illiquid) {
    blockers.push("Saham tidak likuid");
    addBreakdown(breakdown, "ILLIQUID_GUARD", -100);
  }

  // RE-KALIBRASI (21 Agustus 2026, atas instruksi user): confirmed
  // breakout DIKECUALIKAN dari blocker CS & slope di bawah — alasannya
  // sama seperti blok CLOSING STRENGTH di atas: CONFIRMED BREAKOUT +
  // volume kuat + CS/slope lemah tetap dianggap continuation yang valid
  // (dinilai lewat poin, bukan diblokir).
  if ((!Number.isFinite(cs) || cs < 0.55) && !isConfirmedBreakout) {
    if (!blockers.includes("Closing strength lemah") &&
        !blockers.includes("Closing strength sangat lemah") &&
        !blockers.includes("Closing strength tidak tersedia")) {
      blockers.push("Closing strength di bawah minimum");
    }
  }

  if (slopePercent < 10 && !isConfirmedBreakout) {
    blockers.push("Volume acceleration belum cukup");
  }

  if (volumeRatio < 1.2) {
    blockers.push("Volume ratio belum cukup");
  }

  // Ambang slopePercent PRE_BREAKOUT diturunkan 25 -> 20 (atas instruksi
  // user, "acceleration >=20/25" — dipilih 20 supaya konsisten dengan
  // VOLUME_CONTINUATION di bawah; kabari kalau maksudnya tetap 25).
  const validPreBreakout =
    preBreakout &&
    slopePercent >= 20 &&
    volumeRatio >= 1.5 &&
    Number.isFinite(cs) &&
    cs >= 0.55;

  // CONFIRMED_BREAKOUT (atas instruksi user): cukup volume ratio>=1.5 +
  // breakout confirmed. TIDAK ADA syarat slopePercent atau cs — closing
  // strength & volume acceleration dinilai sebagai POIN di blok scoring
  // di atas, bukan syarat lolos/tidak di sini.
  const validBreakout =
    isConfirmedBreakout &&
    volumeRatio >= 1.5;

  const validContinuation =
    distancePercent >= -3 &&
    distancePercent <= 8 &&
    slopePercent >= 20 &&
    volumeRatio >= 1.5 &&
    Number.isFinite(cs) &&
    cs >= 0.60;

  if (!validPreBreakout && !validBreakout && !validContinuation) {
    blockers.push("Tidak ada setup H+1 yang tervalidasi");
  }

  // Deduplicate blockers.
  const uniqueBlockers = [...new Set(blockers)];

  opportunityScore = Math.round(clamp(opportunityScore));

  // ------------------------------------------------------------
  // LABEL
  //
  // RE-KALIBRASI (22 Agustus 2026, atas instruksi user): threshold lama
  // (80/65/50) dipilih tanpa validasi data.
  //
  // REVISI KEDUA (22 Agustus 2026, backtest ulang atas scan_history_
  // export_2026-08-20): percobaan pertama (HIGH>=90/MODERATE>=80/
  // WATCH>=60) TERLALU KETAT — di antara 2.579 baris yang beneran naik
  // (big_move), threshold itu cuma menangkap 82 sebagai HIGH/MODERATE
  // (turun 70% dari versi lama yang menangkap 272!). Direvisi ke:
  //   score < 20   -> LOW      (28,4% win rate, n=444)
  //   score 20-59  -> WATCH    (30,1%, n=1.432)
  //   score 60-79  -> MODERATE (35,6%, n=762)
  //   score >= 80  -> HIGH     (44,1%, n=186 — gabung bucket 80-90 &
  //                             90-100 lama, karena 90-100 sample-nya
  //                             cuma n=40, kelewat kecil buat jadi
  //                             ambang HIGH sendirian)
  // Threshold ini FULLY MONOTON (44,1 > 35,6 > 30,1 > 28,4) DAN
  // menangkap 353/2.579 winners (13,7%) sebagai HIGH/MODERATE — lebih
  // banyak dari versi lama (272) maupun percobaan pertama (82).
  // ------------------------------------------------------------
  let label = "LOW";
  let expectedMoveBand = "LOW";

  if (opportunityScore >= 80) {
    label = "HIGH";
    expectedMoveBand = "HIGH";
  } else if (opportunityScore >= 60) {
    label = "MODERATE";
    expectedMoveBand = "MODERATE";
  } else if (opportunityScore >= 20) {
    label = "WATCH";
    expectedMoveBand = "WATCH";
  }

  // HIGH tidak boleh berdiri sendiri.
  // Kalau hard blocker ada, kandidat HIGH diturunkan.
  if (uniqueBlockers.length > 0 && label === "HIGH") {
    label = "MODERATE";
    expectedMoveBand = "MODERATE";
  }

  // Ambang score>=72 diikutkan naik jadi >=80 (22 Agustus 2026, direvisi
  // dari percobaan pertama >=90 yang kelewat ketat — lihat catatan LABEL
  // di atas) supaya konsisten dengan breakpoint HIGH final.
  const eligible =
    uniqueBlockers.length === 0 &&
    opportunityScore >= 80 &&
    (
      validPreBreakout ||
      validBreakout ||
      validContinuation
    );

  // Eligible yang gagal karena score tetap tidak boleh disebut HIGH.
  if (label === "HIGH" && !eligible) {
    label = "MODERATE";
    expectedMoveBand = "MODERATE";
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
    opportunityLabel: label,
    expectedMoveBand,
    coreSetup,
    eligible,

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
