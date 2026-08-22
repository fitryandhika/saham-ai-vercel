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
function winRateHigh3pct(rows) {
  const labeled = rows.filter(
    (r) => r.next_day_high_3pct_realized !== null && r.next_day_high_3pct_realized !== undefined
  );
  if (labeled.length === 0) return null;
  const wins = labeled.filter((r) => r.next_day_high_3pct_realized === true).length;
  return wins / labeled.length;
}

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

  // Basis KHUSUS untuk kartu ringkasan atas (total_labeled + win_rate) —
  // lihat catatan di winRateHigh3pct() di atas. bySignal/byScoreBucket/
  // byBreakout di bawah SENGAJA tetap pakai `labeled` (basis lama,
  // gap_up_realized) supaya tidak mengubah semantik tabel lain yang
  // masih dihitung di response API ini walau sudah tidak ditampilkan
  // di UI (dihapus dari Riwayat AI sebelumnya).
  const labeledHigh3pct = rows.filter(
    (r) => r.next_day_high_3pct_realized !== null && r.next_day_high_3pct_realized !== undefined
  );

  const overall = {
    total_scan: rows.length,
    total_labeled: labeledHigh3pct.length,
    win_rate: round((winRateHigh3pct(labeledHigh3pct) ?? 0) * 100),
    avg_return_pct: round(avg(labeledHigh3pct.map((r) => r.next_day_return_pct)))
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
      const labeledInGroup = group.filter(
        (r) => r.gap_up_realized !== null && r.gap_up_realized !== undefined
      );
      const pending = labeledInGroup.length === 0;
      return {
        tanggal,
        total_scan: group.length,
        pending,
        ...summarizeGroup(labeledInGroup)
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
