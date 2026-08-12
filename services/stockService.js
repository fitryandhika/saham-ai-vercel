// ==========================
// Stock Data Service
// ==========================
//
// PRIORITAS SUMBER DATA
//
// DAILY / HISTORICAL
//   1. IDX Official untuk candle terbaru jika tersedia
//   2. Yahoo Finance untuk historical daily
//
// REALTIME / INTRADAY HARI BERJALAN
//   1. ZAPI Stockbit
//   2. Yahoo Finance 15m fallback
//
// PENTING:
// ZAPI yang tersedia saat ini melalui zapiService.js adalah
// getZapiIntradayPeakToday(), yaitu data intraday hari berjalan.
// Jangan menggunakan data peak ZAPI untuk membuat daily OHLCV,
// karena peak saja tidak cukup untuk membentuk open/close/volume.
//
// Strategi:
//   BUY SORE -> SELL PAGI
//
// ============================================================

import { getOfficialTodayData } from "./idxService.js";

import {
  getZapiIntradayPeakToday
} from "./zapiService.js";

import {
  todayWIB
} from "../config/tradingCalendar.js";

// ============================================================
// CONSTANT
// ============================================================

const YAHOO_BASE_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart";

const ZAPI_TIMEOUT_MS = 8000;
const YAHOO_TIMEOUT_MS = 10000;
const IDX_TIMEOUT_MS = 10000;

// ============================================================
// GENERIC FETCH WITH TIMEOUT
// ============================================================

async function fetchJsonWithTimeout(
  url,
  {
    timeout = 10000,
    headers = {}
  } = {}
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return await response.json();

  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// DATE HELPERS
// ============================================================

function dateOnly(value) {
  if (!value) return null;

  return String(value)
    .slice(0, 10);
}

function isValidDateString(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const d =
    new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === value
  );
}

// ============================================================
// NUMERIC HELPERS
// ============================================================

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function validOHLCV(candle) {
  return (
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume)
  );
}

// ============================================================
// NORMALIZE CANDLE
// ============================================================

function normalizeCandle({
  date,
  open,
  high,
  low,
  close,
  volume,
  source
}) {
  const candle = {
    date: dateOnly(date),

    open: toNumber(open),
    high: toNumber(high),
    low: toNumber(low),
    close: toNumber(close),
    volume: toNumber(volume),

    source:
      source || "UNKNOWN"
  };

  if (
    !candle.date ||
    !isValidDateString(candle.date)
  ) {
    return null;
  }

  if (!validOHLCV(candle)) {
    return null;
  }

  return candle;
}

// ============================================================
// SOURCE PRIORITY
// ============================================================
//
// Untuk daily candle:
//
// IDX_OFFICIAL > YAHOO
//
// ZAPI intraday TIDAK dimasukkan ke merge daily,
// karena struktur datanya berbeda.
//
// ============================================================

function sourcePriority(source) {
  switch (source) {

    case "IDX_OFFICIAL":
      return 2;

    case "YAHOO":
      return 1;

    default:
      return 0;
  }
}

// ============================================================
// MERGE CANDLES
// ============================================================

function mergeCandles(...arrays) {

  const map = new Map();

  for (const arr of arrays) {

    if (!Array.isArray(arr)) {
      continue;
    }

    for (const candle of arr) {

      if (!candle) {
        continue;
      }

      const existing =
        map.get(candle.date);

      if (!existing) {

        map.set(
          candle.date,
          candle
        );

        continue;
      }

      if (
        sourcePriority(
          candle.source
        ) >
        sourcePriority(
          existing.source
        )
      ) {
        map.set(
          candle.date,
          candle
        );
      }
    }
  }

  return Array.from(
    map.values()
  ).sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      )
  );
}

// ============================================================
// YAHOO DAILY
// ============================================================

async function getYahooDailyCandles(
  kode,
  range = "6mo"
) {

  const symbol =
    `${kode.toUpperCase()}.JK`;

  const url =
    `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}` +
    `?range=${encodeURIComponent(range)}` +
    `&interval=1d` +
    `&events=history` +
    `&includeAdjustedClose=true`;

  const json =
    await fetchJsonWithTimeout(
      url,
      {
        timeout:
          YAHOO_TIMEOUT_MS,

        headers: {
          Accept:
            "application/json"
        }
      }
    );

  const result =
    json?.chart?.result?.[0];

  if (!result) {

    const message =
      json?.chart?.error?.description ||
      `Data Yahoo ${kode} tidak ditemukan.`;

    throw new Error(message);
  }

  const timestamps =
    result.timestamp || [];

  const quote =
    result
      .indicators
      ?.quote?.[0];

  if (
    !Array.isArray(timestamps) ||
    !quote
  ) {
    throw new Error(
      `Struktur data Yahoo ${kode} tidak valid.`
    );
  }

  const candles = [];

  for (
    let i = 0;
    i < timestamps.length;
    i++
  ) {

    const timestamp =
      Number(
        timestamps[i]
      );

    if (
      !Number.isFinite(timestamp)
    ) {
      continue;
    }

    // Yahoo daily timestamp adalah UTC.
    // Untuk daily IDX, penggunaan UTC date aman
    // karena timestamp candle harian tidak melewati
    // batas tanggal WIB secara problematis.
    const date =
      new Date(
        timestamp * 1000
      )
        .toISOString()
        .slice(0, 10);

    const candle =
      normalizeCandle({

        date,

        open:
          quote.open?.[i],

        high:
          quote.high?.[i],

        low:
          quote.low?.[i],

        close:
          quote.close?.[i],

        volume:
          quote.volume?.[i],

        source:
          "YAHOO"
      });

    if (candle) {
      candles.push(candle);
    }
  }

  if (
    candles.length === 0
  ) {
    throw new Error(
      `Yahoo tidak memiliki candle valid untuk ${kode}.`
    );
  }

  return candles;
}

// ============================================================
// IDX OFFICIAL LATEST CANDLE
// ============================================================
//
// getOfficialTodayData() saat ini digunakan sebagai
// sumber candle terbaru jika tersedia.
//
// Tidak dipakai sebagai historical provider.
//
// ============================================================

async function getIdxOfficialLatestCandle(
  kode
) {

  try {

    const official =
      await Promise.race([

        getOfficialTodayData(
          kode
        ),

        new Promise(
          (_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "IDX timeout"
                  )
                ),
              IDX_TIMEOUT_MS
            )
        )

      ]);

    if (!official) {
      return null;
    }

    return normalizeCandle({

      date:
        official.date,

      open:
        official.open,

      high:
        official.high,

      low:
        official.low,

      close:
        official.close,

      volume:
        official.volume,

      source:
        "IDX_OFFICIAL"
    });

  } catch (e) {

    console.error(
      `IDX official ${kode} gagal:`,
      e?.message ||
        String(e)
    );

    return null;
  }
}

// ============================================================
// GET STOCK DATA
// ============================================================
//
// Fungsi utama untuk analyzer dan labeling.
//
// Daily candle:
//   Yahoo historical
//   + IDX latest jika tersedia
//
// Intraday:
//   tidak dicampurkan ke candles daily.
//
// Ini penting supaya analyzer tidak mendapatkan candle
// dengan timeframe campuran.
//
// ============================================================

export async function getStockData(
  kode,
  range = "6mo"
) {

  if (!kode) {
    throw new Error(
      "Kode saham wajib diisi."
    );
  }

  const normalizedKode =
    String(kode)
      .trim()
      .toUpperCase();

  if (!normalizedKode) {
    throw new Error(
      "Kode saham tidak valid."
    );
  }

  // ==========================================================
  // YAHOO DAILY
  // ==========================================================

  let yahooCandles = [];

  try {

    yahooCandles =
      await getYahooDailyCandles(
        normalizedKode,
        range
      );

  } catch (e) {

    console.error(
      `Yahoo ${normalizedKode} gagal:`,
      e?.message ||
        String(e)
    );
  }

  // ==========================================================
  // IDX LATEST
  // ==========================================================

  let idxCandle = null;

  if (
    range === "6mo" ||
    range === "3mo" ||
    range === "1mo" ||
    range === "1y" ||
    range === "max"
  ) {

    idxCandle =
      await getIdxOfficialLatestCandle(
        normalizedKode
      );
  }

  // ==========================================================
  // MERGE
  // ==========================================================

  const candles =
    mergeCandles(

      yahooCandles,

      idxCandle
        ? [idxCandle]
        : []

    );

  // ==========================================================
  // NO DATA
  // ==========================================================

  if (
    candles.length === 0
  ) {

    throw new Error(
      `Tidak ada data candle valid untuk ${normalizedKode}.`
    );
  }

  // ==========================================================
  // SOURCE
  // ==========================================================

  const latestCandle =
    candles[
      candles.length - 1
    ];

  const latestSource =
    latestCandle?.source ||
    "UNKNOWN";

  // Historical data source tetap
  // mengikuti candle terbaru yang
  // benar-benar digunakan.

  const priceSource =
    latestSource;

  return {

    kode:
      normalizedKode,

    candles,

    closePrices:
      candles.map(
        c => c.close
      ),

    volumes:
      candles.map(
        c => c.volume
      ),

    priceSource,

    latestSource,

    latestDate:
      latestCandle?.date ||
      null
  };
}

// ============================================================
// FIND TRADING DAY CANDLE AFTER
// ============================================================
//
// Mencari candle trading pertama
// setelah scanDate.
//
// TIDAK PERNAH menggunakan:
//   candles.at(-1)
//
// karena candle terakhir bisa merupakan
// tanggal yang jauh lebih baru.
//
// ============================================================

export function findTradingDayCandleAfter(
  candles,
  scanDate
) {

  if (
    !Array.isArray(candles) ||
    candles.length === 0
  ) {
    return null;
  }

  if (!scanDate) {
    return null;
  }

  const targetDate =
    dateOnly(scanDate);

  if (
    !targetDate ||
    !isValidDateString(
      targetDate
    )
  ) {
    return null;
  }

  const sorted =
    [...candles]

      .filter(
        candle =>
          candle &&
          candle.date &&
          isValidDateString(
            dateOnly(
              candle.date
            )
          )
      )

      .sort(
        (a, b) =>
          dateOnly(a.date)
            .localeCompare(
              dateOnly(b.date)
            )
      );

  for (
    const candle of sorted
  ) {

    const candleDate =
      dateOnly(
        candle.date
      );

    if (
      candleDate >
      targetDate
    ) {

      return candle;
    }
  }

  return null;
}

// ============================================================
// GET ZAPI INTRADAY PEAK
// ============================================================
//
// ZAPI adalah PRIORITAS untuk:
//
//   targetDateWIB === hari ini
//
// Jika ZAPI berhasil:
//   return ZAPI
//
// Jika ZAPI gagal:
//   lanjut Yahoo 15m
//
// ============================================================

async function getZapiPeakWithTimeout(
  kode
) {

  return Promise.race([

    getZapiIntradayPeakToday(
      kode
    ),

    new Promise(
      (_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "ZAPI timeout"
              )
            ),
          ZAPI_TIMEOUT_MS
        )
    )

  ]);
}

// ============================================================
// GET YAHOO INTRADAY PEAK
// ============================================================

async function getYahooIntradayPeak(
  kode,
  targetDateWIB,
  {
    range = "5d",
    interval = "15m"
  } = {}
) {

  const symbol =
    `${kode.toUpperCase()}.JK`;

  const url =
    `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}` +
    `?range=${encodeURIComponent(range)}` +
    `&interval=${encodeURIComponent(interval)}`;

  const json =
    await fetchJsonWithTimeout(
      url,
      {
        timeout:
          YAHOO_TIMEOUT_MS,

        headers: {
          Accept:
            "application/json"
        }
      }
    );

  const result =
    json?.chart?.result?.[0];

  if (!result) {
    return null;
  }

  const timestamps =
    result.timestamp || [];

  const quote =
    result
      .indicators
      ?.quote?.[0];

  if (
    !Array.isArray(
      timestamps
    ) ||
    !quote
  ) {
    return null;
  }

  let peakHigh = null;
  let peakTs = null;

  for (
    let i = 0;
    i < timestamps.length;
    i++
  ) {

    const timestamp =
      Number(
        timestamps[i]
      );

    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      continue;
    }

    const high =
      Number(
        quote.high?.[i]
      );

    if (
      !Number.isFinite(
        high
      )
    ) {
      continue;
    }

    // Yahoo timestamp = UTC.
    // Tambahkan 7 jam untuk WIB.
    const wib =
      new Date(
        (
          timestamp +
          7 * 3600
        ) * 1000
      );

    const dateWIB =
      wib
        .toISOString()
        .slice(0, 10);

    if (
      dateWIB !==
      targetDateWIB
    ) {
      continue;
    }

    if (
      peakHigh === null ||
      high > peakHigh
    ) {

      peakHigh =
        high;

      peakTs =
        timestamp;
    }
  }

  if (
    peakTs === null
  ) {
    return null;
  }

  const wib =
    new Date(
      (
        peakTs +
        7 * 3600
      ) * 1000
    );

  const hh =
    String(
      wib.getUTCHours()
    ).padStart(
      2,
      "0"
    );

  const mm =
    String(
      wib.getUTCMinutes()
    ).padStart(
      2,
      "0"
    );

  const peakTimeWIB =
    `${hh}:${mm}`;

  return {

    peakTimeWIB,

    peakHigh,

    peakSessionPhase:
      classifySessionPhase(
        peakTimeWIB
      ),

    source:
      "YAHOO_INTRADAY_15M"
  };
}

// ============================================================
// GET INTRADAY PEAK TIME
// ============================================================
//
// PRIORITAS:
//
// 1. ZAPI jika target = hari ini
// 2. Yahoo 15m fallback
//
// Untuk tanggal historis:
//   langsung Yahoo.
//
// Ini penting karena ZAPI yang tersedia
// sekarang hanya endpoint hari berjalan.
//
// ============================================================

export async function getIntradayPeakTime(
  kode,
  targetDateWIB,
  {
    range = "5d",
    interval = "15m"
  } = {}
) {

  if (
    !kode ||
    !targetDateWIB
  ) {
    return null;
  }

  const normalizedKode =
    String(kode)
      .trim()
      .toUpperCase();

  // ==========================================================
  // ZAPI — PRIORITAS
  // ==========================================================

  if (
    targetDateWIB ===
    todayWIB()
  ) {

    try {

      const zapiPeak =
        await getZapiPeakWithTimeout(
          normalizedKode
        );

      if (
        zapiPeak
      ) {

        const peakTime =
          zapiPeak.peakTimeWIB ||
          zapiPeak.time ||
          null;

        const peakHigh =
          toNumber(
            zapiPeak.peakHigh ??
            zapiPeak.price ??
            null
          );

        if (
          peakTime &&
          Number.isFinite(
            peakHigh
          )
        ) {

          return {

            peakTimeWIB:
              peakTime,

            peakHigh,

            peakSessionPhase:
              classifySessionPhase(
                peakTime
              ),

            source:
              zapiPeak.source ||
              "ZAPI_STOCKBIT_INTRADAY"
          };
        }

        console.warn(
          `ZAPI ${normalizedKode} response tidak lengkap, fallback Yahoo.`
        );
      }

    } catch (e) {

      console.error(
        `ZAPI intraday ${normalizedKode} gagal, fallback Yahoo:`,
        e?.message ||
          String(e)
      );
    }
  }

  // ==========================================================
  // YAHOO FALLBACK
  // ==========================================================

  try {

    return await getYahooIntradayPeak(
      normalizedKode,
      targetDateWIB,
      {
        range,
        interval
      }
    );

  } catch (e) {

    console.error(
      `Yahoo intraday ${normalizedKode} gagal:`,
      e?.message ||
        String(e)
    );

    return null;
  }
}

// ============================================================
// SESSION PHASE
// ============================================================
//
// Perkiraan sesi reguler IDX dalam WIB.
//
// ============================================================

export function classifySessionPhase(
  hhmm
) {

  if (
    typeof hhmm !==
    "string"
  ) {
    return "UNKNOWN";
  }

  const parts =
    hhmm
      .split(":")
      .map(Number);

  if (
    parts.length !== 2 ||
    !Number.isFinite(parts[0]) ||
    !Number.isFinite(parts[1])
  ) {
    return "UNKNOWN";
  }

  const h =
    parts[0];

  const m =
    parts[1];

  if (
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  ) {
    return "UNKNOWN";
  }

  const minutes =
    h * 60 + m;

  // ----------------------------------------------------------
  // SEBELUM PASAR
  // ----------------------------------------------------------

  if (
    minutes < 9 * 60
  ) {
    return "SEBELUM_BUKA";
  }

  // ----------------------------------------------------------
  // SESI 1 AWAL
  // ----------------------------------------------------------

  if (
    minutes < 10 * 60
  ) {
    return "SESI1_AWAL";
  }

  // ----------------------------------------------------------
  // SESI 1 AKHIR
  // ----------------------------------------------------------

  if (
    minutes < 11 * 60 + 30
  ) {
    return "SESI1_AKHIR";
  }

  // ----------------------------------------------------------
  // ISTIRAHAT
  // ----------------------------------------------------------

  if (
    minutes < 13 * 60 + 30
  ) {
    return "ISTIRAHAT";
  }

  // ----------------------------------------------------------
  // SESI 2 AWAL
  // ----------------------------------------------------------

  if (
    minutes < 14 * 60 + 30
  ) {
    return "SESI2_AWAL";
  }

  // ----------------------------------------------------------
  // SESI 2 AKHIR
  // ----------------------------------------------------------

  if (
    minutes <= 15 * 60 + 15
  ) {
    return "SESI2_AKHIR";
  }

  return "SETELAH_TUTUP";
}

// ============================================================
// GET TODAY INTRADAY PEAK
// ============================================================
//
// Helper langsung untuk hari berjalan.
//
// ============================================================

export async function getTodayIntradayPeak(
  kode
) {

  return getIntradayPeakTime(
    kode,
    todayWIB(),
    {
      range: "5d",
      interval: "15m"
    }
  );
}