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

const sampleData = {
  kode,
  closePrices: [
    5100,5120,5130,5145,5155,
    5170,5180,5195,5205,5210,
    5220,5235,5240,5250,5260,
    5255,5265,5270,5280,5290,
    5300,5310,5320,5335,5340
  ]
};