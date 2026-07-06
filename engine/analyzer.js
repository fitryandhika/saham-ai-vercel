export function analyzeStock(kode) {
  kode = kode.toUpperCase();

  let rekomendasi = "HOLD";
  let trend = "SIDEWAYS";
  let confidence = 70;

  if (kode.startsWith("BB")) {
    rekomendasi = "BUY";
    trend = "UPTREND";
    confidence = 88;
  } else if (kode.startsWith("TL")) {
    rekomendasi = "SELL";
    trend = "DOWNTREND";
    confidence = 81;
  }

  return {
    kode,
    rekomendasi,
    trend,
    confidence: `${confidence}%`,
    support: 1000,
    resistance: 1100,
    timestamp: new Date().toISOString()
  };
}