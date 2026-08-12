// ==========================
// Stock Data Service
// ==========================
//
// PRIORITAS SUMBER DATA
//
// DAILY / HISTORICAL
//   1. IDX Official
//   2. Yahoo Finance
//
// HARI BERJALAN / REALTIME
//   1. ZAPI
//   2. IDX Official
//   3. Yahoo Finance
//
// INTRADAY
//   1. ZAPI Stockbit
//   2. Yahoo Finance 15m
//
// Tujuan utama:
//   - strategi BUY SORE -> SELL PAGI
//   - menjaga historical candle tetap tersedia
//   - menghindari ketergantungan penuh pada Yahoo
//   - mengetahui sumber setiap candle
//
// CATATAN:
// ZAPI intraday yang tersedia saat ini hanya menyediakan data
// hari berjalan. Karena itu ZAPI TIDAK digunakan untuk menggantikan
// historical daily candle.
//
// ==========================

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const d = new Date(`${value}T00:00:00Z`);

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
    source: source || "UNKNOWN"
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
// SORT + DEDUPLICATE CANDLES
// ============================================================
//
// Kalau IDX dan Yahoo sama-sama punya tanggal yang sama,
// sumber yang diprioritaskan akan tetap menang.
//
// sourcePriority:
//   ZAPI = 3
//   IDX  = 2
//   YAHOO = 1
//

function sourcePriority(source) {
  switch (source) {
    case "ZAPI_STOCKBIT":
    case "ZAPI_STOCKBIT_INTRADAY":
      return 3;

    case "IDX_OFFICIAL":
      return 2;

    case "YAHOO":
      return 1;

    default:
      return 0;
  }
}

function mergeCandles(...arrays) {
  const map = new Map();

  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;

    for (const candle of arr) {
      if (!candle) continue;

      const existing =
        map.get(candle.date);

      if (!existing) {
        map.set(candle.date, candle);
        continue;
      }

      if (
        sourcePriority(candle.source) >
        sourcePriority(existing.source)
      ) {
        map.set(candle.date, candle);
      }
    }
  }

  return Array.from(map.values())
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date)
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
    await fetchJsonWithTimeout(url, {
      timeout: YAHOO_TIMEOUT_MS,
      headers: {
        Accept: "application/json"
      }
    });

  const result =
    json?.chart?.result?.[0];

  if (!result) {
    throw new Error(
      `Data Yahoo ${kode} tidak ditemukan.`
    );
  }

  const timestamps =
    result.timestamp || [];

  const quote =
    result.indicators?.quote?.[0];

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
    const date =
      new Date(
        timestamps[i] * 1000
      )
        .toISOString()
        .slice(0, 10);

    const candle =
      normalizeCandle({
        date,
        open: quote.open?.[i],
        high: quote.high?.[i],
        low: quote.low?.[i],
        close: quote.close?.[i],
        volume: quote.volume?.[i],
        source: "YAHOO"
      });

    if (candle) {
      candles.push(candle);
    }
  }

  if (candles.length === 0) {
    throw new Error(
      `Yahoo tidak memiliki candle valid untuk ${kode}.`
    );
  }

  return candles;
}

// ============================================================
// IDX OFFICIAL CANDLE
// ============================================================
//
// getOfficialTodayData() saat ini mengembalikan satu candle
// terbaru yang tersedia dari IDX.
//
// Kita tidak menggunakan IDX sebagai historical provider,
// karena service IDX Anda saat ini memang didesain untuk
// data terbaru yang tersedia.
//

async function getIdxOfficialLatestCandle(
  kode
) {
  try {
    const official =
      await Promise.race([
        getOfficialTodayData(kode),

        new Promise((_, reject) =>
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
      date: official.date,
      open: official.open,
      high: official.high,
      low: official.low,
      close: official.close,
      volume: official.volume,
      source: "IDX_OFFICIAL"
    });

  } catch (e) {

    console.error(
      `IDX official ${kode} gagal:`,
      e.message
    );

    return null;
  }
}

// ============================================================
// GET STOCK DATA
// ============================================================
//
// Ini fungsi utama yang dipakai analyzer / labeling.
//
// PRIORITAS:
//
// Historical:
//   Yahoo menyediakan seluruh history.
//   IDX hanya dipakai untuk mengganti/menambahkan candle
//   terbaru.
//
// Hari berjalan:
//   IDX Official dipakai jika tersedia.
//
// ZAPI:
//   ZAPI intraday TIDAK digunakan untuk membuat daily candle
//   karena endpoint yang tersedia hanya intraday hari ini.
//
// Jadi:
//   daily candle = IDX + Yahoo
//   realtime intraday = ZAPI
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

  // ----------------------------------------------------------
  // YAHOO
  // ----------------------------------------------------------

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
      e.message
    );
  }

  // ----------------------------------------------------------
  // IDX OFFICIAL
  // ----------------------------------------------------------

  let idxCandle = null;

  //
  // IDX dipanggil untuk range daily yang umum.
  //
  if (
    range === "6mo" ||
    range === "3mo" ||
    range === "1mo" ||
    range === "1y"
  ) {
    idxCandle =
      await getIdxOfficialLatestCandle(
        normalizedKode
      );
  }

  // ----------------------------------------------------------
  // MERGE
  // ----------------------------------------------------------

  const candles =
    mergeCandles(
      yahooCandles,
      idxCandle
        ? [idxCandle]
        : []
    );

  if (candles.length === 0) {
    throw new Error(
      `Tidak ada data candle valid untuk ${normalizedKode}.`
    );
  }

  // ----------------------------------------------------------
  // PRICE SOURCE
  // ----------------------------------------------------------

  let priceSource =
    "YAHOO";

  if (idxCandle) {
    priceSource =
      "IDX_OFFICIAL";
  }

  // ----------------------------------------------------------
  // LATEST CANDLE SOURCE
  // ----------------------------------------------------------

  const latestCandle =
    candles[candles.length - 1];

  const latestSource =
    latestCandle?.source ||
    priceSource;

  return {

    kode: normalizedKode,

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
// FIND TRADING DAY AFTER
// ============================================================
//
// Jangan pernah menggunakan:
// candles.at(-1)
//
// karena candle terakhir belum tentu H+1.
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

  if (!targetDate) {
    return null;
  }

  const sorted =
    [...candles]
      .filter(
        c =>
          c &&
          c.date &&
          isValidDateString(
            dateOnly(c.date)
          )
      )
      .sort(
        (a, b) =>
          dateOnly(a.date)
            .localeCompare(
              dateOnly(b.date)
            )
      );

  for (const candle of sorted) {

    const candleDate =
      dateOnly(candle.date);

    if (
      candleDate > targetDate
    ) {
      return candle;
    }
  }

  return null;
}

// ============================================================
// GET INTRADAY PEAK TIME
// ============================================================
//
// PRIORITAS:
//
// 1. ZAPI — jika target adalah hari ini
// 2. Yahoo 15m — fallback / historical
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

  // ----------------------------------------------------------
  // VALIDASI
  // ----------------------------------------------------------

  if (!kode || !targetDateWIB) {
    return null;
  }

  // ----------------------------------------------------------
  // ZAPI — HARI INI
  // ----------------------------------------------------------

  if (
    targetDateWIB === todayWIB()
  ) {

    try {

      const zapiPeak =
        await Promise.race([
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

      if (zapiPeak) {

        return {

          peakTimeWIB:
            zapiPeak.peakTimeWIB,

          peakHigh:
            zapiPeak.peakHigh,

          peakSessionPhase:
            classifySessionPhase(
              zapiPeak.peakTimeWIB
            ),

          source:
            zapiPeak.source ||
            "ZAPI_STOCKBIT_INTRADAY"

        };
      }

    } catch (e) {

      console.error(
        `ZAPI intraday ${kode} gagal, fallback Yahoo:`,
        e.message
      );
    }
  }

  // ----------------------------------------------------------
  // YAHOO 15 MINUTE
  // ----------------------------------------------------------

  try {

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
      result.indicators
        ?.quote?.[0];

    if (
      !Array.isArray(timestamps) ||
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

      const high =
        Number(
          quote.high?.[i]
        );

      if (
        !Number.isFinite(high)
      ) {
        continue;
      }

      // Yahoo timestamp UTC.
      // Tambahkan 7 jam untuk membaca WIB.
      const wib =
        new Date(
          (timestamps[i] +
            7 * 3600) *
            1000
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

        peakHigh = high;
        peakTs =
          timestamps[i];
      }
    }

    if (
      peakTs === null
    ) {
      return null;
    }

    const wib =
      new Date(
        (peakTs +
          7 * 3600) *
          1000
      );

    const hh =
      String(
        wib.getUTCHours()
      ).padStart(2, "0");

    const mm =
      String(
        wib.getUTCMinutes()
      ).padStart(2, "0");

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

  } catch (e) {

    console.error(
      `getIntradayPeakTime(${kode}) gagal:`,
      e.message
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
    typeof hhmm !== "string"
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

  const [
    h,
    m
  ] = parts;

  const minutes =
    h * 60 + m;

  if (
    minutes < 9 * 60
  ) {
    return "SEBELUM_BUKA";
  }

  if (
    minutes < 10 * 60
  ) {
    return "SESI1_AWAL";
  }

  if (
    minutes < 11 * 60 + 30
  ) {
    return "SESI1_AKHIR";
  }

  if (
    minutes < 13 * 60 + 30
  ) {
    return "ISTIRAHAT";
  }

  if (
    minutes < 14 * 60 + 30
  ) {
    return "SESI2_AWAL";
  }

  if (
    minutes <= 15 * 60 + 15
  ) {
    return "SESI2_AKHIR";
  }

  return "SETELAH_TUTUP";
}

// ============================================================
// OPTIONAL: GET TODAY INTRADAY PEAK DIRECTLY
// ============================================================
//
// Helper tambahan supaya caller tidak perlu tahu detail
// implementasi ZAPI/Yahoo.
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