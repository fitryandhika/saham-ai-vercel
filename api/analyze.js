import { analyzeStock } from "../engine/analyzer.js";

export default function handler(req, res) {

  const kode = (req.query.kode || "BBCA").toUpperCase();

  const sampleData = {
    kode,
    closePrices: Array.from({ length: 60 }, (_, i) => 5000 + i * 8)
  };

  const hasil = analyzeStock(sampleData);

  res.status(200).json({
    success: true,
    data: hasil
  });
}