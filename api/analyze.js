import { analyzeStock } from "../engine/analyzer.js";

export default function handler(req, res) {

  const kode = (req.query.kode || "BBCA").toUpperCase();

  const sampleData = {
    kode,
    close: 5230,
    high: 5300,
    low: 5180,
    ma20: 5200,
    rsi: 58
  };

  const hasil = analyzeStock(sampleData);

  res.status(200).json({
    success: true,
    data: hasil
  });
}