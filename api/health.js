export default function handler(req, res) {
  res.status(200).json({
    success: true,
    service: "SahamAI API",
    version: "1.0.0",
    status: "ONLINE",
    timestamp: new Date().toISOString()
  });
}