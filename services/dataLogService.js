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

export default logScanSnapshots;
