import { analyzeStock } from "../engine/analyzer.js";
import { getStockData } from "../services/stockService.js";

export default async function handler(req, res) {

  try {

    const kode = (req.query.kode || "BBCA").toUpperCase();

    const stockData = await getStockData(kode);

    const hasil = analyzeStock(stockData);

    res.status(200).json({
      success: true,
      data: hasil
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      error: error.message
    });

  }

}