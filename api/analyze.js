import { analyzeStock } from "../engine/analyzer.js";

export default function handler(req, res) {
  const { kode } = req.query;

  if (!kode) {
    return res.status(400).json({
      success: false,
      message: "Parameter 'kode' wajib diisi."
    });
  }

  const hasil = analyzeStock(kode);

  res.status(200).json({
    success: true,
    ...hasil
  });
}