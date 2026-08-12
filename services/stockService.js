// ==========================
// Stock Data Service — FINAL
// ==========================
//
// DATA POLICY
//
// DAILY / HISTORICAL OHLCV
//   1. Yahoo Finance = historical daily source
//   2. IDX Official   = optional replacement for latest daily candle
//
// REALTIME / INTRADAY TODAY
//   1. ZAPI Stockbit  = PRIORITY
//   2. Yahoo 15m      = FALLBACK
//
// IMPORTANT:
// zapiService.js yang tersedia saat ini hanya menyediakan
// getZapiIntradayPeakToday(). Itu hanya peak intraday, bukan OHLCV.
//
// Karena itu ZAPI TIDAK boleh dipaksa menjadi sumber daily OHLCV.
// Memaksa peak menjadi OHLC akan menghasilkan data palsu.
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

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {

    const response =
      await fetch(
        url,
        {
          method: "GET",
          headers,
          signal: controller.signal
        }
      );

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

  if (!value) {
    return null;
  }

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
    new Date(
      `${value}T00:00:00Z`
    );

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

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


// ============================================================
// VALIDATE OHLCV
// ============================================================

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

    date:
      dateOnly(date),

    open:
      toNumber(open),

    high:
      toNumber(high),

    low:
      toNumber(low),

    close:
      toNumber(close),

    volume:
      toNumber(volume),

    source:
      source || "UNKNOWN"

  };


  // Date wajib valid

  if (
    !candle.date ||
    !isValidDateString(candle.date)
  ) {

    return null;

  }


  // OHLCV wajib lengkap

  if (
    !validOHLCV(candle)
  ) {

    return null;

  }


  // Validasi struktur harga

  if (
    candle.high <
    candle.low
  ) {

    return null;

  }


  if (
    candle.open <
      candle.low ||
    candle.open >
      candle.high
  ) {

    return null;

  }


  if (
    candle.close <
      candle.low ||
    candle.close >
      candle.high
  ) {

    return null;

  }


  return candle;

}


// ============================================================
// SOURCE PRIORITY
// ============================================================
//
// Untuk DAILY:
//
// IDX_OFFICIAL > YAHOO
//
// ZAPI tidak dimasukkan ke daily karena endpoint ZAPI
// yang tersedia hanya peak intraday.
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

function mergeCandles(
  ...arrays
) {

  const map =
    new Map();


  for (
    const arr of arrays
  ) {

    if (
      !Array.isArray(arr)
    ) {
      continue;
    }


    for (
      const candle of arr
    ) {

      if (
        !candle ||
        !candle.date
      ) {
        continue;
      }


      const existing =
        map.get(
          candle.date
        );


      if (
        !existing ||
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
//
// Yahoo digunakan untuk historical daily karena ZAPI yang
// tersedia saat ini tidak menyediakan historical daily OHLCV.
//
// ============================================================

async function getYahooDailyCandles(
  kode,
  range = "6mo"
) {

  const symbol =
    `${kode.toUpperCase()}.JK`;


  const url =
    `${YAHOO_BASE_URL}/` +
    `${encodeURIComponent(symbol)}` +
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

    throw new Error(
      json?.chart?.error?.description ||
      `Data Yahoo ${kode} tidak ditemukan.`
    );

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

      candles.push(
        candle
      );

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
// IDX hanya digunakan sebagai pengganti candle terbaru
// apabila getOfficialTodayData() memberikan OHLCV lengkap.
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
// Fungsi utama analyzer dan labeling.
//
// HASIL:
//   candles
//   closePrices
//   volumes
//   priceSource
//   latestSource
//   latestDate
//
// DAILY SOURCE:
//   Yahoo historical
//   + IDX latest jika tersedia
//
// ZAPI TIDAK dicampurkan ke candles daily.
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
    [
      "1mo",
      "3mo",
      "6mo",
      "1y",
      "max"
    ].includes(range)
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
  // LATEST CANDLE
  // ==========================================================

  const latestCandle =
    candles[
      candles.length - 1
    ];


  const latestSource =
    latestCandle?.source ||
    "UNKNOWN";


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

    priceSource:
      latestSource,

    latestSource:
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
// Mencari candle trading pertama setelah scanDate.
//
// TIDAK menggunakan candles.at(-1).
//
// Contoh:
//
// scanDate = 2026-08-10
//
// candle:
// 2026-08-10
// 2026-08-11 <-- dikembalikan
// 2026-08-12
//
// ============================================================

export function findTradingDayCandleAfter(
  candles,
  scanDate
) {

  if (
    !Array.isArray(candles) ||
    candles.length === 0 ||
    !scanDate
  ) {

    return null;

  }


  const targetDate =
    dateOnly(scanDate);


  if (
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
// ZAPI INTRADAY PEAK
// ============================================================
//
// ZAPI = PRIORITAS untuk hari berjalan.
//
// Jika ZAPI gagal / response tidak lengkap:
// Yahoo 15m fallback.
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
// YAHOO INTRADAY PEAK
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
    `${YAHOO_BASE_URL}/` +
    `${encodeURIComponent(symbol)}` +
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

    const timestamp =
      Number(
        timestamps[i]
      );


    const high =
      Number(
        quote.high?.[i]
      );


    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(high)
    ) {

      continue;

    }


    // Yahoo timestamp UTC.
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
// 1. ZAPI
// 2. Yahoo 15m fallback
//
// Untuk tanggal historis:
// langsung Yahoo.
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


  if (
    !normalizedKode
  ) {

    return null;

  }


  const targetDate =
    dateOnly(
      targetDateWIB
    );


  if (
    !isValidDateString(
      targetDate
    )
  ) {

    return null;

  }


  // ==========================================================
  // ZAPI — PRIORITAS
  // ==========================================================

  if (
    targetDate ===
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

            peakHigh:
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
      targetDate,
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

export async function getTodayIntradayPeak(
  kode
) {

  return getIntradayPeakTime(
    kode,
    todayWIB(),
    {
      range:
        "5d",

      interval:
        "15m"
    }
  );

}