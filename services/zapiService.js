// ==========================
// zapi.web.id Integration Service
// ==========================
//
// ZAPI digunakan sebagai sumber utama untuk:
//
// 1. DAILY OHLC HISTORIS
//    finance:idx/stock-summary
//
//    Field:
//      OpenPrice
//      High
//      Low
//      Close
//      Volume
//
//    Endpoint mendukung:
//      date=YYYYMMDD
//      code=KODE
//
// 2. FUNDAMENTAL
//    finance:stockbit/symbol
//
// 3. SEKTOR / SUBSEKTOR RESMI IDX
//    finance:idx/companies
//
// 4. UNIVERSE IDX
//    finance:idx/stock-summary
//
// 5. INTRADAY PEAK
//    finance:stockbit/chart
//
// CATATAN PENTING:
// ZAPI DAILY OHLC dan ZAPI INTRADAY adalah dua endpoint berbeda.
//
// DAILY OHLC:
//   finance:idx/stock-summary
//
// INTRADAY:
//   finance:stockbit/chart
//
// Yahoo TIDAK digunakan di file ini sebagai fallback.
// Fallback Yahoo dilakukan oleh stockService.js.
// ==========================

const BASE_URL = "https://api.zpi.web.id/v1";

// ==========================
// AUTH HEADER
// ==========================

function buildHeaders() {
  const apiKey = process.env.ZAPI_API_KEY;

  const headers = {
    Accept: "application/json"
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  return {
    headers,
    hasKey: Boolean(apiKey)
  };
}

// ==========================
// GENERIC FETCH
// ==========================

async function tryFetchJson(path) {
  const { headers, hasKey } = buildHeaders();

  if (!hasKey) {
    console.warn(
      "ZAPI_API_KEY belum diset — fitur ZAPI nonaktif."
    );

    return null;
  }

  try {
    const res = await fetch(
      `${BASE_URL}${path}`,
      {
        method: "GET",
        headers
      }
    );

    if (!res.ok) {
      const text = await res.text();

      console.error(
        `zapiService fetch gagal (${res.status}): ${path}`,
        text
      );

      return null;
    }

    return await res.json();

  } catch (e) {

    console.error(
      `zapiService fetch error: ${path}`,
      e?.message || String(e)
    );

    return null;
  }
}

// ============================================================
// DAILY OHLC — ZAPI IDX STOCK SUMMARY
// ============================================================
//
// INI FUNGSI BARU PALING PENTING.
//
// Mengambil OHLCV satu saham pada tanggal tertentu.
//
// Contoh:
//
// getZapiDailyCandle("TRUK", "2026-08-11")
//
// akan meminta:
//
// /finance:idx/stock-summary
// ?length=20
// &start=0
// &date=20260811
// &code=TRUK
//
// ZAPI menyediakan field:
//   OpenPrice
//   High
//   Low
//   Close
//   Volume
//
// Jika tidak tersedia / gagal:
// return null
//
// Caller (stockService.js) yang bertanggung jawab melakukan
// fallback ke Yahoo.
// ============================================================

function normalizeYYYYMMDD(date) {
  const value = String(date || "").trim();

  if (/^\d{8}$/.test(value)) {
    return value;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.replace(/-/g, "");
  }

  return null;
}

function normalizeISODate(date) {
  const value = String(date || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  if (/^\d{8}$/.test(value)) {
    return (
      `${value.slice(0, 4)}-` +
      `${value.slice(4, 6)}-` +
      `${value.slice(6, 8)}`
    );
  }

  return null;
}

export async function getZapiDailyCandle(
  kode,
  targetDate
) {

  const code = String(kode || "")
    .trim()
    .toUpperCase();

  if (!code) {
    return null;
  }

  const dateYYYYMMDD =
    normalizeYYYYMMDD(targetDate);

  if (!dateYYYYMMDD) {
    console.error(
      `getZapiDailyCandle: tanggal tidak valid: ${targetDate}`
    );

    return null;
  }

  const json = await tryFetchJson(
    `/finance:idx/stock-summary` +
    `?length=20` +
    `&start=0` +
    `&date=${dateYYYYMMDD}` +
    `&code=${encodeURIComponent(code)}`
  );

  if (!json) {
    return null;
  }

  // ----------------------------------------------------------
  // Response normal:
  //
  // {
  //   data: [
  //     {
  //       StockCode: "TRUK",
  //       OpenPrice: 805,
  //       High: 805,
  //       Low: 805,
  //       Close: 805,
  //       Volume: ...
  //     }
  //   ]
  // }
  //
  // Beberapa endpoint lama / wrapper bisa mengembalikan
  // struktur nested. Kita support keduanya.
  // ----------------------------------------------------------

  let rows = [];

  if (Array.isArray(json.data)) {
    rows = json.data;
  } else if (
    Array.isArray(json.data?.data)
  ) {
    rows = json.data.data;
  } else if (
    Array.isArray(json.results)
  ) {
    rows = json.results;
  }

  if (rows.length === 0) {
    console.warn(
      `ZAPI daily candle kosong: ${code} ${dateYYYYMMDD}`
    );

    return null;
  }

  // ----------------------------------------------------------
  // Cari kode yang benar.
  // Walaupun query sudah memakai code=, tetap validasi.
  // ----------------------------------------------------------

  const row =
    rows.find((item) => {

      const itemCode = String(
        item.StockCode ??
        item.Code ??
        item.stock_code ??
        item.kode ??
        ""
      )
        .trim()
        .toUpperCase();

      return itemCode === code;

    }) || rows[0];

  if (!row) {
    return null;
  }

  // ----------------------------------------------------------
  // Ambil tanggal dari response.
  // ----------------------------------------------------------

  const responseDate =
    normalizeISODate(
      row.Date ??
      row.date ??
      dateYYYYMMDD
    );

  // ----------------------------------------------------------
  // Ambil OHLCV.
  // ----------------------------------------------------------

  const open = Number(
    row.OpenPrice ??
    row.Open ??
    row.open_price ??
    row.open
  );

  const high = Number(
    row.High ??
    row.high
  );

  const low = Number(
    row.Low ??
    row.low
  );

  const close = Number(
    row.Close ??
    row.close
  );

  const volume = Number(
    row.Volume ??
    row.volume
  );

  // ----------------------------------------------------------
  // VALIDASI KERAS
  //
  // Jangan pernah mengembalikan candle kalau OHLC tidak valid.
  // Dengan begitu stockService.js boleh dengan aman fallback
  // ke Yahoo.
  // ----------------------------------------------------------

  if (
    !responseDate ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume)
  ) {

    console.warn(
      `ZAPI daily candle tidak lengkap: ${code} ${dateYYYYMMDD}`,
      {
        responseDate,
        open,
        high,
        low,
        close,
        volume
      }
    );

    return null;
  }

  if (
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    volume < 0
  ) {

    console.warn(
      `ZAPI daily candle nilai tidak valid: ${code} ${dateYYYYMMDD}`,
      {
        open,
        high,
        low,
        close,
        volume
      }
    );

    return null;
  }

  // ----------------------------------------------------------
  // Validasi hubungan harga dasar.
  // ----------------------------------------------------------

  if (
    high < low ||
    high < open ||
    high < close ||
    low > open ||
    low > close
  ) {

    console.warn(
      `ZAPI daily candle OHLC tidak konsisten: ${code} ${dateYYYYMMDD}`,
      {
        open,
        high,
        low,
        close
      }
    );

    return null;
  }

  // ----------------------------------------------------------
  // HASIL FINAL
  // ----------------------------------------------------------

  return {
    date: responseDate,

    open,
    high,
    low,
    close,
    volume,

    source: "ZAPI_IDX_DAILY",

    provider: "IDX",

    kode: code
  };
}

// ============================================================
// DAILY OHLC TERBARU
// ============================================================
//
// Digunakan jika caller hanya ingin hari bursa terbaru.
//
// Mencoba beberapa hari kalender ke belakang.
// Weekend otomatis terlewati.
//
// FUNGSI INI TIDAK DIPAKAI UNTUK H+1 jika target tanggal sudah
// diketahui. Untuk labeling H+1, gunakan getZapiDailyCandle()
// dengan tanggal target secara eksplisit.
// ============================================================

export async function getZapiLatestDailyCandle(
  kode,
  daysBack = 5
) {

  const now = new Date();

  for (
    let i = 0;
    i <= daysBack;
    i++
  ) {

    const d = new Date(now);

    d.setDate(
      d.getDate() - i
    );

    const day =
      d.getDay();

    // Minggu / Sabtu
    if (
      day === 0 ||
      day === 6
    ) {
      continue;
    }

    const yyyy =
      d.getFullYear();

    const mm =
      String(
        d.getMonth() + 1
      ).padStart(2, "0");

    const dd =
      String(
        d.getDate()
      ).padStart(2, "0");

    const date =
      `${yyyy}-${mm}-${dd}`;

    const candle =
      await getZapiDailyCandle(
        kode,
        date
      );

    if (candle) {
      return candle;
    }
  }

  return null;
}

// ============================================================
// FUNDAMENTAL SNAPSHOT
// ============================================================
//
// marketCap
// PE ratio
// sector
// subSector
// marketStatus
// bestBid
// bestOffer
// ============================================================

export async function getZapiFundamentals(kode) {

  const code =
    String(kode || "")
      .trim()
      .toUpperCase();

  if (!code) {
    return null;
  }

  const json =
    await tryFetchJson(
      `/finance:stockbit/symbol?symbol=${encodeURIComponent(code)}`
    );

  const data =
    json?.data;

  if (!data) {
    return null;
  }

  const marketCap =
    Number(data.marketCap);

  const peRatio =
    Number(data.peRatio);

  return {

    marketCap:
      Number.isFinite(marketCap)
        ? marketCap
        : null,

    peRatio:
      Number.isFinite(peRatio)
        ? peRatio
        : null,

    sector:
      data.sector ??
      null,

    subSector:
      data.subSector ??
      null,

    marketStatus:
      data.marketStatus ??
      null,

    bestBid:
      data.bestBid ??
      null,

    bestOffer:
      data.bestOffer ??
      null
  };
}

// ============================================================
// IDX LISTED COMPANIES
// ============================================================

async function getListedCompaniesPage({
  start = 0,
  length = 100
} = {}) {

  const json =
    await tryFetchJson(
      `/finance:idx/companies` +
      `?length=${length}` +
      `&start=${start}`
    );

  let rows = [];

  if (
    Array.isArray(json?.data?.data)
  ) {
    rows = json.data.data;
  } else if (
    Array.isArray(json?.data)
  ) {
    rows = json.data;
  }

  const recordsTotal =
    Number(
      json?.data?.recordsTotal ??
      json?.recordsTotal ??
      rows.length
    );

  return {
    rows,
    recordsTotal:
      Number.isFinite(recordsTotal)
        ? recordsTotal
        : rows.length
  };
}

// ============================================================
// SECTOR MAP
// ============================================================

export async function getIdxSectorMap({
  pageSize = 100,
  maxPages = 20
} = {}) {

  const map =
    new Map();

  let start = 0;

  for (
    let page = 0;
    page < maxPages;
    page++
  ) {

    const {
      rows,
      recordsTotal
    } =
      await getListedCompaniesPage({
        start,
        length: pageSize
      });

    if (
      !rows ||
      rows.length === 0
    ) {
      break;
    }

    for (const row of rows) {

      const kode =
        String(
          row.KodeEmiten ??
          row.StockCode ??
          row.Code ??
          ""
        )
          .trim()
          .toUpperCase();

      if (!kode) {
        continue;
      }

      map.set(
        kode,
        {
          sector:
            row.Sektor ||
            "Lainnya",

          subSector:
            row.SubSektor ||
            null
        }
      );
    }

    start += pageSize;

    if (
      map.size >= recordsTotal ||
      rows.length < pageSize
    ) {
      break;
    }
  }

  return map;
}

// ============================================================
// IDX STOCK SUMMARY — SEMUA EMITEN
// ============================================================

async function getIdxStockSummaryPage({
  start = 0,
  length = 100,
  date
} = {}) {

  let path =
    `/finance:idx/stock-summary` +
    `?length=${length}` +
    `&start=${start}`;

  if (date) {

    const dateYYYYMMDD =
      normalizeYYYYMMDD(date);

    if (dateYYYYMMDD) {
      path +=
        `&date=${dateYYYYMMDD}`;
    }
  }

  const json =
    await tryFetchJson(path);

  let rows = [];

  if (
    Array.isArray(json?.data?.data)
  ) {
    rows = json.data.data;
  } else if (
    Array.isArray(json?.data)
  ) {
    rows = json.data;
  }

  const recordsTotal =
    Number(
      json?.data?.recordsTotal ??
      json?.recordsTotal ??
      rows.length
    );

  return {
    rows,
    recordsTotal:
      Number.isFinite(recordsTotal)
        ? recordsTotal
        : rows.length
  };
}

// ============================================================
// GET ALL IDX STOCK SUMMARY
// ============================================================

export async function getAllIdxStockSummary({
  pageSize = 100,
  maxPages = 20,
  date
} = {}) {

  let all = [];

  let start = 0;

  for (
    let page = 0;
    page < maxPages;
    page++
  ) {

    const {
      rows,
      recordsTotal
    } =
      await getIdxStockSummaryPage({
        start,
        length: pageSize,
        date
      });

    if (
      !rows ||
      rows.length === 0
    ) {
      break;
    }

    all =
      all.concat(rows);

    start += pageSize;

    if (
      all.length >= recordsTotal ||
      rows.length < pageSize
    ) {
      break;
    }
  }

  return all;
}

// ============================================================
// INTRADAY PEAK — HARI INI
// ============================================================
//
// Ini TETAP menggunakan Stockbit/ZAPI intraday.
//
// Berbeda dengan daily OHLC.
//
// Dipakai oleh stockService.js untuk mencari:
//
// peakTimeWIB
// peakHigh
// ============================================================

// ============================================================
// INTRADAY TICKS — HARI INI (SELURUH SERI, BUKAN CUMA PEAK)
// ============================================================
//
// TAHAP 1 — REALTIME / INTRADAY OHLCV.
//
// Dipakai oleh services/realtimeIntradayService.js untuk
// membangun candle OHLCV 1 menit. Endpoint & parsing sama
// dengan getZapiIntradayPeakToday() di bawah, tapi fungsi ini
// mengembalikan SELURUH tick (harga + waktu + volume kalau
// ada), bukan cuma titik tertinggi.
// ============================================================

export async function getZapiIntradayTicks(kode) {

  const code =
    String(kode || "")
      .trim()
      .toUpperCase();

  if (!code) {
    return null;
  }

  const json =
    await tryFetchJson(
      `/finance:stockbit/chart` +
      `?symbol=${encodeURIComponent(code)}` +
      `&market=indonesia` +
      `&timeframe=today` +
      `&interval=intraday`
    );

  const items =
    json?.data?.items;

  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return null;
  }

  const ticks = [];

  for (const item of items) {

    const price =
      Number(item.price);

    if (
      !Number.isFinite(price)
    ) {
      continue;
    }

    const match =
      String(item.time || "")
        .match(/(\d{2}):(\d{2})/);

    if (!match) {
      continue;
    }

    const volumeRaw =
      Number(
        item.volume ??
        item.vol ??
        0
      );

    ticks.push({
      timeWIB:
        `${match[1]}:${match[2]}`,
      price,
      volume:
        Number.isFinite(volumeRaw)
          ? volumeRaw
          : 0
    });
  }

  if (ticks.length === 0) {
    return null;
  }

  ticks.sort(
    (a, b) =>
      a.timeWIB.localeCompare(
        b.timeWIB
      )
  );

  return {
    ticks,
    source: "ZAPI_STOCKBIT_INTRADAY"
  };
}

export async function getZapiIntradayPeakToday(kode) {

  const code =
    String(kode || "")
      .trim()
      .toUpperCase();

  if (!code) {
    return null;
  }

  const json =
    await tryFetchJson(
      `/finance:stockbit/chart` +
      `?symbol=${encodeURIComponent(code)}` +
      `&market=indonesia` +
      `&timeframe=today` +
      `&interval=intraday`
    );

  const items =
    json?.data?.items;

  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return null;
  }

  let peakItem = null;

  for (
    const item of items
  ) {

    const price =
      Number(item.price);

    if (
      !Number.isFinite(price)
    ) {
      continue;
    }

    if (
      !peakItem ||
      price > peakItem.price
    ) {

      peakItem = {
        price,
        time: item.time
      };
    }
  }

  if (
    !peakItem ||
    !peakItem.time
  ) {
    return null;
  }

  const match =
    String(
      peakItem.time
    ).match(
      /(\d{2}):(\d{2})/
    );

  if (!match) {
    return null;
  }

  const peakTimeWIB =
    `${match[1]}:${match[2]}`;

  return {

    peakTimeWIB,

    peakHigh:
      peakItem.price,

    source:
      "ZAPI_STOCKBIT_INTRADAY"
  };
}

// ============================================================
// RAW DEBUG — BUKAN UNTUK PRODUKSI
// ============================================================
//
// Dipakai lewat /api/health?debugzapi=KODE untuk melihat JSON
// mentah dari DUA endpoint ZAPI sekaligus, tanpa diolah:
//
//   1. finance:stockbit/chart (timeframe=today)  -> sumber
//      candle intraday yang dipakai realtimeIntradayService.js
//      sekarang.
//   2. finance:stockbit/symbol -> ada field bestBid/bestOffer/
//      marketStatus; kemungkinan berisi harga live yang lebih
//      segar daripada chart, tapi belum pernah dicek field
//      timestamp-nya secara langsung.
//
// Tujuannya murni diagnostik: membandingkan "seberapa segar"
// tiap endpoint, supaya kita tahu apakah perlu pindah sumber
// untuk data yang benar-benar realtime.
// ============================================================

export async function getZapiRawDebug(kode) {

  const code =
    String(kode || "")
      .trim()
      .toUpperCase();

  if (!code) {
    return null;
  }

  const [chartJson, symbolJson] =
    await Promise.all([

      tryFetchJson(
        `/finance:stockbit/chart` +
        `?symbol=${encodeURIComponent(code)}` +
        `&market=indonesia` +
        `&timeframe=today` +
        `&interval=intraday`
      ),

      tryFetchJson(
        `/finance:stockbit/symbol` +
        `?symbol=${encodeURIComponent(code)}`
      )

    ]);

  return {
    kode: code,
    fetchedAtServerUTC:
      new Date().toISOString(),
    chartToday: chartJson,
    symbol: symbolJson
  };
}