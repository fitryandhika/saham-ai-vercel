// ==========================
// zapi.web.id Integration Service
// ==========================
//
// Sumber tambahan (bukan pengganti Yahoo/IDX) untuk 2 kebutuhan yang
// tidak dipenuhi sumber lain:
//
//   1. Data fundamental (marketCap, PE ratio, sector) — Yahoo v8/chart
//      tidak menyediakan ini sama sekali.
//   2. Intraday peak time yang lebih presisi (per-menit) — Yahoo hanya
//      punya interval 15m dan cuma retensi ~60 hari.
//
// KETERBATASAN PENTING: endpoint intraday zapi (finance:stockbit:chart,
// timeframe=today) HANYA punya data HARI INI, tidak historis. Jadi cuma
// berguna kalau dipanggil pada tanggal yang sama dengan targetnya
// (misal cron label-outcomes-close yang jalan sore hari yang sama).
// Untuk tanggal lampau (mis. relabel-high-low.js pada backlog), fungsi
// ini akan return null dan caller HARUS fallback ke Yahoo 15m seperti
// sebelumnya — lihat pemanggilannya di stockService.js.
//
// Semua fungsi di sini best-effort: gagal fetch/parse -> return null,
// TIDAK PERNAH throw, supaya tidak pernah menggagalkan scan/labeling.

const BASE_URL = "https://api.zpi.web.id/v1";
const API_KEY = process.env.ZAPI_API_KEY || ""; // isi di Vercel env kalau endpoint butuh auth

async function tryFetchJson(url) {
  try {
    const headers = { Accept: "application/json" };
    if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("zapiService fetch error:", url, e.message);
    return null;
  }
}

// ==========================
// Fundamental snapshot (marketCap, PE ratio, sector versi Stockbit)
// ==========================
export async function getZapiFundamentals(kode) {
  const url = `${BASE_URL}/finance:stockbit:symbol?symbol=${encodeURIComponent(kode)}`;
  const json = await tryFetchJson(url);

  const d = json?.data;
  if (!d) return null;

  const marketCap = Number(d.marketCap);
  const peRatio = Number(d.peRatio);

  return {
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
    peRatio: Number.isFinite(peRatio) ? peRatio : null,
    sector: d.sector ?? null,
    subSector: d.subSector ?? null,
    marketStatus: d.marketStatus ?? null,
    bestBid: d.bestBid ?? null,
    bestOffer: d.bestOffer ?? null
  };
}

// ==========================
// Intraday peak time — HARI INI SAJA (lihat catatan keterbatasan di atas)
// ==========================
// targetDateWIB dicek oleh caller SEBELUM manggil fungsi ini (harus
// sama dengan tanggal hari ini WIB) — fungsi ini sendiri tidak
// memvalidasi itu supaya tetap simpel & mudah dites terpisah.
export async function getZapiIntradayPeakToday(kode) {
  const url =
    `${BASE_URL}/finance:stockbit:chart?symbol=${encodeURIComponent(kode)}` +
    `&market=indonesia&timeframe=today&interval=intraday`;

  const json = await tryFetchJson(url);
  const items = json?.data?.items;

  if (!Array.isArray(items) || items.length === 0) return null;

  let peakItem = null;
  for (const item of items) {
    const price = Number(item.price);
    if (!Number.isFinite(price)) continue;
    if (!peakItem || price > peakItem.price) {
      peakItem = { price, time: item.time };
    }
  }

  if (!peakItem || !peakItem.time) return null;

  // item.time format: "2026-08-03 09:43:00" (sudah WIB, lihat contoh
  // response) -> ambil komponen HH:MM saja.
  const match = String(peakItem.time).match(/(\d{2}):(\d{2})/);
  if (!match) return null;

  const peakTimeWIB = `${match[1]}:${match[2]}`;

  return {
    peakTimeWIB,
    peakHigh: peakItem.price,
    source: "ZAPI_STOCKBIT_INTRADAY"
  };
}
