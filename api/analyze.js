import { analyzeStock } from "../engine/analyzer.js";
import { getStockData } from "../services/stockService.js";
import { checkNewsWarnings } from "../engine/newsCheck.js";
import { getFundamentalData } from "../services/fundamentalService.js";
import { getIhsgCloses } from "../services/marketService.js";
import { getSector } from "../config/universe.js";

export default async function handler(req, res) {

  try {

    const kode = (req.query.kode || "BBCA").toUpperCase();

    const stockData = await getStockData(kode);

    // Fundamental diambil terpisah & digabung sebelum analyzeStock(),
    // supaya kalau gagal, tidak menggagalkan analisa teknikal utama.
    stockData.fundamental = await getFundamentalData(kode);

    // RS vs IHSG — best-effort, kalau gagal analisa tetap jalan tanpa RS.
    stockData.ihsgCloses = await getIhsgCloses();
    stockData.sector = getSector(kode);
    // RS vs sektor butuh data batch (peer sektor), tidak tersedia di
    // analisa satu-ticker — hanya diisi oleh api/scan.js.

    const hasil = analyzeStock(stockData);

    const news = await checkNewsWarnings(kode);
    hasil.warnings = [...hasil.warnings, ...news.warnings];
    hasil.newsCount = news.newsCount;

    return res.status(200).json({
      success: true,
      data: hasil
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Analisis saham gagal.",
      error: error.message
    });

  }

}
