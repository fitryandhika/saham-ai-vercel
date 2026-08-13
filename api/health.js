import { getRealtimeIntradayOHLCV } from "../services/realtimeIntradayService.js";

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

      return res.status(200).json({
        success: true,
        mode: "realtime-intraday-test",
        ...data
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
  // DEFAULT — HEALTH CHECK BIASA
  // ============================================================

  res.status(200).json({
    success: true,
    service: "SahamAI API",
    version: "1.0.0",
    status: "ONLINE",
    timestamp: new Date().toISOString()
  });
}