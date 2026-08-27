import { getRealtimeIntradayOHLCV } from "../services/realtimeIntradayService.js";
import { getZapiRawDebug } from "../services/zapiService.js";
import { calculateIntradayExit } from "../engine/indicators/intradayExit.js";

export default async function handler(req, res) {

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