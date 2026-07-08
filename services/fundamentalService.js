// ==========================
// Fundamental Data Service
// ==========================
//
// Sumber: Yahoo Finance quoteSummary endpoint (gratis, tanpa API key),
// modul yang sama dipakai getStockData untuk harga (format KODE.JK).
//
// PENTING: data fundamental IDX di Yahoo Finance kadang kosong/telat
// update, beda dengan data harga harian yang rutin. Fungsi ini SELALU
// resolve (tidak pernah throw) — kalau data tidak tersedia, field
// terkait dikembalikan null supaya analisa utama tetap jalan.

export async function getFundamentalData(kode) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${kode}.JK?modules=defaultKeyStatistics,financialData,summaryDetail`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!res.ok) {
      throw new Error(`Fundamental fetch gagal: ${res.status}`);
    }

    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];

    if (!result) {
      return emptyFundamental();
    }

    const keyStats = result.defaultKeyStatistics || {};
    const financial = result.financialData || {};
    const summary = result.summaryDetail || {};

    return {
      trailingPE: summary.trailingPE?.raw ?? null,
      forwardPE: keyStats.forwardPE?.raw ?? null,
      priceToBook: keyStats.priceToBook?.raw ?? null,
      returnOnEquity: financial.returnOnEquity?.raw != null
        ? financial.returnOnEquity.raw * 100
        : null,
      debtToEquity: financial.debtToEquity?.raw ?? null,
      dividendYield: summary.dividendYield?.raw != null
        ? summary.dividendYield.raw * 100
        : null,
      epsTrailing: keyStats.trailingEps?.raw ?? null,
      profitMargin: financial.profitMargins?.raw != null
        ? financial.profitMargins.raw * 100
        : null
    };

  } catch (e) {
    console.error("getFundamentalData error:", e.message);
    return emptyFundamental();
  }
}

function emptyFundamental() {
  return {
    trailingPE: null,
    forwardPE: null,
    priceToBook: null,
    returnOnEquity: null,
    debtToEquity: null,
    dividendYield: null,
    epsTrailing: null,
    profitMargin: null
  };
}
