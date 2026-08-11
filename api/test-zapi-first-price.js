import { getZapiFirstPriceToday } from "../services/zapiService.js";

export default async function handler(req, res) {
  try {
    const kode = String(req.query.kode || "TRUK")
      .trim()
      .toUpperCase();

    const result = await getZapiFirstPriceToday(kode);

    return res.status(200).json({
      success: true,
      kode,
      result
    });

  } catch (error) {
    console.error("test-zapi-first-price error:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}