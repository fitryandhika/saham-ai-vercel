// ==========================
// Macro Fetch Service — FRED + Yahoo Finance
// ==========================
//
// Sumber data:
//   - FRED (Federal Reserve Economic Data): Fed Funds Rate, US Treasury
//     yield 10Y & 2Y. Gratis, butuh API key gratis dari
//     https://fred.stlouisfed.org/docs/api/api_key.html — set sebagai
//     env var FRED_API_KEY di Vercel.
//   - Yahoo Finance (pola sama seperti services/marketService.js): DXY,
//     USD/IDR.
//
// CATATAN JUJUR soal cakupan v1:
//   - BI Rate: BI tidak punya API publik resmi yang stabil, jadi field
//     ini tetap null di sini. Update manual via kolom bi_rate di tabel
//     macro_snapshot (Supabase Table Editor), biasanya cuma berubah
//     tiap Rapat Dewan Gubernur (bulanan).
//   - Foreign net flow IDX: juga tidak ada API gratis resmi (perlu
//     scraping IDX/RTI yang gampang berubah struktur HTML-nya). Field
//     ini nullable, sengaja tidak dipaksakan lewat scraping rapuh —
//     bisa diisi manual, atau ditambahkan belakangan kalau sudah ada
//     sumber API resmi.
// Ini TIDAK menghalangi regime classification jalan — engine/marketRegime.js
// tetap menghitung dari field yang tersedia (yield spread, DXY, IHSG).

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

async function getFredLatest(seriesId) {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    console.warn(`FRED_API_KEY belum diset — ${seriesId} dilewati.`);
    return null;
  }

  try {
    const url =
      `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}` +
      `&file_type=json&sort_order=desc&limit=1`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`FRED ${seriesId} gagal (${response.status})`);
    }

    const json = await response.json();
    const obs = json.observations?.[0];

    if (!obs || obs.value === ".") return null; // "." = data belum dirilis

    return Number(obs.value);
  } catch (e) {
    console.error(`getFredLatest(${seriesId}) error:`, e.message);
    return null;
  }
}

async function getYahooLatestClose(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker
    )}?range=5d&interval=1d`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Yahoo ${ticker} gagal (${response.status})`);
    }

    const json = await response.json();
    const result = json.chart.result?.[0];
    if (!result) return null;

    const closes = (result.indicators.quote[0].close || []).filter(
      (c) => c !== null && c !== undefined
    );

    return closes.length ? closes.at(-1) : null;
  } catch (e) {
    console.error(`getYahooLatestClose(${ticker}) error:`, e.message);
    return null;
  }
}

// Ambil semua data makro yang bisa diambil otomatis, dalam satu batch
// paralel. Field yang gagal/tidak tersedia jadi null — TIDAK melempar
// error, supaya satu sumber yang down tidak menggagalkan semuanya.
export async function fetchRawMacroData() {
  const [fedRate, us10y, us2y, dxy, usdidr] = await Promise.all([
    getFredLatest("FEDFUNDS"),
    getFredLatest("DGS10"),
    getFredLatest("DGS2"),
    getYahooLatestClose("DX-Y.NYB"),
    getYahooLatestClose("IDR=X")
  ]);

  const yieldSpread =
    us10y !== null && us2y !== null ? Number((us10y - us2y).toFixed(2)) : null;

  return {
    fed_rate: fedRate,
    bi_rate: null, // manual, lihat catatan di atas
    us10y_yield: us10y,
    us2y_yield: us2y,
    yield_spread_10y2y: yieldSpread,
    dxy_index: dxy,
    usdidr,
    foreign_net_flow_idx: null // manual, lihat catatan di atas
  };
}

export default fetchRawMacroData;
