export default function handler(req, res) {
  const { kode } = req.query;

  if (!kode) {
    return res.status(400).json({
      success: false,
      message: "Parameter 'kode' wajib diisi."
    });
  }

  res.status(200).json({
    success: true,
    kode: kode.toUpperCase(),
    rekomendasi: "HOLD",
    trend: "SIDEWAYS",
    confidence: "70%",
    support: 1000,
    resistance: 1100,
    timestamp: new Date().toISOString()
  });
}