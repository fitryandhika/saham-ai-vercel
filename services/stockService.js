// ==========================
// Stock Data Service — FINAL
// ==========================
//
// DATA POLICY
//
// DAILY / HISTORICAL OHLCV (6 bulan ke belakang, buat SMA/RSI/dst)
//   1. Yahoo Finance = SATU-SATUNYA sumber histori panjang
//
// CANDLE TERBARU / HARI INI (prioritas, dari tinggi ke rendah)
//   1. ZAPI Stockbit  = PRIORITAS UTAMA (ditambahkan 21 Agustus 2026
//                        — Yahoo resmi delay 10 menit utk .JK, lihat
//                        catatan lengkap di getZapiOfficialLatestCandle())
//   2. IDX Official   = fallback kalau ZAPI gagal/tidak lengkap
//   3. Yahoo (delayed)= fallback terakhir, tetap dipakai walau delay
//                        10 menit, drpd tidak ada data sama sekali
//
// REALTIME / INTRADAY PEAK TRACKING (buat next-day opportunity, BEDA
// dari candle terbaru di atas)
//   1. ZAPI Stockbit  = PRIORITAS
//   2. Yahoo 15m      = FALLBACK
//
// CATATAN:
// getZapiDailyCandle() (dipakai utk "candle terbaru" di atas) BEDA
// fungsi dari getZapiIntradayPeakToday() (dipakai utk peak tracking).
// Yang pertama satu-tanggal-satu-saham (summary), yang kedua tick-
// by-tick. Histori 6 bulan TETAP Yahoo — shape API ZAPI daily tidak
// efisien dipanggil 120+ hari x 397 saham (lihat komentar di
// getYahooDailyCandles di bawah).
//
// ==========================

import { getOfficialTodayData } from "./idxService.js";

import {
  getZapiIntradayPeakToday,
  getZapiDailyCandle
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

    case "ZAPI_IDX_DAILY":
      return 3;

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
// ZAPI LATEST CANDLE (real-time hari berjalan)
// ============================================================
//
// Ditambahkan 21 Agustus 2026. Yahoo secara RESMI melabeli data
// .JK (IDX) sebagai "Delayed Quote" dengan delay 10 menit (sumber:
// help.yahoo.com/kb/finance/SLN2310.html, provider ICE Data
// Services) — untuk analisa jam 15:30 WIB (menjelang closing
// auction, periode paling menentukan buat strategi beli-sore),
// delay 10 menit itu bisa bikin harga & indikator yang dipakai
// sudah ketinggalan momen penting.
//
// ZAPI (Stockbit) dipakai sebagai PRIORITAS UTAMA untuk candle
// HARI INI SAJA — bukan pengganti histori 6 bulan (lihat komentar
// DATA POLICY di atas soal kenapa ZAPI tidak dipakai untuk histori
// panjang: shape API-nya satu-tanggal-satu-saham, tidak efisien
// untuk 120+ hari x 397 saham). Prioritas akhir di sourcePriority():
// ZAPI_IDX_DAILY (3) > IDX_OFFICIAL (2) > YAHOO (1) — jadi kalau
// ZAPI gagal/tidak lengkap, otomatis jatuh ke IDX Official, lalu ke
// Yahoo (delayed) sebagai lapisan terakhir. Sama seperti
// getIdxOfficialLatestCandle(), fungsi ini SELALU aman — kalau
// gagal apapun sebabnya, return null dan caller fallback ke sumber
// di bawahnya, tidak pernah melempar error ke atas.
//
// CATATAN JUJUR: getZapiDailyCandle() memanggil endpoint
// "stock-summary" ZAPI. Saya (dari kode) tidak bisa memverifikasi
// apakah endpoint ini benar-benar ter-update live sepanjang jam
// bursa, atau cuma snapshot yang di-refresh berkala oleh provider-
// nya — itu perilaku sisi Stockbit/ZAPI yang cuma bisa dikonfirmasi
// dengan tes langsung saat market buka (misal jam 15:30 WIB,
// bandingkan angkanya dengan running trade/RTI di aplikasi
// sekuritas). Kalau ternyata tidak se-real-time yang diharapkan,
// gunakan getZapiIntradayPeakToday()/realtimeIntradayService.js
// (Tahap 1 — sudah pasti live, dipakai untuk peak tracking) sebagai
// sumber alternatif untuk field `close` saja.
// ============================================================

async function getZapiOfficialLatestCandle(
  kode
) {

  try {

    const zapi =
      await Promise.race([

        getZapiDailyCandle(
          kode,
          todayWIB()
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


    if (!zapi) {

      return null;

    }


    return normalizeCandle(zapi);


  } catch (e) {

    console.error(
      `ZAPI daily latest ${kode} gagal:`,
      e?.message ||
      String(e)
    );

    return null;

  }

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
//   Yahoo historical (histori panjang)
//   + ZAPI/IDX latest jika tersedia (candle terbaru, lihat DATA
//     POLICY di atas file — urutan prioritas ZAPI > IDX > Yahoo)
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
  // ZAPI LATEST (real-time, prioritas utama)
  // ==========================================================

  let zapiCandle = null;


  if (
    [
      "1mo",
      "3mo",
      "6mo",
      "1y",
      "max"
    ].includes(range)
  ) {

    zapiCandle =
      await getZapiOfficialLatestCandle(
        normalizedKode
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
  //
  // Prioritas (lihat sourcePriority()): ZAPI_IDX_DAILY > IDX_OFFICIAL
  // > YAHOO. mergeCandles menangani ini otomatis per tanggal — kalau
  // ZAPI & IDX sama-sama gagal untuk hari ini, candle Yahoo (delayed
  // 10 menit) yang tetap dipakai, bukan error.

  const candles =
    mergeCandles(

      yahooCandles,

      idxCandle
        ? [idxCandle]
        : [],

      zapiCandle
        ? [zapiCandle]
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

// ------------------------------------------------------------
// BATAS WIB -> UNIX (UTC) UNTUK period1/period2
// ------------------------------------------------------------
//
// BUG LAMA: fungsi ini sebelumnya memakai parameter Yahoo
// `range=5d`, yang oleh Yahoo diartikan sebagai "5 hari
// kalender TERAKHIR DARI SEKARANG" (server time saat request
// dikirim) — bukan jendela di sekitar targetDateWIB.
//
// Akibatnya: untuk backlog/backfill yang tanggalnya lebih dari
// ~5 hari ke belakang (mis. relabel-high-low.js, atau
// label-outcomes-close.js yang telat diproses), response Yahoo
// TIDAK PERNAH berisi candle pada targetDateWIB sama sekali,
// sehingga peak selalu null — walau Yahoo sendiri sebenarnya
// masih punya datanya (Yahoo retain candle 15m selama ~60 hari).
//
// FIX: minta jendela waktu eksplisit (period1/period2) yang
// dipusatkan pada targetDateWIB itu sendiri, bukan relatif ke
// waktu request. Diberi buffer 1 jam di kedua sisi supaya tidak
// kepotong pembulatan interval di batas hari.
// ------------------------------------------------------------

function wibDayRangeToUnixSeconds(
  dateWIB
) {

  // Tengah malam WIB (00:00) untuk dateWIB, dinyatakan dalam UTC:
  // dateWIB 00:00 WIB = (dateWIB 00:00 UTC) - 7 jam.
  const startUtcMs =
    Date.parse(
      `${dateWIB}T00:00:00.000Z`
    ) -
    7 * 3600 * 1000;

  const bufferMs =
    1 * 3600 * 1000;

  return {
    period1:
      Math.floor(
        (startUtcMs - bufferMs) /
        1000
      ),

    period2:
      Math.floor(
        (startUtcMs +
          24 * 3600 * 1000 +
          bufferMs) /
        1000
      )
  };

}

async function getYahooIntradayPeak(
  kode,
  targetDateWIB,
  {
    interval = "15m"
  } = {}
) {

  const symbol =
    `${kode.toUpperCase()}.JK`;


  const {
    period1,
    period2
  } =
    wibDayRangeToUnixSeconds(
      targetDateWIB
    );


  const url =
    `${YAHOO_BASE_URL}/` +
    `${encodeURIComponent(symbol)}` +
    `?period1=${period1}` +
    `&period2=${period2}` +
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

    // `range` sengaja masih diterima supaya caller lama
    // (mis. { range: "5d", interval: "15m" }) tidak perlu
    // diubah. Sudah TIDAK dipakai lagi oleh Yahoo fallback —
    // jendela waktu sekarang selalu dihitung dari
    // targetDateWIB sendiri lewat wibDayRangeToUnixSeconds().
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