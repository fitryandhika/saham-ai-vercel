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
// Pakai SDK resmi (zpi-sdk, lihat tab "Code examples" > zpi-sdk di
// dashboard zapi.web.id) — bukan fetch manual — supaya auth/header
// selalu ikut versi resmi dan tidak perlu ditebak-tebak formatnya.
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

import { ZpiClient } from "zpi-sdk";

let client = null;

function getClient() {
  if (client) return client;

  const apiKey = process.env.ZAPI_API_KEY;
  if (!apiKey) {
    console.warn("ZAPI_API_KEY belum diset — fitur zapi (fundamental/intraday) nonaktif.");
    return null;
  }

  client = new ZpiClient({ apiKey });
  return client;
}

// ==========================
// Fundamental snapshot (marketCap, PE ratio, sector versi Stockbit)
// ==========================
export async function getZapiFundamentals(kode) {
  const c = getClient();
  if (!c) return null;

  try {
    const raw = await c.run("finance:stockbit:symbol", { symbol: kode });
    // Defensif: SDK bisa saja return langsung isi data, atau masih
    // bungkus { project, data, timestamp } seperti response REST biasa.
    const data = raw?.data ?? raw;
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
  } catch (e) {
    console.error(`getZapiFundamentals(${kode}) gagal:`, e.message);
    return null;
  }
}

// ==========================
// IDX stock-summary (list SEMUA emiten, dipaginate) — dipakai untuk
// membangun universe otomatis, lihat api/universe-refresh.js
// ==========================

// Satu halaman mentah dari endpoint list finance:idx:stock-summary.
// Bentuk responsnya beda dari endpoint stockbit di atas (tidak dibungkus
// {project, data:{...}}) — array baris langsung di properti "data", jadi
// unwrap-nya juga dibikin defensif sendiri di sini.
async function getIdxStockSummaryPage({ start = 0, length = 100 } = {}) {
  const c = getClient();
  if (!c) return { rows: [], recordsTotal: 0 };

  try {
    const raw = await c.run("finance:idx:stock-summary", { start, length });

    const rows = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
      ? raw.data
      : [];

    const recordsTotal = Number(raw?.recordsTotal ?? rows.length);

    return { rows, recordsTotal: Number.isFinite(recordsTotal) ? recordsTotal : rows.length };
  } catch (e) {
    console.error(`getIdxStockSummaryPage(start=${start}) gagal:`, e.message);
    return { rows: [], recordsTotal: 0 };
  }
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
// targetDateWIB dicek oleh caller SEBELUM manggil fungsi ini (harus
// sama dengan tanggal hari ini WIB) — fungsi ini sendiri tidak
// memvalidasi itu supaya tetap simpel & mudah dites terpisah.
export async function getZapiIntradayPeakToday(kode) {
  const c = getClient();
  if (!c) return null;

  try {
    const raw = await c.run("finance:stockbit:chart", {
      symbol: kode,
      market: "indonesia",
      timeframe: "today",
      interval: "intraday"
    });
    const data = raw?.data ?? raw;

    const items = data?.items;
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
  } catch (e) {
    console.error(`getZapiIntradayPeakToday(${kode}) gagal:`, e.message);
    return null;
  }
}
