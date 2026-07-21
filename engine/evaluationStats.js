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

export function computeSummary(rows) {
  const labeled = rows.filter(
    (r) => r.gap_up_realized !== null && r.gap_up_realized !== undefined
  );

  const overall = {
    total_scan: rows.length,
    total_labeled: labeled.length,
    win_rate: round((winRate(labeled) ?? 0) * 100),
    avg_return_pct: round(avg(labeled.map((r) => r.next_day_return_pct)))
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

  return {
    overall,
    by_signal: bySignal,
    by_score_bucket: byScoreBucket,
    by_breakout_level: byBreakout,
    by_date: byDate,
    high_conviction_vs_baseline: highConvictionVsBaseline
  };
}
