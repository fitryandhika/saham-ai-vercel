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
//   3. Universe otomatis (semua ~959 emiten IDX) — lihat
//      getAllIdxStockSummary() & api/universe-refresh.js.
//
// CATATAN (3 Agustus 2026): sebelumnya pakai paket "zpi-sdk" ("Code
// examples" > tab zpi-sdk di dashboard zapi.web.id), tapi ternyata SDK
// itu error internal (`t.replace is not a function`, dari kode ter-
// minify SDK-nya sendiri, bukan dari cara kita pakai) untuk SEMUA
// dataset yang dicoba. Dibalik ke fetch REST langsung yang sudah
// terbukti jalan lewat "Try it" di dashboard sepanjang development.
// Header auth dikirim DUA cara sekaligus (Bearer & X-API-Key) supaya
// tetap jalan berapapun format yang dipakai servernya — header yang
// tidak dikenali biasanya diabaikan begitu saja oleh server.
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

function buildHeaders() {
  const apiKey = process.env.ZAPI_API_KEY;
  const headers = { Accept: "application/json" };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  return { headers, hasKey: Boolean(apiKey) };
}

async function tryFetchJson(path) {
  const { headers, hasKey } = buildHeaders();

  if (!hasKey) {
    console.warn("ZAPI_API_KEY belum diset — fitur zapi (fundamental/intraday/universe) nonaktif.");
    return null;
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, { headers });

    if (!res.ok) {
      console.error(`zapiService fetch gagal (${res.status}): ${path}`);
      return null;
    }

    return await res.json();
  } catch (e) {
    console.error(`zapiService fetch error: ${path}`, e.message);
    return null;
  }
}

// ==========================
// Fundamental snapshot (marketCap, PE ratio, sector versi Stockbit)
// ==========================
export async function getZapiFundamentals(kode) {
  const json = await tryFetchJson(
    `/finance:stockbit/symbol?symbol=${encodeURIComponent(kode)}`
  );

  const data = json?.data;
  if (!data) return null;

  const marketCap = Number(data.marketCap);
  const peRatio = Number(data.peRatio);

  return {
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
    peRatio: Number.isFinite(peRatio) ? peRatio : null,
    sector: data.sector ?? null,
    subSector: data.subSector ?? null,
    marketStatus: data.marketStatus ?? null,
    bestBid: data.bestBid ?? null,
    bestOffer: data.bestOffer ?? null
  };
}

// ==========================
// IDX listed-companies (Sektor/SubSektor RESMI, bukan kategorisasi
// komunitas) — dipaginate sekali per refresh, jauh lebih murah daripada
// panggil getZapiFundamentals per-saham satu-satu.
// ==========================
async function getListedCompaniesPage({ start = 0, length = 100 } = {}) {
  const json = await tryFetchJson(
    `/finance:idx/companies?length=${length}&start=${start}`
  );

  // Response nested dua level (dikonfirmasi lewat "Try it" di dashboard
  // zapi.web.id 4 Agustus 2026): { data: { recordsTotal, data: [...] } },
  // BUKAN { data: [...] } langsung seperti asumsi kode lama.
  const rows = Array.isArray(json?.data?.data) ? json.data.data : [];
  const recordsTotal = Number(json?.data?.recordsTotal ?? rows.length);

  return { rows, recordsTotal: Number.isFinite(recordsTotal) ? recordsTotal : rows.length };
}

// Return Map<kode, { sector, subSector }> untuk SEMUA emiten terdaftar —
// dipakai api/universe-refresh.js supaya tidak perlu fetch fundamental
// per-saham cuma untuk sektor. Best-effort: gagal di tengah -> Map
// parsial (lebih baik daripada kosong total).
export async function getIdxSectorMap({ pageSize = 100, maxPages = 20 } = {}) {
  const map = new Map();
  let start = 0;

  for (let page = 0; page < maxPages; page++) {
    const { rows, recordsTotal } = await getListedCompaniesPage({ start, length: pageSize });

    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const kode = row.KodeEmiten;
      if (!kode) continue;
      map.set(kode, {
        sector: row.Sektor || "Lainnya",
        subSector: row.SubSektor || null
      });
    }

    start += pageSize;
    if (map.size >= recordsTotal || rows.length < pageSize) break;
  }

  return map;
}

// ==========================
// IDX stock-summary (list SEMUA emiten, dipaginate) — dipakai untuk
// membangun universe otomatis, lihat api/universe-refresh.js
// ==========================
async function getIdxStockSummaryPage({ start = 0, length = 100 } = {}) {
  const json = await tryFetchJson(
    `/finance:idx/stock-summary?length=${length}&start=${start}`
  );

  // Sama seperti /finance:idx/companies (lihat getListedCompaniesPage) —
  // response nested dua level: { data: { recordsTotal, data: [...] } }.
  // Field per-baris (StockCode/Close/Value/ListedShares) BELUM
  // dikonfirmasi lewat "Try it" — kalau nama field aslinya beda,
  // universe-refresh.js perlu disesuaikan juga (lihat validRows di sana).
  const rows = Array.isArray(json?.data?.data) ? json.data.data : [];
  const recordsTotal = Number(json?.data?.recordsTotal ?? rows.length);

  return { rows, recordsTotal: Number.isFinite(recordsTotal) ? recordsTotal : rows.length };
}

// Loop pagination sampai semua baris (~959 emiten IDX) terkumpul.
// Best-effort: kalau satu halaman gagal/kosong di tengah jalan, berhenti
// dan kembalikan apa yang sudah terkumpul — TIDAK throw, supaya cron
// universe-refresh tetap bisa jalan dengan universe parsial daripada
// gagal total.
export async function getAllIdxStockSummary({ pageSize = 100, maxPages = 20 } = {}) {
  let all = [];
  let start = 0;

  for (let page = 0; page < maxPages; page++) {
    const { rows, recordsTotal } = await getIdxStockSummaryPage({ start, length: pageSize });

    if (!rows || rows.length === 0) break;

    all = all.concat(rows);
    start += pageSize;

    if (all.length >= recordsTotal || rows.length < pageSize) break;
  }

  return all;
}

// ==========================
// Intraday peak time — HARI INI SAJA (lihat catatan keterbatasan di atas)
// ==========================
// targetDateWIB dicek oleh caller SEBELUM manggil fungsi ini (harus
// sama dengan tanggal hari ini WIB) — fungsi ini sendiri tidak
// memvalidasi itu supaya tetap simpel & mudah dites terpisah.
export async function getZapiIntradayPeakToday(kode) {
  const json = await tryFetchJson(
    `/finance:stockbit/chart?symbol=${encodeURIComponent(kode)}` +
      `&market=indonesia&timeframe=today&interval=intraday`
  );

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
