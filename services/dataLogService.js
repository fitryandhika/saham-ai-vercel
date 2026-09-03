// ==========================
// Data Log Service — Supabase REST
// ==========================
//
// Pakai REST API Supabase (PostgREST) lewat fetch biasa — cocok untuk
// Vercel serverless karena tidak perlu connection pooling seperti
// driver Postgres langsung.
//
// Butuh 2 environment variable di Vercel (Project Settings -> Environment
// Variables, dari HP juga bisa lewat vercel.com):
//   SUPABASE_URL          -> https://xxxxx.supabase.co
//   SUPABASE_SERVICE_KEY  -> service_role key (BUKAN anon key — service
//                             role bisa nulis, dan HARUS dirahasiakan,
//                             cukup di-set di Vercel env, jangan pernah
//                             dikirim ke frontend/browser)

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    return null;
  }

  return { url, key };
}

// Insert banyak baris sekaligus. on_conflict=kode,scan_date supaya kalau
// scan dijalankan 2x di hari yang sama, baris lama di-update (bukan
// duplikat) — merge=true di header Prefer melakukan upsert parsial.
export async function logScanSnapshots(rows) {
  const cfg = getConfig();

  if (!cfg) {
    console.warn(
      "SUPABASE_URL/SUPABASE_SERVICE_KEY belum diset — snapshot tidak disimpan."
    );
    return { logged: 0, skipped: true };
  }

  if (!rows || rows.length === 0) {
    return { logged: 0, skipped: false };
  }

  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/scan_history?on_conflict=kode,scan_date`,
      {
        method: "POST",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rows)
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase insert gagal (${res.status}): ${text}`);
    }

    return { logged: rows.length, skipped: false };
  } catch (e) {
    console.error("logScanSnapshots error:", e.message);
    return { logged: 0, skipped: false, error: e.message };
  }
}

// Cari scan_date PALING LAMA yang masih punya baris belum dilabel
// (gap_up_realized masih null). Dipakai sebagai default target label
// di api/label-outcomes.js, menggantikan asumsi "kemarin = hari
// kalender - 1" yang salah kalau kena weekend/libur — misal snapshot
// Jumat baru bisa dilabel pakai open harga Senin, bukan "kemarin"
// dari sudut pandang cron yang jalan Senin pagi (yang berarti Minggu).
// Ambil yang PALING LAMA (bukan paling baru) supaya backlog yang
// sempat kelewat ikut kekejar, bukan cuma snapshot terbaru.
export async function getOldestUnlabeledDate() {
  const cfg = getConfig();
  if (!cfg) return null;

  const res = await fetch(
    `${cfg.url}/rest/v1/scan_history?gap_up_realized=is.null&select=scan_date&order=scan_date.asc&limit=1`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`
      }
    }
  );

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  const rows = await res.json();
  return rows.length > 0 ? rows[0].scan_date : null;
}

// Ambil baris scan_date tertentu yang belum dilabel (gap_up_realized
// masih null), untuk diisi oleh api/label-outcomes.js.
export async function getUnlabeledSnapshots(scanDate) {
  const cfg = getConfig();
  if (!cfg) return [];

  const res = await fetch(
    `${cfg.url}/rest/v1/scan_history?scan_date=eq.${scanDate}&gap_up_realized=is.null&select=id,kode,close,scan_date`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`
      }
    }
  );

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  return res.json();
}

// ==========================
// Tahap 2 — Close Labeling
// ==========================
//
// Close labeling TIDAK boleh bergantung pada labeled_at (Tahap 1).
// Jika worker pagi gagal, worker close tetap harus bisa menyelesaikan
// seluruh OHLC H+1 sekaligus. Ini membuat pipeline self-healing.

export async function getOldestOpenLabeledDate() {
  const cfg = getConfig();
  if (!cfg) return null;

  const res = await fetch(
    `${cfg.url}/rest/v1/scan_history?close_labeled_at=is.null&select=scan_date&order=scan_date.asc&limit=1`,
    { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } }
  );

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  const rows = await res.json();
  return rows.length > 0 ? rows[0].scan_date : null;
}

export async function getPendingCloseSnapshots(scanDate) {
  const cfg = getConfig();
  if (!cfg) return [];

  const params = new URLSearchParams();
  params.set('scan_date', `eq.${scanDate}`);
  params.set('close_labeled_at', 'is.null');
  params.set('select', 'id,kode,scan_date,close,actual_next_open,labeled_at,close_label_status,close_label_attempts,close_label_next_retry_at');
  params.set('order', 'kode.asc');

  const res = await fetch(`${cfg.url}/rest/v1/scan_history?${params.toString()}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
  });

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  return res.json();
}

// Ambil SEMUA snapshot yang sudah jatuh tempo untuk close labeling.
// Tidak memakai labeled_at sebagai syarat: close worker sekaligus dapat
// mengisi Tahap 1 jika worker pagi sebelumnya gagal.
//
// Retry-aware: row yang gagal sementara diberi next_retry_at sehingga
// satu saham bermasalah tidak menghabiskan seluruh kapasitas setiap run.
export async function getPendingCloseSnapshotsAcrossDates({
  beforeDate,
  maxRows = 3000
} = {}) {
  const cfg = getConfig();
  if (!cfg) return [];

  const PAGE_SIZE = 1000;
  let offset = 0;
  const all = [];
  const nowIso = new Date().toISOString();

  while (all.length < maxRows) {
    const params = new URLSearchParams();
    params.set('select', 'id,kode,scan_date,close,actual_next_open,labeled_at,close_label_status,close_label_attempts,close_label_next_retry_at');
    params.set('close_labeled_at', 'is.null');
    params.set('order', 'scan_date.asc,kode.asc');
    params.set('limit', String(Math.min(PAGE_SIZE, maxRows - all.length)));
    params.set('offset', String(offset));

    if (beforeDate) params.set('scan_date', `lt.${beforeDate}`);

    // Only retry rows whose retry window has arrived. Rows without a
    // retry timestamp are immediately eligible.
    params.set('or', `(close_label_next_retry_at.is.null,close_label_next_retry_at.lte.${nowIso})`);

    const res = await fetch(`${cfg.url}/rest/v1/scan_history?${params.toString()}`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
    });

    if (!res.ok) {
      throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
    }

    const page = await res.json();
    all.push(...page);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

// Menandai kegagalan sementara tanpa mengeluarkan row dari dataset.
// Exponential backoff dibatasi agar data yang sempat gagal akan kembali
// dicoba otomatis, tetapi tidak bisa memblokir tanggal/emiten lain.
export async function markCloseLabelRetry(id, { error, attempts = 0 } = {}) {
  const nextAttempts = Number.isFinite(Number(attempts)) ? Number(attempts) + 1 : 1;
  const delayMinutes = Math.min(360, Math.max(10, 10 * (2 ** Math.min(nextAttempts - 1, 5))));
  const nextRetry = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

  return updateLabel(id, {
    close_label_status: 'RETRY',
    close_label_attempts: nextAttempts,
    close_label_last_error: String(error || 'Unknown error').slice(0, 1000),
    close_label_next_retry_at: nextRetry
  });
}

// Update satu baris (by id) dengan hasil aktual keesokan harinya.
export async function updateLabel(id, patch) {
  const cfg = getConfig();
  if (!cfg) return null;

  const res = await fetch(`${cfg.url}/rest/v1/scan_history?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(patch)
  });

  if (!res.ok) {
    throw new Error(`Supabase update gagal (${res.status}): ${await res.text()}`);
  }

  return true;
}


// Ambil snapshot fitur yang cukup untuk menghitung ulang score + signal +
// next-day opportunity menggunakan engine versi aktif. Dipakai oleh
// /api/relabel-high-low?target=model-sync supaya Riwayat AI bisa disinkronkan
// dengan logic scorer terbaru tanpa fetch candle eksternal.
export async function getRowsForModelSync({ scanDate, kode, limit = 5000 } = {}) {
  const cfg = getConfig();
  if (!cfg) return [];

  const cols = [
    "id", "kode", "scan_date", "close", "sma20", "sma50", "ema9", "ema20",
    "rsi", "macd", "risk_reward", "breakout_level", "breakout_distance_pct",
    "closing_strength", "volume_ratio", "volume_signal",
    "volume_accel_slope_pct", "volume_accelerating", "rs_label",
    "illiquid", "market_regime", "market_regime_score",
    "exhaustion_score", "distribution_score", "daily_change_pct",
    // DITAMBAHKAN 3 September 2026 untuk Opportunity V4.
    //   atr + close   -> atr_pct, fitur terkuat model (Spearman +0,36)
    //   rs_vs_ihsg    -> sebelumnya HANYA rs_label yang diambil, padahal
    //                    model butuh angkanya. Tanpa ini, setiap baris
    //                    hasil model-sync dihitung dengan rs = 0 —
    //                    hasilnya beda dari scan live untuk saham yang
    //                    sama. Ini bug lama yang baru kelihatan sekarang.
    // sma20/sma50 sudah ada di atas, dipakai untuk ext20/ext50.
    "atr", "rs_vs_ihsg",
    // Dibaca supaya bisa melaporkan skor lama vs baru dengan jujur.
    "next_day_opportunity_score", "next_day_opportunity_label"
  ].join(",");

  const params = new URLSearchParams();
  params.set("select", cols);
  params.set("order", "kode.asc");
  params.set("limit", String(limit));
  if (scanDate) params.set("scan_date", `eq.${scanDate}`);
  if (kode) params.set("kode", `eq.${kode.toUpperCase()}`);

  const res = await fetch(`${cfg.url}/rest/v1/scan_history?${params.toString()}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
  });

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  return res.json();
}

// ==========================
// Query untuk Dashboard Riwayat (api/history.js)
// ==========================
// Dua fungsi di bawah ini READ-ONLY, dipakai halaman dashboard.html.
// Tetap lewat backend (bukan Supabase langsung dari browser) supaya
// SUPABASE_SERVICE_KEY tidak pernah terekspos ke frontend.

// Baris terbaru untuk tabel riwayat di dashboard, dengan filter opsional.
//
// DIPERLUAS 3 September 2026. Sebelumnya tabel Riwayat cuma bisa
// difilter kode / tanggal / pola, dan selalu diurutkan tanggal terbaru
// dengan limit 100. Satu hari scan berisi ±400 emiten, jadi 100 baris
// teratas itu potongan sembarang dari satu hari yang sama — tidak ada
// cara menemukan baris yang menarik (skor tinggi, hasil besar, tier
// PRIMARY) tanpa export CSV dulu. Filter & sort di bawah menyelesaikan
// itu di sisi server, bukan di browser, supaya yang 400 baris tidak
// perlu ditarik semua ke HP.
function buildHistoryParams({
  scanDate,
  sinceDate,
  untilDate,
  kode,
  onlyLabeled = false,
  pattern,
  tier,          // PRIMARY | SECONDARY | NONE
  opportunity,   // HIGH | MODERATE | WATCH | LOW
  minOpportunityScore,
  entryDecision, // BUY_NOW | WAIT_PULLBACK | WATCH | AVOID
  outcome,       // win5 | win3 | lossClose
  sort = "date"  // date | opp | gain | ret
} = {}) {
  const params = new URLSearchParams();
  params.set("select", "*");

  const ORDERS = {
    date: "scan_date.desc,scanned_at.desc",
    // nullslast supaya baris yang belum punya skor/hasil tidak
    // menyumbat halaman pertama saat diurutkan menurun.
    opp: "next_day_opportunity_score.desc.nullslast,scan_date.desc",
    gain: "next_day_max_gain_from_close_pct.desc.nullslast,scan_date.desc",
    ret: "next_day_close_return_from_close_pct.desc.nullslast,scan_date.desc"
  };
  params.set("order", ORDERS[sort] || ORDERS.date);

  if (scanDate) params.set("scan_date", `eq.${scanDate}`);
  // Rentang tanggal hanya dipakai kalau tanggal persis tidak diisi —
  // dua-duanya sekaligus akan saling meniadakan di PostgREST.
  if (!scanDate && sinceDate) params.append("scan_date", `gte.${sinceDate}`);
  if (!scanDate && untilDate) params.append("scan_date", `lte.${untilDate}`);

  // Prefix match, bukan eq — supaya mengetik "BB" memunculkan BBCA,
  // BBRI, BBNI sekaligus. Kode persis tetap cocok.
  if (kode) params.set("kode", `ilike.${kode.toUpperCase()}%`);

  if (onlyLabeled) params.set("next_day_max_gain_from_close_pct", "not.is.null");
  if (pattern === "reversal") params.set("reversal_candidate", "eq.true");
  if (pattern === "capitulation") params.set("capitulation_bounce_candidate", "eq.true");

  if (tier) params.set("next_day_conviction_tier", `eq.${tier}`);
  if (opportunity) params.set("next_day_opportunity_label", `eq.${opportunity}`);
  if (entryDecision) params.set("next_day_entry_decision", `eq.${entryDecision}`);

  const minOpp = Number(minOpportunityScore);
  if (Number.isFinite(minOpp)) {
    params.set("next_day_opportunity_score", `gte.${minOpp}`);
  }

  // Filter hasil. Sengaja memakai kolom yang sama dengan yang dipakai
  // evaluasi model, bukan kolom lama berbasis OPEN H+1.
  if (outcome === "win5") params.append("next_day_max_gain_from_close_pct", "gte.5");
  else if (outcome === "win3") params.append("next_day_max_gain_from_close_pct", "gte.3");
  else if (outcome === "lossClose") params.set("next_day_close_return_from_close_pct", "lt.0");

  return params;
}

export async function getScanHistoryRows(options = {}) {
  const { limit = 200, offset = 0 } = options;
  const cfg = getConfig();
  if (!cfg) return [];

  const params = buildHistoryParams(options);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const res = await fetch(`${cfg.url}/rest/v1/scan_history?${params.toString()}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`
    }
  });

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  return res.json();
}

// Sama seperti getScanHistoryRows, tapi ikut mengembalikan JUMLAH TOTAL
// baris yang cocok filter — bukan cuma satu halaman. Dipakai tabel
// Riwayat untuk menampilkan "menampilkan 100 dari 397" dan menentukan
// apakah tombol "Muat lebih banyak" perlu muncul.
//
// Total didapat dari header Content-Range PostgREST (format
// "0-99/397") lewat Prefer: count=exact. Ini satu request yang sama,
// tidak menambah round-trip.
export async function getScanHistoryPage(options = {}) {
  const { limit = 100, offset = 0 } = options;
  const cfg = getConfig();
  if (!cfg) return { rows: [], total: 0 };

  const params = buildHistoryParams(options);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const res = await fetch(`${cfg.url}/rest/v1/scan_history?${params.toString()}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Prefer: "count=exact"
    }
  });

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  const rows = await res.json();
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);

  return { rows, total: Number.isFinite(total) ? total : rows.length };
}

// Sama seperti getScanHistoryRows, tapi meng-ambil SEMUA baris yang cocok
// dengan filter, bukan cuma satu halaman. Supabase/PostgREST punya batas
// server-side (max-rows, defaultnya 1000) yang tetap berlaku walaupun kita
// minta `limit` lebih besar dari itu di query string — jadi satu request
// saja tidak cukup untuk data yang sudah lebih dari 1000 baris (mis. export
// CSV "semua tanggal"). Fungsi ini loop per 1000 baris pakai offset sampai
// hasilnya habis (baris yang dibalikin < ukuran halaman), lalu gabungkan.
export async function getAllScanHistoryRows({
  maxRows = 50000, // batas pengaman supaya tidak looping tanpa henti / timeout
  ...filters       // semua filter di buildHistoryParams ikut diteruskan,
                   // supaya export CSV persis mengikuti filter yang aktif
                   // di layar — bukan cuma kode/tanggal/pola seperti dulu.
} = {}) {
  const PAGE_SIZE = 1000; // samakan dengan max-rows Supabase supaya tiap halaman penuh
  let offset = 0;
  let all = [];

  while (true) {
    const page = await getScanHistoryRows({
      ...filters,
      limit: PAGE_SIZE,
      offset
    });

    all = all.concat(page);

    // Berhenti kalau halaman ini tidak penuh (berarti sudah baris terakhir),
    // atau kalau sudah mencapai batas pengaman maxRows.
    if (page.length < PAGE_SIZE || all.length >= maxRows) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return all;
}

// Ambil baris yang SUDAH dilabel (gap_up_realized terisi) tapi BELUM
// punya actual_next_high/low — ini baris lama dari sebelum kolom
// high/low/max_gain_from_open_pct ditambahkan. Dipakai oleh
// api/relabel-high-low.js untuk mengisi retroaktif. Diurutkan per kode
// supaya caller bisa kelompokkan baris per emiten dan cukup 1x fetch
// candle history per kode (bukan per baris).
export async function getRowsMissingHighLow({ limit = 5000 } = {}) {
  const cfg = getConfig();
  if (!cfg) return [];

  const params = new URLSearchParams();
  params.set("select", "id,kode,scan_date,actual_next_open,actual_next_close");
  params.set("gap_up_realized", "not.is.null");
  params.set("actual_next_high", "is.null");
  params.set("order", "kode.asc,scan_date.asc");
  params.set("limit", String(limit));

  const res = await fetch(`${cfg.url}/rest/v1/scan_history?${params.toString()}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`
    }
  });

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  return res.json();
}

// Ambil baris yang belum punya session_gain_score — baris lama dari
// sebelum engine/sessionGainScore.js dirilis (~22 Juli 2026). Beda
// dengan getRowsMissingHighLow: tidak perlu fetch candle Yahoo Finance
// sama sekali, karena semua input calculateSessionGainScore() (signal,
// score, volume_accelerating, volume_signal, volume_ratio, gap_outlook,
// rs_label) SUDAH tersimpan di baris itu sendiri — backfill-nya murni
// hitung ulang dari kolom yang sudah ada, jadi jauh lebih cepat & tidak
// butuh rate-limit ketat. Dipakai oleh api/relabel-session-gain.js.
export async function getRowsMissingSessionGain({ limit = 5000 } = {}) {
  const cfg = getConfig();
  if (!cfg) return [];

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,signal,score,volume_accelerating,volume_signal,volume_ratio,gap_outlook,rs_label,illiquid"
  );
  params.set("session_gain_score", "is.null");
  params.set("order", "scan_date.asc");
  params.set("limit", String(limit));

  const res = await fetch(`${cfg.url}/rest/v1/scan_history?${params.toString()}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`
    }
  });

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  return res.json();
}

// Ambil baris yang belum punya next_day_opportunity_label — baris lama
// dari sebelum kolom ini ada (migration 2026-08-09, lihat db/migration_
// 2026-08-09-next-day-opportunity.sql). Sama seperti getRowsMissingSessionGain:
// SEMUA input calculateNextDayOpportunity() sudah tersimpan sebagai kolom
// di baris itu sendiri (score, rsi, macd, sma/ema, risk_reward,
// closing_strength, volume_ratio, volume_accel_slope_pct, breakout_level,
// breakout_distance_pct, rs_label, exhaustion_score, distribution_score,
// illiquid, daily_change_pct) KECUALI marketTrend yang tidak pernah
// disimpan sebagai kolom sendiri — makanya dipanggil ulang dari
// close/sma20/sma50/ema9/ema20/macd yang memang sudah ada. Backfill ini
// murni hitung ulang, TIDAK fetch Yahoo/candle sama sekali, jadi bisa
// diproses per baris langsung (bukan per kode) dan concurrency tinggi
// aman. Dipakai oleh api/relabel-high-low.js?target=opportunity.
export async function getRowsMissingOpportunity({ limit = 5000 } = {}) {
  const cfg = getConfig();
  if (!cfg) return [];

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,score,close,rsi,macd,sma20,sma50,ema9,ema20,risk_reward,closing_strength," +
      "volume_ratio,volume_accel_slope_pct,breakout_level,breakout_distance_pct," +
      "rs_label,exhaustion_score,distribution_score,illiquid,daily_change_pct"
  );
  params.set("next_day_opportunity_label", "is.null");
  params.set("order", "scan_date.asc");
  params.set("limit", String(limit));

  const res = await fetch(`${cfg.url}/rest/v1/scan_history?${params.toString()}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`
    }
  });

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  return res.json();
}

// Baris untuk ringkasan statistik, kolom diminimalkan (bukan select *)
// supaya payload tetap ringan walau datasetnya sudah ribuan baris —
// dipakai untuk menghitung ringkasan statistik di computeSummary().
//
// CATATAN: sengaja TIDAK difilter gap_up_realized not.is.null di sini lagi.
// computeSummary() sendiri yang memisahkan baris "sudah dilabel" vs
// "belum dilabel" (misal scan hari ini yang outcome-nya baru bisa dihitung
// besok) — supaya hari yang sudah discan tapi belum dilabel tetap kelihatan
// di tren harian sebagai "menunggu pelabelan", bukan hilang tanpa keterangan.
//
// PERBAIKAN 2 Agustus 2026: sebelumnya cuma 1x fetch dengan limit=10000,
// tapi Supabase (PostgREST) punya batas keras server-side (default
// max-rows 1000) yang DIAM-DIAM memotong hasil ke 1000 baris walau
// `limit` di query string diminta lebih besar — makanya "Total Scan"
// di dashboard selalu mentok 1.000 walau data yang sudah discan lebih
// dari itu. Diperbaiki jadi loop per 1000 baris pakai offset (sama
// pola dengan getAllScanHistoryRows), sampai halaman tidak penuh lagi
// atau kena batas pengaman maxRows.
export async function getLabeledRowsForStats({ sinceDate, kode, maxRows = 50000 } = {}) {
  const cfg = getConfig();
  if (!cfg) return [];

  const cols = [
    "kode", "sector", "scan_date", "score", "signal", "rsi",
    "breakout_level", "closing_strength", "volume_signal",
    "gap_outlook", "next_day_return_pct", "gap_up_realized", "rs_label",
    // FIX (21 Agustus 2026): kolom ini sempat lupa ditambahkan waktu
    // win_rate di kartu ringkasan diganti basisnya ke
    // next_day_high_3pct_realized (lihat engine/evaluationStats.js) —
    // akibatnya computeSummary() selalu dapat undefined untuk field ini
    // di SETIAP baris (walau datanya ada & terisi di Supabase), jadi
    // total_labeled selalu 0 dan Riwayat AI nunjukkin "Belum ada data
    // yang sudah dilabel" padahal datanya ada.
    "next_day_high_3pct_realized",
    // Kolom strategi "beli sore -> jual pagi/close" (Next-Day Opportunity
    // Engine + label Tahap 2 dari api/label-outcomes-close.js) — dipakai
    // computeSummary() untuk kalibrasi yang benar-benar mencerminkan
    // strategi ini, bukan cuma proxy gap_up_realized (basis open H+1).
    "next_day_opportunity_label", "next_day_opportunity_eligible",
    "next_day_opportunity_setup", "next_day_opportunity_score",
    "next_day_entry_quality_score", "next_day_entry_quality_label",
    "next_day_chase_risk", "next_day_entry_decision", "next_day_entry_eligible",
    "next_day_close_return_from_close_pct", "next_day_max_gain_from_close_pct",
    "next_day_success"
  ].join(",");

  const PAGE_SIZE = 1000; // samakan dengan max-rows Supabase supaya tiap halaman penuh
  let offset = 0;
  let all = [];

  while (true) {
    const params = new URLSearchParams();
    params.set("select", cols);
    // Urutkan dari TERBARU dulu supaya kalau kena batas pengaman
    // maxRows, yang kepotong data LAMA — bukan hari ini/kemarin.
    // Urutan hasil tidak masalah buat computeSummary() karena semua
    // agregasi di sana (groupBy per tanggal, per bucket skor, dst)
    // tidak bergantung pada urutan array input.
    params.set("order", "scan_date.desc");
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));

    if (sinceDate) params.set("scan_date", `gte.${sinceDate}`);
    if (kode) params.set("kode", `eq.${kode.toUpperCase()}`);

    const res = await fetch(`${cfg.url}/rest/v1/scan_history?${params.toString()}`, {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`
      }
    });

    if (!res.ok) {
      throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
    }

    const page = await res.json();
    all = all.concat(page);

    if (page.length < PAGE_SIZE || all.length >= maxRows) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return all;
}

export default logScanSnapshots;

// ==========================
// Universe Snapshot (lihat api/universe-refresh.js)
// ==========================
// Sama pola PostgREST-nya dengan fungsi-fungsi di atas. Tabel
// universe_snapshot menyimpan daftar emiten yang lolos filter likuiditas
// otomatis (menggantikan/melengkapi config/universe.js yang manual) —
// lihat db/migration_2026-08-03-universe-refresh.sql.

// Timpa SELURUH isi tabel dengan snapshot baru (bukan upsert baris demi
// baris) — sengaja delete-then-insert, karena universe minggu ini bisa
// saja TIDAK lagi memuat kode yang minggu lalu masih lolos filter (mis.
// likuiditasnya turun) — upsert biasa tidak akan menghapus baris lama
// yang sudah tidak relevan itu.
export async function replaceUniverseSnapshot(rows) {
  const cfg = getConfig();

  if (!cfg) {
    console.warn(
      "SUPABASE_URL/SUPABASE_SERVICE_KEY belum diset — universe snapshot tidak disimpan."
    );
    return { saved: 0, skipped: true };
  }

  if (!rows || rows.length === 0) {
    return { saved: 0, skipped: false };
  }

  try {
    // Hapus semua baris lama dulu. Filter "kode=neq.__none__" dipakai
    // karena PostgREST mewajibkan minimal satu filter untuk DELETE lewat
    // REST API (tidak boleh DELETE tanpa WHERE sama sekali) — kode ini
    // tidak pernah ada di data asli, jadi efeknya menghapus semua baris.
    const delRes = await fetch(
      `${cfg.url}/rest/v1/universe_snapshot?kode=neq.__none__`,
      {
        method: "DELETE",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          Prefer: "return=minimal"
        }
      }
    );

    if (!delRes.ok) {
      throw new Error(`Supabase delete gagal (${delRes.status}): ${await delRes.text()}`);
    }

    const insRes = await fetch(`${cfg.url}/rest/v1/universe_snapshot`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(rows)
    });

    if (!insRes.ok) {
      throw new Error(`Supabase insert gagal (${insRes.status}): ${await insRes.text()}`);
    }

    return { saved: rows.length, skipped: false };
  } catch (e) {
    console.error("replaceUniverseSnapshot error:", e.message);
    return { saved: 0, skipped: false, error: e.message };
  }
}

// Dipakai oleh api/scan.js — kalau tabel kosong atau Supabase belum
// diset, return [] dan caller HARUS fallback ke config/universe.js
// statis (lihat resolveUniverse() di sana).
export async function getUniverseFromDb() {
  const cfg = getConfig();
  if (!cfg) return [];

  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/universe_snapshot?select=kode,sector,market_cap&order=kode.asc&limit=2000`,
      {
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`
        }
      }
    );

    if (!res.ok) {
      throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
    }

    return res.json();
  } catch (e) {
    console.error("getUniverseFromDb error:", e.message);
    return [];
  }
}

// ==========================
// Backfill Gap (lihat api/relabel-high-low.js?target=backfill-gap)
// ==========================
// Ambil daftar kode yang SUDAH punya baris untuk satu scan_date tertentu.
// Dipakai supaya backfill tidak insert dobel kalau dipanggil berkali-kali
// (dilanjutkan setelah kena batas maxKode per panggilan) — sama alasannya
// dengan getRowsMissingHighLow, cuma filternya per tanggal bukan per status
// label.
export async function getScannedKodeForDate(scanDate) {
  const cfg = getConfig();
  if (!cfg) return [];

  const res = await fetch(
    `${cfg.url}/rest/v1/scan_history?scan_date=eq.${scanDate}&select=kode`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`
      }
    }
  );

  if (!res.ok) {
    throw new Error(`Supabase select gagal (${res.status}): ${await res.text()}`);
  }

  const rows = await res.json();
  return rows.map((r) => r.kode);
}
