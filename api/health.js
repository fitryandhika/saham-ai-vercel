module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  return res.status(200).json({
    success: true,
    service: "SahamAI API",
    version: "1.0.0",
    status: "ONLINE",
    timestamp: new Date().toISOString()
  });
};