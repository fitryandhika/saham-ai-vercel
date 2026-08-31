import { getRealtimeIntradayOHLCV } from "../services/realtimeIntradayService.js";
import { getZapiRawDebug } from "../services/zapiService.js";
import { calculateIntradayExit } from "../engine/indicators/intradayExit.js";
import { getStockData } from "../services/stockService.js";
import { todayWIB } from "../config/tradingCalendar.js";

export default async function handler(req, res) {

  // ============================================================
  // MODE DEBUG — EKOR CANDLE HARIAN
  // ============================================================
  //
  // Ditambahkan 1 September 2026 untuk melacak kenapa
  // label-outcomes-close mengembalikan RETRY_NEXT_CANDLE_NOT_FOUND
  // untuk SELURUH 397 emiten pada scan_date 2026-08-28.
  //
  // Kegagalan yang seragam di semua emiten berarti masalahnya bukan
  // per-saham, melainkan di lapisan sumber data. Endpoint ini
  // menampilkan candle harian TERAKHIR persis seperti yang diterima
  // findTradingDayCandleAfter(), lengkap dengan sumber tiap candle,
  // supaya bisa dipastikan apakah candle 2026-08-31 memang tidak ada,
  // ada tapi ditolak normalizeCandle() (mis. volume null), atau
  // Yahoo-nya yang gagal/diblokir sehingga hanya menyisakan histori lama.
  //
  // Contoh:
  //   /api/health?dailytail=AALI
  //   /api/health?dailytail=AALI&after=2026-08-28
  // ============================================================

  const tailKode = req.query.dailytail;

  if (tailKode) {

    try {

      const stockData = await getStockData(tailKode, "3mo");
      const candles = Array.isArray(stockData?.candles) ? stockData.candles : [];

      const sorted = [...candles].sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
      );

      const after = req.query.after || null;

      const bySource = {};
      for (const c of sorted) {
        const src = c.source || "UNKNOWN";
        bySource[src] = (bySource[src] || 0) + 1;
      }

      return res.status(200).json({
        success: true,
        mode: "debug-daily-tail",
        kode: String(tailKode).toUpperCase(),
        todayWIB: todayWIB(),
        totalCandles: sorted.length,
        firstDate: sorted[0]?.date ?? null,
        lastDate: sorted[sorted.length - 1]?.date ?? null,
        bySource,
        after,
        candlesAfter: after
          ? sorted.filter(c => String(c.date).slice(0, 10) > after).length
          : null,
        tail: sorted.slice(-8)
      });

    } catch (e) {

      return res.status(500).json({
        success: false,
        mode: "debug-daily-tail",
        kode: String(tailKode).toUpperCase(),
        message: e?.message || String(e)
      });

    }
  }

  // ============================================================
  // MODE TEST — TAHAP 1 REALTIME INTRADAY OHLCV
  // ============================================================
  //
  // Tambahan opsional, tidak mengubah perilaku default.
  // Dipakai untuk uji coba satu emiten tanpa menambah serverless
  // function baru (sudah di batas 12 function Hobby plan).
  //
  // Contoh:
  //   /api/health?realtime=BBCA
  // ============================================================

  const kode = req.query.realtime;

  if (kode) {

    try {

      const data = await getRealtimeIntradayOHLCV(kode);

      const exitReasoning = calculateIntradayExit({
        candles: data && data.candles ? data.candles : []
      });

      return res.status(200).json({
        success: true,
        mode: "realtime-intraday-test",
        ...data,
        exitReasoning
      });

    } catch (e) {

      return res.status(500).json({
        success: false,
        mode: "realtime-intraday-test",
        message: e?.message || String(e)
      });

    }
  }

  // ============================================================
  // MODE DEBUG — RAW ZAPI (CEK FRESHNESS/LATENCY SUMBER)
  // ============================================================
  //
  // Contoh:
  //   /api/health?debugzapi=BBCA
  //
  // Menampilkan JSON MENTAH dari finance:stockbit/chart (yang
  // dipakai realtimeIntradayService.js) dan finance:stockbit/
  // symbol (kemungkinan lebih segar) berdampingan, supaya bisa
  // dibandingkan field timestamp/harga-nya langsung.
  // ============================================================

  const debugKode = req.query.debugzapi;

  if (debugKode) {

    try {

      const data = await getZapiRawDebug(debugKode);

      return res.status(200).json({
        success: true,
        mode: "debug-zapi-raw",
        ...data
      });

    } catch (e) {

      return res.status(500).json({
        success: false,
        mode: "debug-zapi-raw",
        message: e?.message || String(e)
      });

    }
  }

  // ============================================================
  // DEFAULT — HEALTH CHECK BIASA
  // ============================================================

  res.status(200).json({
    success: true,
    service: "Stockgz API",
    version: "1.0.0",
    status: "ONLINE",
    timestamp: new Date().toISOString()
  });
}