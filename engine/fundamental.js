// ==========================
// Fundamental Analysis (lightweight, rule-based)
// ==========================
//
// Menghasilkan skor 0-100 & label, konsisten dengan pola scorer.js/gap.js.
// Kalau data tidak tersedia, skor dinetralkan ke 50 (tidak menghukum
// ataupun menguntungkan saham yang datanya kosong).

export function analyzeFundamental({
  trailingPE,
  priceToBook,
  returnOnEquity,
  debtToEquity,
  dividendYield
} = {}) {

  const warnings = [];

  const hasAnyData =
    trailingPE != null ||
    priceToBook != null ||
    returnOnEquity != null ||
    debtToEquity != null;

  if (!hasAnyData) {
    return {
      score: 50,
      label: "DATA TIDAK TERSEDIA",
      warnings: ["Data fundamental tidak tersedia untuk saham ini."],
      metrics: { trailingPE, priceToBook, returnOnEquity, debtToEquity, dividendYield }
    };
  }

  let score = 50;

  // Price to Book — makin rendah makin "murah" relatif aset
  if (priceToBook != null) {
    if (priceToBook > 0 && priceToBook < 0.5) {
      score += 15;
    } else if (priceToBook < 1) {
      score += 8;
    } else if (priceToBook > 3) {
      score -= 10;
      warnings.push("PBV di atas 3x — valuasi relatif mahal terhadap aset bersih.");
    }
  }

  // Price to Earnings — rugi atau kemahalan sama-sama ditandai
  if (trailingPE != null) {
    if (trailingPE <= 0) {
      score -= 15;
      warnings.push("Perusahaan mencatat rugi (PE negatif) — hati-hati soal kualitas laba.");
    } else if (trailingPE < 15) {
      score += 10;
    } else if (trailingPE > 30) {
      score -= 10;
      warnings.push("PE di atas 30x — valuasi laba tergolong mahal.");
    }
  }

  // Return on Equity — efisiensi pengelolaan modal
  if (returnOnEquity != null) {
    if (returnOnEquity > 15) {
      score += 10;
    } else if (returnOnEquity < 5) {
      score -= 8;
      warnings.push("ROE di bawah 5% — profitabilitas terhadap modal masih lemah.");
    }
  }

  // Debt to Equity — leverage
  if (debtToEquity != null) {
    if (debtToEquity > 100) {
      score -= 10;
      warnings.push("Debt/Equity di atas 100% — beban utang relatif tinggi.");
    } else if (debtToEquity < 30) {
      score += 5;
    }
  }

  // Dividend Yield — bonus kecil, bukan penalti kalau tidak ada
  if (dividendYield != null && dividendYield > 3) {
    score += 5;
  }

  score = Math.round(Math.max(0, Math.min(score, 100)));

  let label = "FUNDAMENTAL NETRAL";
  if (score >= 65) label = "FUNDAMENTAL KUAT";
  else if (score < 45) label = "FUNDAMENTAL LEMAH";

  return {
    score,
    label,
    warnings,
    metrics: { trailingPE, priceToBook, returnOnEquity, debtToEquity, dividendYield }
  };
}
