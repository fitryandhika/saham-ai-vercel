// ==========================
// Realtime Intraday OHLCV Service — TAHAP 1
// ==========================
//
// Tujuan:
//   Menyediakan candle OHLCV intraday granularitas 1 menit
//   untuk HARI INI (WIB). Ini fondasi data untuk tahap-tahap
//   berikutnya: 5m Intraday Engine, VWAP, Closing Momentum,
//   Realtime Volume Spike, dst.
//
// PRIORITAS SUMBER:
//   1. ZAPI Stockbit — tick realtime, di-bucket jadi candle 1
//      menit di sini (ZAPI cuma kasih harga+waktu, bukan OHLC).
//   2. Yahoo Finance intraday 1m — fallback. Yahoo sudah kasih
//      OHLCV asli per menit, tidak perlu dibucket ulang.
//
// PENTING:
//   Fungsi ini HANYA untuk HARI INI. Untuk data historis,
//   pakai getStockData() (daily candle) yang sudah ada di
//   stockService.js — bukan file ini.
//
// TIDAK MENGUBAH file lain. File baru, murni tambahan.
// Satu-satunya dependency baru: getZapiIntradayTicks() yang
// ditambahkan (additive, tidak mengubah fungsi lama) di
// services/zapiService.js.
// ==========================

import { getZapiIntradayTicks } from "./zapiService.js";
import { todayWIB } from "../config/tradingCalendar.js";

const YAHOO_BASE_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart";

const YAHOO_TIMEOUT_MS = 10000;
const ZAPI_TIMEOUT_MS = 8000;

// ============================================================
// FETCH HELPER (TIMEOUT-SAFE)
// ============================================================

async function fetchJsonWithTimeout(url, { timeout, headers } = {}) {

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout || 10000
  );

  try {

    const res = await fetch(url, {
      headers,
      signal: controller.signal
    });

    if (!res.ok) {
      return null;
    }

    return await res.json();

  } catch (e) {

    console.error(
      "realtimeIntradayService fetch error:",
      url,
      e?.message || String(e)
    );

    return null;

  } finally {

    clearTimeout(timer);

  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timeout`)),
        ms
      )
    )
  ]);
}

// ============================================================
// BUCKET TICK ZAPI -> CANDLE 1 MENIT
// ============================================================
//
// ZAPI cuma kasih {timeWIB, price, volume} per tick. Supaya
// hasil akhir tetap format OHLCV konsisten (apa pun sumbernya),
// tick di-kelompokkan per menit:
//   open  = tick pertama dalam menit itu
//   high  = harga tertinggi dalam menit itu
//   low   = harga terendah dalam menit itu
//   close = tick terakhir dalam menit itu
//   volume = jumlah volume semua tick dalam menit itu
// ============================================================

function bucketTicksToOneMinuteCandles(ticks) {

  const buckets = new Map();

  for (const tick of ticks) {

    if (!tick || !tick.timeWIB) {
      continue;
    }

    const price = Number(tick.price);

    if (!Number.isFinite(price)) {
      continue;
    }

    // "HH:MM" — buang detik kalau ada.
    const minuteKey = tick.timeWIB.slice(0, 5);

    const volume =
      Number.isFinite(Number(tick.volume))
        ? Number(tick.volume)
        : 0;

    if (!buckets.has(minuteKey)) {

      buckets.set(minuteKey, {
        timeWIB: minuteKey,
        open: price,
        high: price,
        low: price,
        close: price,
        volume
      });

    } else {

      const bucket = buckets.get(minuteKey);

      bucket.high = Math.max(bucket.high, price);
      bucket.low = Math.min(bucket.low, price);
      bucket.close = price;
      bucket.volume += volume;

    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.timeWIB.localeCompare(b.timeWIB));
}

// ============================================================
// SUMBER 1 — ZAPI
// ============================================================

async function getZapiRealtimeOHLCV(kode) {

  try {

    const result = await withTimeout(
      getZapiIntradayTicks(kode),
      ZAPI_TIMEOUT_MS,
      "ZAPI intraday ticks"
    );

    if (
      !result ||
      !Array.isArray(result.ticks) ||
      result.ticks.length === 0
    ) {
      return null;
    }

    const candles =
      bucketTicksToOneMinuteCandles(result.ticks);

    if (candles.length === 0) {
      return null;
    }

    return {
      candles: candles.map((c) => ({
        ...c,
        source: "ZAPI_STOCKBIT_INTRADAY"
      })),
      source: "ZAPI_STOCKBIT_INTRADAY"
    };

  } catch (e) {

    console.error(
      `ZAPI realtime OHLCV ${kode} gagal, fallback Yahoo:`,
      e?.message || String(e)
    );

    return null;

  }
}

// ============================================================
// SUMBER 2 — YAHOO FALLBACK
// ============================================================

async function getYahooRealtimeOHLCV(kode) {

  const symbol = `${String(kode).toUpperCase()}.JK`;

  const url =
    `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}` +
    `?range=1d&interval=1m`;

  const json = await fetchJsonWithTimeout(url, {
    timeout: YAHOO_TIMEOUT_MS,
    headers: { Accept: "application/json" }
  });

  const result = json?.chart?.result?.[0];

  if (!result) {
    return null;
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];

  if (!Array.isArray(timestamps) || !quote) {
    return null;
  }

  const today = todayWIB();
  const candles = [];

  for (let i = 0; i < timestamps.length; i++) {

    const ts = Number(timestamps[i]);

    if (!Number.isFinite(ts)) {
      continue;
    }

    // Yahoo timestamp UTC -> WIB (+7 jam).
    const wib = new Date((ts + 7 * 3600) * 1000);
    const dateWIB = wib.toISOString().slice(0, 10);

    if (dateWIB !== today) {
      continue;
    }

    const hh = String(wib.getUTCHours()).padStart(2, "0");
    const mm = String(wib.getUTCMinutes()).padStart(2, "0");

    const open = Number(quote.open?.[i]);
    const high = Number(quote.high?.[i]);
    const low = Number(quote.low?.[i]);
    const close = Number(quote.close?.[i]);
    const volume = Number(quote.volume?.[i]);

    if (![open, high, low, close].every(Number.isFinite)) {
      continue;
    }

    candles.push({
      timeWIB: `${hh}:${mm}`,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
      source: "YAHOO_INTRADAY_1M"
    });
  }

  if (candles.length === 0) {
    return null;
  }

  candles.sort((a, b) => a.timeWIB.localeCompare(b.timeWIB));

  return { candles, source: "YAHOO_INTRADAY_1M" };
}

// ============================================================
// MAIN EXPORT
// ============================================================
//
// getRealtimeIntradayOHLCV("BBCA")
// ->
// {
//   kode: "BBCA",
//   date: "2026-08-13",
//   candles: [ { timeWIB, open, high, low, close, volume, source }, ... ],
//   candleCount: 187,
//   source: "ZAPI_STOCKBIT_INTRADAY" | "YAHOO_INTRADAY_1M" | "NONE"
// }
// ============================================================

export async function getRealtimeIntradayOHLCV(kode) {

  const normalizedKode =
    String(kode || "").trim().toUpperCase();

  if (!normalizedKode) {
    return null;
  }

  // --------------------------------------------------------
  // PRIORITAS 1 — ZAPI
  // --------------------------------------------------------

  const zapiResult =
    await getZapiRealtimeOHLCV(normalizedKode);

  if (zapiResult && zapiResult.candles.length > 0) {

    return {
      kode: normalizedKode,
      date: todayWIB(),
      candles: zapiResult.candles,
      candleCount: zapiResult.candles.length,
      source: "ZAPI_STOCKBIT_INTRADAY"
    };

  }

  // --------------------------------------------------------
  // PRIORITAS 2 — YAHOO FALLBACK
  // --------------------------------------------------------

  try {

    const yahooResult =
      await getYahooRealtimeOHLCV(normalizedKode);

    if (yahooResult && yahooResult.candles.length > 0) {

      return {
        kode: normalizedKode,
        date: todayWIB(),
        candles: yahooResult.candles,
        candleCount: yahooResult.candles.length,
        source: "YAHOO_INTRADAY_1M"
      };

    }

  } catch (e) {

    console.error(
      `Yahoo realtime OHLCV ${normalizedKode} gagal:`,
      e?.message || String(e)
    );

  }

  // --------------------------------------------------------
  // TIDAK ADA DATA DARI KEDUANYA
  // --------------------------------------------------------

  return {
    kode: normalizedKode,
    date: todayWIB(),
    candles: [],
    candleCount: 0,
    source: "NONE"
  };
}
