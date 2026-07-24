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
// Tahap 2 — Close Labeling (lihat api/label-outcomes-close.js)
// ==========================
// Sama pola-nya dengan getOldestUnlabeledDate/getUnlabeledSnapshots di
// atas (tahap 1), tapi filternya: SUDAH dilabel open (labeled_at not
// null) TAPI BELUM dilabel close (close_labeled_at is null).

export async function getOldestOpenLabeledDate() {
  const cfg = getConfig();
  if (!cfg) return null;

  const res = await fetch(
    `${cfg.url}/rest/v1/scan_history?labeled_at=not.is.null&close_labeled_at=is.null&select=scan_date&order=scan_date.asc&limit=1`,
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

export async function getPendingCloseSnapshots(scanDate) {
  const cfg = getConfig();
  if (!cfg) return [];

  const res = await fetch(
    `${cfg.url}/rest/v1/scan_history?scan_date=eq.${scanDate}&labeled_at=not.is.null&close_labeled_at=is.null&select=id,kode,scan_date,close,actual_next_open`,
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

// ==========================
// Query untuk Dashboard Riwayat (api/history.js)
// ==========================
// Dua fungsi di bawah ini READ-ONLY, dipakai halaman dashboard.html.
// Tetap lewat backend (bukan Supabase langsung dari browser) supaya
// SUPABASE_SERVICE_KEY tidak pernah terekspos ke frontend.

// Baris terbaru untuk tabel riwayat di dashboard, dengan filter opsional.
export async function getScanHistoryRows({
  scanDate,
  kode,
  onlyLabeled = false,
  limit = 200,
  offset = 0
} = {}) {
  const cfg = getConfig();
  if (!cfg) return [];

  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("order", "scan_date.desc,scanned_at.desc");
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  if (scanDate) params.set("scan_date", `eq.${scanDate}`);
  if (kode) params.set("kode", `eq.${kode.toUpperCase()}`);
  if (onlyLabeled) params.set("gap_up_realized", "not.is.null");

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

// Sama seperti getScanHistoryRows, tapi meng-ambil SEMUA baris yang cocok
// dengan filter, bukan cuma satu halaman. Supabase/PostgREST punya batas
// server-side (max-rows, defaultnya 1000) yang tetap berlaku walaupun kita
// minta `limit` lebih besar dari itu di query string — jadi satu request
// saja tidak cukup untuk data yang sudah lebih dari 1000 baris (mis. export
// CSV "semua tanggal"). Fungsi ini loop per 1000 baris pakai offset sampai
// hasilnya habis (baris yang dibalikin < ukuran halaman), lalu gabungkan.
export async function getAllScanHistoryRows({
  scanDate,
  kode,
  onlyLabeled = false,
  maxRows = 50000 // batas pengaman supaya tidak looping tanpa henti / timeout
} = {}) {
  const PAGE_SIZE = 1000; // samakan dengan max-rows Supabase supaya tiap halaman penuh
  let offset = 0;
  let all = [];

  while (true) {
    const page = await getScanHistoryRows({
      scanDate,
      kode,
      onlyLabeled,
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

// Baris untuk ringkasan statistik, kolom diminimalkan (bukan select *)
// supaya payload tetap ringan walau datasetnya sudah ribuan baris —
// dipakai untuk menghitung ringkasan statistik di computeSummary().
//
// CATATAN: sengaja TIDAK difilter gap_up_realized not.is.null di sini lagi.
// computeSummary() sendiri yang memisahkan baris "sudah dilabel" vs
// "belum dilabel" (misal scan hari ini yang outcome-nya baru bisa dihitung
// besok) — supaya hari yang sudah discan tapi belum dilabel tetap kelihatan
// di tren harian sebagai "menunggu pelabelan", bukan hilang tanpa keterangan.
export async function getLabeledRowsForStats({ sinceDate, kode } = {}) {
  const cfg = getConfig();
  if (!cfg) return [];

  const cols = [
    "kode", "sector", "scan_date", "score", "signal",
    "breakout_level", "closing_strength", "volume_signal",
    "gap_outlook", "next_day_return_pct", "gap_up_realized"
  ].join(",");

  const params = new URLSearchParams();
  params.set("select", cols);
  // Urutkan dari TERBARU dulu (bukan asc/tertua) supaya kalau total riwayat
  // sudah melebihi limit 10000, yang kepotong adalah data LAMA — bukan data
  // terbaru seperti hari ini/kemarin. Urutan hasil tidak masalah buat
  // computeSummary() karena semua agregasi di sana (groupBy per tanggal,
  // per bucket skor, dst) tidak bergantung pada urutan array input.
  params.set("order", "scan_date.desc");
  params.set("limit", "10000");

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

  return res.json();
}

export default logScanSnapshots;
