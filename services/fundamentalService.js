// ==========================
// Fundamental Data Service
// ==========================
//
// Sumber utama: Yahoo Finance quoteSummary (query1 -> fallback query2).
// Sumber cadangan: Yahoo v7/finance/quote (kadang terisi walau
// quoteSummary kosong) untuk PE, forward PE, PBV, EPS, dividend yield.
// ROE & Debt/Equity HANYA ada di quoteSummary, tidak ada fallback-nya.
//
// PENTING: data fundamental IDX di Yahoo Finance kadang kosong/telat
// update. Fungsi ini SELALU resolve (tidak pernah throw) — kalau data
// tidak tersedia sama sekali, field terkait dikembalikan null supaya
// analisa utama tetap jalan.

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function fetchQuoteSummary(kode) {
  const hosts = ["query1", "query2"];

  for (const host of hosts) {
    const url =
      `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${kode}.JK` +
      `?modules=defaultKeyStatistics,financialData,summaryDetail`;

    const json = await fetchJson(url);
    const result = json?.quoteSummary?.result?.[0];
    if (result) return result;
  }

  return null;
}

async function fetchQuoteFallback(kode) {
  const hosts = ["query1", "query2"];

  for (const host of hosts) {
    const url =
      `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${kode}.JK`;

    const json = await fetchJson(url);
    const result = json?.quoteResponse?.result?.[0];
    if (result) return result;
  }

  return null;
}

export async function getFundamentalData(kode) {
  const data = emptyFundamental();

  // 1) Coba quoteSummary (sumber paling lengkap: ada ROE & DER)
  const summary = await fetchQuoteSummary(kode);

  if (summary) {
    const keyStats = summary.defaultKeyStatistics || {};
    const financial = summary.financialData || {};
    const detail = summary.summaryDetail || {};

    data.trailingPE = detail.trailingPE?.raw ?? null;
    data.forwardPE = keyStats.forwardPE?.raw ?? null;
    data.priceToBook = keyStats.priceToBook?.raw ?? null;
    data.returnOnEquity =
      financial.returnOnEquity?.raw != null
        ? financial.returnOnEquity.raw * 100
        : null;
    data.debtToEquity = financial.debtToEquity?.raw ?? null;
    data.dividendYield =
      detail.dividendYield?.raw != null
        ? detail.dividendYield.raw * 100
        : null;
    data.epsTrailing = keyStats.trailingEps?.raw ?? null;
    data.profitMargin =
      financial.profitMargins?.raw != null
        ? financial.profitMargins.raw * 100
        : null;
  }

  // 2) Kalau field masih kosong, tambal pakai v7/finance/quote
  const needsFallback =
    data.trailingPE == null ||
    data.forwardPE == null ||
    data.priceToBook == null ||
    data.dividendYield == null ||
    data.epsTrailing == null;

  if (needsFallback) {
    const q = await fetchQuoteFallback(kode);

    if (q) {
      if (data.trailingPE == null) data.trailingPE = q.trailingPE ?? null;
      if (data.forwardPE == null) data.forwardPE = q.forwardPE ?? null;

      if (data.priceToBook == null) {
        if (q.priceToBook != null) {
          data.priceToBook = q.priceToBook;
        } else if (q.regularMarketPrice != null && q.bookValue) {
          data.priceToBook = q.regularMarketPrice / q.bookValue;
        }
      }

      if (data.dividendYield == null) {
        data.dividendYield =
          q.trailingAnnualDividendYield != null
            ? q.trailingAnnualDividendYield * 100
            : null;
      }

      if (data.epsTrailing == null) {
        data.epsTrailing = q.epsTrailingTwelveMonths ?? null;
      }
    }
  }

  return data;
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