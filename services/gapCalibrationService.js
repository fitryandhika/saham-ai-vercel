// ==========================
// Gap Calibration Service — Supabase REST (gap_calibration)
// ==========================
//
// Pola sama persis dengan services/macroDataService.js & dataLogService.js
// (REST/PostgREST, bukan driver Postgres langsung). Env var sama:
// SUPABASE_URL, SUPABASE_SERVICE_KEY.

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) return null;

  return { url, key };
}

// Ganti seluruh tabel dengan hasil hitung ulang terbaru (bukan cuma
// upsert baris yang berubah) — bucket yang di run sebelumnya ada tapi
// sekarang sampelnya nol (misal kombinasi RSI/volume yang sudah tidak
// pernah terjadi lagi) harus ikut hilang, bukan nyangkut jadi data basi
// yang terus dipakai untuk blending walau sudah tidak representatif.
// DELETE lalu INSERT dalam 2 request terpisah (bukan transaksi, REST
// API sederhana ini tidak dukung itu) — cukup aman karena tabel ini
// cuma dipakai sebagai referensi baca best-effort di gap.js, bukan
// data kritis yang perlu strict consistency.
export async function saveGapCalibration(table) {
  const cfg = getConfig();

  if (!cfg) {
    console.warn(
      "SUPABASE_URL/SUPABASE_SERVICE_KEY belum diset — gap calibration tidak disimpan."
    );
    return { saved: 0, skipped: true };
  }

  if (!table || table.length === 0) {
    return { saved: 0, skipped: false };
  }

  try {
    const delRes = await fetch(
      `${cfg.url}/rest/v1/gap_calibration?bucket_key=not.is.null`,
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
      throw new Error(`Supabase delete gap_calibration gagal (${delRes.status}): ${await delRes.text()}`);
    }

    const rows = table.map((r) => ({ ...r, computed_at: new Date().toISOString() }));

    const insRes = await fetch(`${cfg.url}/rest/v1/gap_calibration`, {
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
      throw new Error(`Supabase insert gap_calibration gagal (${insRes.status}): ${await insRes.text()}`);
    }

    return { saved: rows.length, skipped: false };
  } catch (e) {
    console.error("saveGapCalibration error:", e.message);
    return { saved: 0, skipped: false, error: e.message };
  }
}

// Ambil tabel kalibrasi TERBARU, dikembalikan sebagai Map (bucket_key
// -> {sample_count, win_rate, avg_return_pct}) supaya lookup di
// engine/gap.js O(1), bukan .find() linear tiap saham dalam batch scan.
export async function getGapCalibrationMap() {
  const cfg = getConfig();
  if (!cfg) return new Map();

  const res = await fetch(
    `${cfg.url}/rest/v1/gap_calibration?select=bucket_key,sample_count,win_rate,avg_return_pct`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`
      }
    }
  );

  if (!res.ok) {
    console.error(`getGapCalibrationMap gagal (${res.status}): ${await res.text()}`);
    return new Map();
  }

  const rows = await res.json();
  return new Map(rows.map((r) => [r.bucket_key, r]));
}

export default saveGapCalibration;
