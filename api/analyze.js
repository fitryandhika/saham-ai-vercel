import { analyzeStock } from "../engine/analyzer.js";
import { getStockData } from "../services/stockService.js";

export default async function handler(req, res) {

  try {

    const kode = (req.query.kode || "BBCA").toUpperCase();

    const stockData = await getStockData(kode);

    const hasil = analyzeStock(stockData);

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