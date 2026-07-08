// ==========================
// Fundamental Data Service
// ==========================
//
// Sumber: Yahoo Finance v7/finance/quote endpoint (format KODE.JK).
// Endpoint ini dipilih (bukan v10/quoteSummary) karena tidak butuh
// crumb/cookie autentikasi, sehingga lebih reliable dipanggil dari
// server/serverless seperti Vercel. Trade-off: ROE & Debt/Equity
// tidak tersedia di endpoint ini (butuh modul financialData yang
// auth-gated) — PE, PBV, EPS, dan Dividend Yield tetap didapat.
//
// PENTING: fungsi ini SELALU resolve (tidak pernah throw) — kalau
// data tidak tersedia/gagal, field dikembalikan null supaya analisa
// utama tetap jalan.

export async function getFundamentalData(kode) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${kode}.JK`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`getFundamentalData: HTTP ${res.status} untuk ${kode} — ${body.slice(0, 200)}`);
      return emptyFundamental();
    }

    const json = await res.json();
    const result = json?.quoteResponse?.result?.[0];

    if (!result) {
      console.error(`getFundamentalData: tidak ada result untuk ${kode}`, JSON.stringify(json).slice(0, 300));
      return emptyFundamental();
    }

    return {
      trailingPE: result.trailingPE ?? null,
      forwardPE: result.forwardPE ?? null,
      priceToBook: result.priceToBook ?? null,
      returnOnEquity: null, // tidak tersedia di v7/quote (butuh modul auth-gated)
      debtToEquity: null,   // tidak tersedia di v7/quote (butuh modul auth-gated)
      dividendYield: result.trailingAnnualDividendYield != null
        ? result.trailingAnnualDividendYield * 100
        : null,
      epsTrailing: result.epsTrailingTwelveMonths ?? null,
      profitMargin: null
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
