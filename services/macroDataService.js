// ==========================
// Macro Data Service — Supabase REST (macro_snapshot)
// ==========================
//
// Pola sama persis dengan services/dataLogService.js (REST/PostgREST,
// bukan driver Postgres langsung — cocok untuk Vercel serverless).
// Pakai env var yang sama: SUPABASE_URL, SUPABASE_SERVICE_KEY.

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) return null;

  return { url, key };
}

// Upsert satu snapshot harian. on_conflict=snapshot_date supaya kalau
// cron dijalankan ulang di hari yang sama, baris di-update bukan
// duplikat (sama seperti pola logScanSnapshots di dataLogService.js).
export async function saveMacroSnapshot(row) {
  const cfg = getConfig();

  if (!cfg) {
    console.warn(
      "SUPABASE_URL/SUPABASE_SERVICE_KEY belum diset — macro snapshot tidak disimpan."
    );
    return { logged: 0, skipped: true };
  }

  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/macro_snapshot?on_conflict=snapshot_date`,
      {
        method: "POST",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify([row])
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase upsert macro_snapshot gagal (${res.status}): ${text}`);
    }

    const saved = await res.json();
    return { logged: 1, skipped: false, row: saved?.[0] ?? null };
  } catch (e) {
    console.error("saveMacroSnapshot error:", e.message);
    return { logged: 0, skipped: false, error: e.message };
  }
}

// Snapshot makro TERBARU (dipakai api/scan.js untuk ambil market_regime
// hari ini sebelum menjalankan batch scan).
export async function getLatestMacroSnapshot() {
  const cfg = getConfig();
  if (!cfg) return null;

  const res = await fetch(
    `${cfg.url}/rest/v1/macro_snapshot?select=*&order=snapshot_date.desc&limit=1`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`
      }
    }
  );

  if (!res.ok) {
    console.error(`getLatestMacroSnapshot gagal (${res.status}): ${await res.text()}`);
    return null;
  }

  const rows = await res.json();
  return rows.length ? rows[0] : null;
}

// N snapshot terakhir (terurut lama->baru), dipakai engine/marketRegime.js
// untuk menghitung tren (misal DXY naik/turun 5 hari terakhir), bukan
// cuma nilai absolut satu hari.
export async function getRecentMacroSnapshots(days = 10) {
  const cfg = getConfig();
  if (!cfg) return [];

  const res = await fetch(
    `${cfg.url}/rest/v1/macro_snapshot?select=*&order=snapshot_date.desc&limit=${days}`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`
      }
    }
  );

  if (!res.ok) {
    console.error(`getRecentMacroSnapshots gagal (${res.status}): ${await res.text()}`);
    return [];
  }

  const rows = await res.json();
  return rows.reverse(); // lama -> baru
}

export default saveMacroSnapshot;
