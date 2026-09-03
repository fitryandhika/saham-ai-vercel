// ==========================
// Evaluation Stats — hitung ringkasan akurasi dari scan_history
// ==========================
//
// Semua fungsi di sini murni (pure) — terima array baris scan_history
// (sudah dilabel), kembalikan objek ringkasan. Tidak menyentuh network
// atau Supabase, supaya gampang dites terpisah dan dipakai ulang baik
// di api/history.js maupun (nanti) di skrip lain kalau perlu.
//
// Definisi "benar" di sini SENGAJA mengikuti definisi label di
// api/label-outcomes.js: gap_up_realized (next_day_return_pct >= ambang).
// Ini BUKAN "profit dari strategi beli-sore-jual-pagi" secara umum,
// tapi proxy paling dekat yang sudah dikumpulkan sistem ini.

function avg(nums) {
  const valid = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function winRate(rows) {
  const labeled = rows.filter((r) => r.gap_up_realized !== null && r.gap_up_realized !== undefined);
  if (labeled.length === 0) return null;
  const wins = labeled.filter((r) => r.gap_up_realized === true).length;
  return wins / labeled.length;
}

// Ditambahkan 21 Agustus 2026 (atas instruksi user) — dipakai KHUSUS untuk
// win_rate di kartu ringkasan atas Riwayat AI (computeSummary().overall).
// gap_up_realized (winRate() di atas) cuma menghitung gap PERSIS di
// pembukaan H+1, terlalu ketat untuk strategi beli-sore-jual-pagi yang
// bisa eksekusi kapan saja sepanjang sesi 1 — analisis 8.950 baris
// scan_history_export_2026-08-21 menunjukkan 72-75% dari puncak harga
// H+1 terjadi di sesi 1 (bukan cuma di pembukaan), jadi gap_up_realized
// bikin win rate kelihatan jauh lebih rendah dari performa sebenarnya.
// next_day_high_3pct_realized = harga SEMPAT naik >=3% kapan saja di H+1.
// TIDAK DIPAKAI LAGI sejak 3 September 2026. Dulu ini basis win rate
// kartu ringkasan atas (target 3%, atas SELURUH baris). Sekarang seluruh
// halaman memakai satu definisi: akurasi prediksi pada target +5%.
// Dibiarkan ada karena murni dan tidak berbahaya; hapus kalau sudah
// yakin tidak ada konsumen response lama yang membutuhkannya.
function winRateHigh3pct(rows) {
  const labeled = rows.filter(
    (r) => r.next_day_high_3pct_realized !== null && r.next_day_high_3pct_realized !== undefined
  );
  if (labeled.length === 0) return null;
  const wins = labeled.filter((r) => r.next_day_high_3pct_realized === true).length;
  return wins / labeled.length;
}

// Target utama strategi: harga H+1 SEMPAT menyentuh >= +5% dari close
// sore. Dipakai sebagai definisi "prediksi benar" di tren harian.
// Angkanya sengaja dipisah jadi konstanta supaya kalau target berubah,
// tidak ada dua tempat yang bisa tidak sinkron.
const HIGH_TARGET_PCT = 5;

function round(n, digits = 2) {
  if (n === null || n === undefined) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

// Skor dibagi ke bucket yang sama dengan ambang signal di engine/scorer.js
// (STRONG SELL <35, SELL 35-54, HOLD 55-74, BUY 75-89, STRONG BUY >=90)
// supaya perbandingan skor vs hasil aktual langsung nyambung dengan
// logika rekomendasi yang sudah ada.
const SCORE_BUCKETS = [
  { label: "0-34 (STRONG SELL)", min: 0, max: 34 },
  { label: "35-54 (SELL)", min: 35, max: 54 },
  { label: "55-74 (HOLD)", min: 55, max: 74 },
  { label: "75-89 (BUY)", min: 75, max: 89 },
  { label: "90-100 (STRONG BUY)", min: 90, max: 100 }
];

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function summarizeGroup(rows) {
  return {
    jumlah: rows.length,
    win_rate: round((winRate(rows) ?? 0) * 100),
    avg_return_pct: round(avg(rows.map((r) => r.next_day_return_pct)))
  };
}

// ==========================
// Tahap 2 (beli sore -> jual pagi/close, basis CLOSE H) — dipakai untuk
// overall_opportunity / by_opportunity_label / eligible_vs_not_eligible.
// Beda basis dari summarizeGroup() di atas: win pakai next_day_success
// (bukan gap_up_realized) dan return pakai next_day_close_return_from_close_pct
// (bukan next_day_return_pct, yang basisnya open H+1).
// ==========================

function winRateClose(rows) {
  const labeled = rows.filter(
    (r) => r.next_day_success !== null && r.next_day_success !== undefined
  );
  if (labeled.length === 0) return null;
  const wins = labeled.filter((r) => r.next_day_success === true).length;
  return wins / labeled.length;
}

function summarizeGroupClose(rows) {
  return {
    jumlah: rows.length,
    win_rate: round((winRateClose(rows) ?? 0) * 100),
    avg_return_pct: round(avg(rows.map((r) => r.next_day_close_return_from_close_pct)))
  };
}

export function computeSummary(rows) {
  const labeled = rows.filter(
    (r) => r.gap_up_realized !== null && r.gap_up_realized !== undefined
  );

  // ============================================================
  // KARTU RINGKASAN ATAS — disamakan dengan tren harian (3 Sep 2026)
  // ============================================================
  // Dulu kartu ini memakai basis ketiga lagi: win = peak >= 3% atas
  // SELURUH baris, dan rata-rata return dari next_day_return_pct yang
  // basisnya OPEN H+1, bukan close H. Jadi satu halaman menampilkan
  // tiga definisi "win" yang tidak bisa dibandingkan satu sama lain.
  //
  // Sekarang satu definisi untuk seluruh halaman: dari saham yang
  // DIPILIH model (tier PRIMARY, atau label HIGH untuk baris lama),
  // berapa persen yang besoknya menyentuh >= +5% dari close.
  const labeledClose = rows.filter(
    (r) => r.next_day_max_gain_from_close_pct !== null &&
           r.next_day_max_gain_from_close_pct !== undefined
  );

  const isPredicted = (r) =>
    r.next_day_conviction_tier
      ? r.next_day_conviction_tier === "PRIMARY"
      : r.next_day_opportunity_label === "HIGH";

  const hit5 = (r) => Number(r.next_day_max_gain_from_close_pct) >= HIGH_TARGET_PCT;

  const predictedAll = labeledClose.filter(isPredicted);

  const overallHit = predictedAll.length
    ? (predictedAll.filter(hit5).length / predictedAll.length) * 100
    : null;
  const overallBase = labeledClose.length
    ? (labeledClose.filter(hit5).length / labeledClose.length) * 100
    : null;

  const overall = {
    total_scan: rows.length,
    total_labeled: labeledClose.length,
    total_prediksi: predictedAll.length,
    hit_rate_5pct: round(overallHit),
    base_rate_5pct: round(overallBase),
    lift_5pct: overallHit === null || overallBase === null ? null : round(overallHit - overallBase),
    avg_peak_pct: round(avg(predictedAll.map((r) => r.next_day_max_gain_from_close_pct))),
    avg_close_return_pct: round(avg(predictedAll.map((r) => r.next_day_close_return_from_close_pct))),

    // Dipertahankan supaya konsumen lama response ini tidak pecah.
    win_rate: round(overallHit),
    avg_return_pct: round(avg(predictedAll.map((r) => r.next_day_close_return_from_close_pct)))
  };

  // Per signal (STRONG BUY / BUY / HOLD / SELL / STRONG SELL)
  const bySignalMap = groupBy(labeled, (r) => r.signal);
  const bySignal = Array.from(bySignalMap.entries())
    .map(([signal, group]) => ({ signal, ...summarizeGroup(group) }))
    .sort((a, b) => b.jumlah - a.jumlah);

  // Per bucket skor — ini yang paling penting untuk lihat apakah skor
  // AI (0-100) memang berkorelasi positif dengan hasil aktual.
  const byScoreBucket = SCORE_BUCKETS.map((bucket) => {
    const group = labeled.filter(
      (r) => typeof r.score === "number" && r.score >= bucket.min && r.score <= bucket.max
    );
    return { bucket: bucket.label, ...summarizeGroup(group) };
  });

  // Per breakout level
  const byBreakoutMap = groupBy(labeled, (r) => r.breakout_level || "NONE");
  const byBreakout = Array.from(byBreakoutMap.entries())
    .map(([level, group]) => ({ breakout_level: level, ...summarizeGroup(group) }))
    .sort((a, b) => b.jumlah - a.jumlah);

  // Tren harian — untuk grafik win rate dari waktu ke waktu
  //
  // Hari non-trading (weekend, libur bursa IDX) menghasilkan jumlah scan
  // yang jauh di bawah normal (biasanya ~300an vs cuma puluhan), sehingga
  // win rate-nya jadi noise/tidak representatif kalau ikut ditampilkan.
  // MIN_DAILY_SCAN_COUNT jadi ambang kasar untuk menyaring hari-hari itu
  // tanpa perlu tabel kalender libur bursa terpisah.
  //
  // Dikelompokkan dari SEMUA baris (bukan cuma yang sudah dilabel), supaya
  // hari yang sudah discan tapi labelnya belum jalan (outcome baru bisa
  // dihitung besok, atau cron label-outcomes belum/gagal jalan) tetap
  // muncul di tren dengan status "pending" — bukan hilang tanpa keterangan
  // seperti sebelumnya, yang bikin susah dibedakan "belum dilabel" vs
  // "cron scan-nya gagal total".
  const MIN_DAILY_SCAN_COUNT = 100;
  const byDateMap = groupBy(rows, (r) => r.scan_date);
  const byDate = Array.from(byDateMap.entries())
    .map(([tanggal, group]) => {
      // ============================================================
      // TREN HARIAN = AKURASI PREDIKSI, bukan kondisi pasar
      // ============================================================
      // Riwayat perubahan basis metrik ini:
      //
      //   v1 (lama)  gap_up_realized — (open H+1 - close H)/close H >= 2%.
      //              Itu mengukur GAP DI LELANG PEMBUKAAN, sama sekali
      //              bukan strategi aplikasi ini. Pada 33 hari perdagangan
      //              korelasinya dengan hasil strategi -0,021 (praktis
      //              nol) dan MENGURUTKAN HARI TERBALIK: 26 Agustus
      //              tampil 2,27% (terburuk) padahal itu hari terbaik.
      //
      //   v2         next_day_success (peak >=3% ATAU close >=2%).
      //              Sudah sesuai strategi, tapi mengukur PASARNYA —
      //              berapa persen dari SEMUA saham yang naik. Naik-turun
      //              angkanya lebih banyak bercerita soal kondisi bursa
      //              daripada soal kualitas model.
      //
      //   v3 (ini)   AKURASI PREDIKSI pada target utama: dari saham yang
      //              DIPILIH model sore itu, berapa persen yang besoknya
      //              menyentuh >= +5% dari close. Inilah pertanyaan yang
      //              sebenarnya ingin dijawab halaman evaluasi.
      //
      // Angka ini TIDAK BOLEH dibaca sendirian. 30% terdengar buruk di
      // pasar yang lagi panas dan sangat bagus di pasar sepi, jadi
      // base_rate_5pct (persentase SELURUH saham yang discan hari itu
      // yang menyentuh +5%) ikut dikirim, dan selisihnya = lift_5pct.
      // Lift itu yang mengukur model; hit rate mentah mengukur hari.
      const labeledInGroup = group.filter(
        (r) => r.next_day_max_gain_from_close_pct !== null &&
               r.next_day_max_gain_from_close_pct !== undefined
      );
      const pending = labeledInGroup.length === 0;

      const hit5 = (r) => Number(r.next_day_max_gain_from_close_pct) >= HIGH_TARGET_PCT;

      // Baris yang dipilih model. conviction_tier baru ada sejak V4;
      // baris lama hanya punya label, jadi label dipakai sebagai
      // cadangan supaya riwayat sebelum 3 Sep tetap terhitung.
      const predicted = labeledInGroup.filter((r) =>
        r.next_day_conviction_tier
          ? r.next_day_conviction_tier === "PRIMARY"
          : r.next_day_opportunity_label === "HIGH"
      );

      const baseRate = labeledInGroup.length
        ? (labeledInGroup.filter(hit5).length / labeledInGroup.length) * 100
        : null;

      const hitRate = predicted.length
        ? (predicted.filter(hit5).length / predicted.length) * 100
        : null;

      const gapLabeled = group.filter(
        (r) => r.gap_up_realized !== null && r.gap_up_realized !== undefined
      );

      return {
        tanggal,
        total_scan: group.length,
        total_labeled: labeledInGroup.length,
        pending,

        // Metrik utama
        jumlah_prediksi: predicted.length,
        hit_rate_5pct: round(hitRate),
        base_rate_5pct: round(baseRate),
        lift_5pct: hitRate === null || baseRate === null ? null : round(hitRate - baseRate),
        avg_peak_pct: round(avg(predicted.map((r) => r.next_day_max_gain_from_close_pct))),

        // Konteks sekunder — dipertahankan supaya tidak hilang, tapi
        // bukan angka utama lagi.
        market_success_rate: round((winRateClose(labeledInGroup) ?? 0) * 100),
        gap_up_rate: gapLabeled.length
          ? round((gapLabeled.filter((r) => r.gap_up_realized === true).length / gapLabeled.length) * 100)
          : null
      };
    })
    .filter((row) => row.total_scan >= MIN_DAILY_SCAN_COUNT)
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : 1));

  // High Conviction (filter di api/scan.js) vs baseline BUY/STRONG BUY biasa
  // — mirror dari Cell 7 di db/TRAINING.MD, supaya bisa dicek cepat dari
  // dashboard tanpa harus buka Colab.
  const baseline = labeled.filter(
    (r) => r.signal === "BUY" || r.signal === "STRONG BUY"
  );
  const highConviction = labeled.filter((r) => {
    const gapOk = r.gap_outlook === "POSSIBLE GAP UP" || r.gap_outlook === "HIGH GAP UP";
    const closingOk = typeof r.closing_strength === "number" && r.closing_strength >= 0.5;
    const volumeOk = r.volume_signal && r.volume_signal !== "LOW";
    return (
      (r.signal === "BUY" || r.signal === "STRONG BUY") &&
      gapOk &&
      closingOk &&
      volumeOk
    );
  });

  const highConvictionVsBaseline = {
    baseline: summarizeGroup(baseline),
    high_conviction: summarizeGroup(highConviction)
  };

  // ==========================
  // Tahap 2 — kalibrasi Opportunity Engine (beli sore -> jual pagi/close).
  // Dipakai oleh riwayat.js untuk panel "Kalibrasi: Beli Sore -> Jual
  // Pagi/Close" (summaryOpportunity, byOpportunityLabel, eligibleVsNot).
  // Baris yang dipakai dibatasi ke yang SUDAH dilabel cron
  // /api/label-outcomes-close.js (next_day_success terisi) — bukan
  // labeled (Tahap 1, gap_up_realized) supaya win_rate & avg_return
  // konsisten pakai basis CLOSE H, bukan basis open H+1.
  const closeLabeled = rows.filter(
    (r) => r.next_day_success !== null && r.next_day_success !== undefined
  );

  const overallOpportunity = {
    total_labeled: closeLabeled.length,
    win_rate: round((winRateClose(closeLabeled) ?? 0) * 100),
    avg_return_pct: round(avg(closeLabeled.map((r) => r.next_day_close_return_from_close_pct))),
    avg_max_gain_pct: round(avg(closeLabeled.map((r) => r.next_day_max_gain_from_close_pct)))
  };

  const byOpportunityLabelMap = groupBy(closeLabeled, (r) => r.next_day_opportunity_label);
  const byOpportunityLabel = Array.from(byOpportunityLabelMap.entries())
    .map(([label, group]) => ({ opportunity_label: label, ...summarizeGroupClose(group) }))
    .sort((a, b) => b.jumlah - a.jumlah);

  const eligibleRows = closeLabeled.filter((r) => r.next_day_opportunity_eligible === true);
  const notEligibleRows = closeLabeled.filter((r) => r.next_day_opportunity_eligible !== true);
  const eligibleVsNotEligible = {
    eligible: summarizeGroupClose(eligibleRows),
    not_eligible: summarizeGroupClose(notEligibleRows)
  };

  return {
    overall,
    overall_opportunity: overallOpportunity,
    by_opportunity_label: byOpportunityLabel,
    eligible_vs_not_eligible: eligibleVsNotEligible,
    by_signal: bySignal,
    by_score_bucket: byScoreBucket,
    by_breakout_level: byBreakout,
    by_date: byDate,
    high_conviction_vs_baseline: highConvictionVsBaseline
  };
}
