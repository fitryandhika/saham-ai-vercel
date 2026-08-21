// Kill-switch — ikut pola HIGH_CONVICTION_ENABLED/MACRO_FILTER_ENABLED
// di api/scan.js. Dimatikan 21 Agustus 2026 setelah re-test terhadap
// 8.950 baris scan_history_export_2026-08-21 menunjukkan kedua bonus
// ini TIDAK bertahan (bahkan berkebalikan) terhadap gap_up_realized,
// metrik asli yang dipakai untuk kalibrasinya — lihat catatan lengkap
// di calculateScore() di bawah. Flag isReversalCandidate/
// isCapitulationBounceCandidate TETAP dihitung & dicatat ke
// scan_history (lewat analyzer.js/api/scan.js) supaya terus bisa
// dievaluasi; cuma kontribusinya ke `score` yang dimatikan.
const REVERSAL_BONUS_ENABLED = false;
const CAPITULATION_BONUS_ENABLED = false;

export function calculateScore(data) {

  let score = 50;

  // Trend
  if (data.close > data.sma20) score += 10;
  if (data.sma20 > data.sma50) score += 10;

  // EMA
  if (data.ema9 > data.ema20) score += 10;

  // RSI
  // Penalti overbought DIBUAT BERTINGKAT (24 Juli 2026) — sebelumnya flat
  // -10 baik RSI 71 maupun 99, padahal makin ekstrem RSI-nya makin rawan
  // profit-taking besok pagi (lihat warning STRONG BUY di warnings.js,
  // yang menemukan skor tertinggi justru underperform). RSI 90+ dianggap
  // paling overextended -> penalti terbesar.
  //
  // RE-KALIBRASI (21 Agustus 2026): re-test terhadap 8.950 baris
  // scan_history_export_2026-08-21 dengan bin 5-poin RSI, di DUA metrik
  // (next_day_high_3pct_realized & gap_up_realized — target asli scorer
  // ini) menunjukkan skema lama TERLALU KETAT:
  //  - RSI 65-70 justru bucket TERBAIK di next_day_high_3pct (35,0%,
  //    n=940) — tapi kode lama berhenti kasih bonus di RSI<=65, RSI
  //    65-70 dapat 0.
  //  - RSI 70-90 masih 30-33% (next_day_high_3pct) & 7,9-8,6%
  //    (gap_up_realized) — SAMA ATAU LEBIH BAIK dari zona bonus 45-65
  //    (23-31% / 5,4-7,0%) di kedua metrik — tapi kode lama menghukum
  //    zona ini -10/-15. Overbought beneran baru kelihatan di RSI>=95
  //    (next_day_high_3pct anjlok ke 8,9% n=168; gap_up ke 2,2% n=185)
  //    — RSI 90-95 masih wajar (28,4% / 14,8%).
  //  - RSI<30 (dulu dikasih bonus +8 dengan asumsi oversold-bounce)
  //    ternyata UNDERPERFORM zona netral di kedua metrik (18-20% /
  //    4-7%) — bonusnya dihapus, bukan overfit yang terbukti.
  //
  // Bonus zone diperlebar ke 70 (dari 65), penalti cuma tersisa di RSI
  // ekstrem (>=95 berat, 90-95 ringan), dan bonus RSI<30 dihapus.
  if (data.rsi >= 45 && data.rsi <= 70) {
    score += 10;
  } else if (data.rsi >= 95) {
    score -= 15;
  } else if (data.rsi >= 90) {
    score -= 4;
  }

  // MACD
  if (data.macd && data.macd.macd > 0) {
    score += 10;
  }
  
  // Volume
  if (data.volume) {

  if (data.volume.signal === "EXPLOSIVE") {
    score += 10;
  } else if (data.volume.signal === "HIGH") {
    score += 5;
  } else if (data.volume.signal === "LOW") {
    score -= 5;
  }

}

  // Risk Reward
  if (data.riskReward >= 2) {
    score += 10;
  } else if (data.riskReward < 1) {
    score -= 15;
  }

  // Breakout — sinyal kuat, dikasih bobot besar dan TIDAK dihukum
  // kalau tidak breakout (breakout absen = netral, bukan minus).
  if (data.breakout) {
    if (data.breakout.level === "STRONG_BREAKOUT") score += 20;
    else if (data.breakout.level === "BREAKOUT") score += 15;
    else if (data.breakout.level === "WEAK_BREAKOUT") score += 5;
  }

  // Closing Strength — close dekat high = buyer dominan menjelang close.
  if (typeof data.closingStrength === "number") {
    if (data.closingStrength >= 0.8) score += 8;
    else if (data.closingStrength >= 0.6) score += 4;
    else if (data.closingStrength < 0.2) score -= 6;
    else if (data.closingStrength < 0.4) score -= 3;
  }

  // Volume Acceleration (slope 3 hari) — partisipasi volume yang
  // membangun lebih meyakinkan daripada lonjakan satu hari.
  if (data.volumeAcceleration) {
    if (data.volumeAcceleration.accelerating) score += 8;
    else if (data.volumeAcceleration.slopePercent <= -20) score -= 4;
  }

  // Relative Strength vs IHSG / sektor — saham yang outperform pasar
  // & sektornya sendiri lebih meyakinkan daripada yang cuma ikut naik.
  if (data.relativeStrength) {
    const label = data.relativeStrength.label;
    if (label === "JAUH OUTPERFORM") score += 8;
    else if (label === "OUTPERFORM") score += 4;
    else if (label === "UNDERPERFORM") score -= 3;
    else if (label === "JAUH UNDERPERFORM") score -= 6;
  }

  // Reversal / oversold-bounce bonus — ditambahkan 29 Juli 2026, dari
  // analisis 133 kejadian emiten yang skornya di-HOLD/SELL oleh scorer
  // di atas tapi harganya justru naik besoknya (15-29 Juli 2026,
  // gap_up_realized). Pola khasnya: RSI belum jenuh beli, MACD masih
  // negatif, underperform vs pasar (jadi kena penalti RS di atas) —
  // TAPI harga masih bertahan di atas SMA50 (bukan breakdown total)
  // dan closing strength tidak jelek-jelek amat. Ini kebalikan dari
  // filosofi breakout/momentum yang dominan di scorer ini.
  //
  // KILL-SWITCH (21 Agustus 2026): re-test terhadap 8.950 baris
  // scan_history_export_2026-08-21 (metrik ASLI yang dipakai untuk
  // kalibrasi, gap_up_realized) menunjukkan pola ini TIDAK bertahan —
  // isReversalCandidate=true justru gap_up_realized 3,3% (n=150),
  // LEBIH RENDAH dari baseline 6,75% (n=8.800). Kebalikan dari temuan
  // 10-hari/133-kejadian awal yang jadi dasar bonus ini — indikasi
  // overfit ke sampel kecil. Bonus DIMATIKAN (bukan dihapus flag-nya —
  // isReversalCandidate tetap dihitung & dicatat ke scan_history lewat
  // analyzer.js supaya bisa terus dipantau, siap dinyalakan lagi kalau
  // pola positifnya kembali muncul di data yang lebih besar).
  if (REVERSAL_BONUS_ENABLED && isReversalCandidate(data)) {
    score += 6;
  }

  // Capitulation Bounce bonus — ditambahkan 7 Agustus 2026, dari analisis
  // export scan_history 15 Jul-6 Agt 2026 (5.692 baris): 164 saham naik
  // >=5% dari open besoknya, 103 di antaranya (63%) berstatus HOLD/SELL
  // H-1 — bukan BUY/STRONG BUY. Dari 103 itu, 41 (40%) punya pola yang
  // SAMA seperti isReversalCandidate di atas (RSI netral, MACD negatif,
  // underperform pasar, closing strength tidak jelek) TAPI GAGAL kena
  // bonus reversal karena syarat "close > sma50" di isReversalCandidate
  // ternyata salah arah untuk kelompok ini — 35/41 (85%) justru close-nya
  // di BAWAH sma50, bukan di atas. Ini bukan saham yang "masih bertahan
  // di tren", tapi saham yang sudah jatuh lebih dalam dan baru mantul
  // (capitulation bounce), dengan volatilitas (ATR%) yang malah lebih
  // tinggi dari rata-rata (5.46% vs 3.68%) — jadi memang lebih berisiko,
  // bukan sinyal "coiling tenang".
  //
  // KILL-SWITCH (21 Agustus 2026): re-test thd 8.950 baris terbaru
  // (gap_up_realized, metrik asli): 3,8% (n=104) vs baseline 6,7% —
  // juga lebih rendah. Terhadap next_day_close_2pct_realized (target
  // yang lebih longgar, sample close-labeled n=8.942): 20,2% vs
  // baseline 17,8% — di sini sedikit LEBIH BAIK, jadi hasilnya
  // campur/tidak konsisten antar metrik. Karena tidak konsisten dan
  // sampel dasarnya masih ~3 minggu, bonus DIMATIKAN dulu (flag tetap
  // dicatat penuh untuk terus dievaluasi) — sama seperti reversal di
  // atas, jangan diperbesar bobotnya sebelum tervalidasi jelas.
  if (CAPITULATION_BONUS_ENABLED && isCapitulationBounceCandidate(data)) {
    score += 5;
  }

  // Exhaustion & Distribution — ditambahkan 31 Juli 2026, respons
  // langsung ke temuan STRONG BUY win rate (35.1%) lebih rendah dari
  // HOLD/SELL (~37-38%) di data akhir Juli. Lihat catatan lengkap di
  // engine/indicators/exhaustion.js & distribution.js untuk definisi
  // skornya. Penalti di sini SENGAJA dibuat proporsional tapi tidak
  // ekstrem (maks -18 gabungan) karena kedua indikator ini BELUM
  // divalidasi dari data nyata — exhaustionScore/distributionScore
  // tetap dicatat penuh ke scan_history (lihat api/scan.js) supaya
  // bisa dievaluasi dari next_day_return_pct sesungguhnya, baru
  // diperbesar/dikecilkan bobotnya kalau terbukti prediktif.
  if (data.exhaustion) {
    if (data.exhaustion.exhaustionScore >= 60) score -= 12;
    else if (data.exhaustion.exhaustionScore >= 35) score -= 6;
  }

  if (data.distribution) {
    if (data.distribution.distributionScore >= 60) score -= 12;
    else if (data.distribution.distributionScore >= 35) score -= 6;
  }

  return Math.max(0, Math.min(score, 100));
}

// Dipisah jadi fungsi sendiri (bukan cuma inline di calculateScore)
// supaya analyzer.js bisa attach flag-nya ke hasil (d.reversalCandidate)
// untuk dicatat & dievaluasi terpisah dari skor akhir.
export function isReversalCandidate(data) {
  return Boolean(
    data.relativeStrength &&
    (data.relativeStrength.label === "UNDERPERFORM" || data.relativeStrength.label === "JAUH UNDERPERFORM") &&
    typeof data.rsi === "number" && data.rsi < 60 &&
    data.macd && data.macd.macd < 0 &&
    typeof data.close === "number" && typeof data.sma50 === "number" && data.close > data.sma50 &&
    typeof data.closingStrength === "number" && data.closingStrength >= 0.3
  );
}

// Sama filosofinya dengan isReversalCandidate: dipisah jadi fungsi sendiri
// supaya analyzer.js bisa attach flag-nya ke hasil
// (d.capitulationBounceCandidate) untuk dicatat & dievaluasi terpisah dari
// skor akhir. Lihat catatan lengkap di calculateScore() di atas.
export function isCapitulationBounceCandidate(data) {
  return Boolean(
    data.relativeStrength &&
    (data.relativeStrength.label === "UNDERPERFORM" || data.relativeStrength.label === "JAUH UNDERPERFORM") &&
    typeof data.rsi === "number" && data.rsi >= 40 && data.rsi <= 55 &&
    data.macd && data.macd.macd < 0 &&
    typeof data.close === "number" && typeof data.sma50 === "number" && data.close < data.sma50 &&
    typeof data.closingStrength === "number" && data.closingStrength >= 0.3
  );
}

// Konfirmasi Volume + Breakout untuk STRONG BUY — ditambahkan 7 Agustus
// 2026, dari analisis balik export scan_history 15 Jul-7 Agt 2026 (2.150
// baris berlabel max_gain_from_open_pct, dari total 5.692 baris).
//
// Temuan intinya: skor AI (`score`) yang dipakai sekarang TIDAK
// diskriminatif untuk metrik "potensi naik hari itu" (max_gain_from_open_pct)
// — dari skor 55 sampai 95 peluang naik >=3% nyaris flat di 17-20%. Yang
// jauh lebih diskriminatif justru dua hal ini:
//   1. Volume relatif (volume_ratio/volume_signal) — makin tinggi makin
//      besar potensi naik, monoton, robust di sample besar (n=200-1000+).
//   2. RSI — 80+ (overbought ekstrem) adalah bucket TERBURUK (cuma 8.6%
//      peluang naik >=3%, vs baseline 16.2%), bukan bucket terbaik.
// Kombinasi breakout (STRONG_BREAKOUT/BREAKOUT) + volume EXPLOSIVE/HIGH +
// RSI<80 terbukti n=46, 26.1% peluang naik >=3% & 17.4% peluang naik >=5%
// (vs baseline 16.2%/7.7%) — hampir 2x lift untuk kenaikan besar.
//
// Dipakai sebagai GATE untuk signal STRONG BUY (di analyzer.js), BUKAN
// cuma bonus skor tambahan seperti isReversalCandidate/
// isCapitulationBounceCandidate — karena skor >=90 sendirian sudah
// kebanyakan diraih akibat saturasi cap 100 (34-42% emiten per hari dapat
// STRONG BUY per 4-7 Agustus 2026, padahal win rate-nya cuma 9%, hampir
// sama dengan HOLD/BUY biasa). Nambah bonus lagi ke skor cuma akan
// memperparah kerumunan di angka 100, BUKAN bikin lebih selektif — jadi
// dipakai sebagai syarat lolos, bukan poin tambahan.
//
// CATATAN JUJUR: sample dasar rule gabungan ini baru 46 kejadian (3
// minggu data). Flag-nya (strongBuyConfirmed) dicatat ke scan_history
// untuk SEMUA sinyal (bukan cuma STRONG BUY) supaya bisa dievaluasi lebih
// lanjut dari data yang terus bertambah, dan syarat gate ini bisa
// dikencangkan/dilonggarkan kalau perlu.
export function hasStrongBuyConfirmation(data) {
  return Boolean(
    data.breakout &&
    (data.breakout.level === "STRONG_BREAKOUT" || data.breakout.level === "BREAKOUT") &&
    data.volume &&
    (data.volume.signal === "EXPLOSIVE" || data.volume.signal === "HIGH") &&
    typeof data.rsi === "number" && data.rsi < 80
  );
}

export function recommendation(score) {

  if (score >= 90) return "STRONG BUY";
  if (score >= 75) return "BUY";
  if (score >= 55) return "HOLD";
  if (score >= 35) return "SELL";

  return "STRONG SELL";
}