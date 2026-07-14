// ==========================
// Fundamental Data Service
// ==========================
//
// Sejak pertengahan 2023, endpoint quoteSummary & v7/finance/quote milik
// Yahoo Finance WAJIB pakai cookie + crumb (token anti-scraping). Tanpa
// itu, Yahoo balikin 401/"Invalid Crumb" — ini penyebab utama kenapa
// data fundamental sering kosong bahkan untuk saham blue-chip.
// Endpoint harga (v8/finance/chart) tidak kena aturan ini, makanya
// candle/harga tetap normal.
//
// Alur: ambil cookie session -> tukar jadi crumb -> pakai keduanya
// di request quoteSummary & quote fallback.
//
// PENTING: fungsi ini SELALU resolve (tidak pernah throw) — kalau semua
// upaya gagal, field dikembalikan null supaya analisa utama tetap jalan.

let cachedAuth = null; // { cookie, crumb, expiresAt } — bertahan selama warm start Vercel

async function getYahooAuth() {
  const now = Date.now();
  if (cachedAuth && cachedAuth.expiresAt > now) {
    return cachedAuth;
  }

  try {
    // 1) Ambil cookie session dari Yahoo
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "manual"
    });

    const setCookie = cookieRes.headers.get("set-cookie");
    if (!setCookie) return null;

    const cookie = setCookie.split(";")[0];

    // 2) Tukar cookie jadi crumb
    const crumbRes = await fetch(
      "https://query1.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Cookie": cookie
        }
      }
    );

    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();

    if (!crumb || crumb.includes("<html")) return null;

    cachedAuth = {
      cookie,
      crumb,
      expiresAt: now + 5 * 60 * 1000 // cache 5 menit, cukup untuk beberapa request warm start
    };

    return cachedAuth;
  } catch (e) {
    console.error("getYahooAuth error:", e.message);
    return null;
  }
}

async function fetchJsonAuthed(url, auth) {
  try {
    const headers = { "User-Agent": "Mozilla/5.0" };
    if (auth?.cookie) headers["Cookie"] = auth.cookie;

    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function fetchQuoteSummary(kode, auth) {
  const hosts = ["query1", "query2"];
  const crumbParam = auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";

  for (const host of hosts) {
    const url =
      `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${kode}.JK` +
      `?modules=defaultKeyStatistics,financialData,summaryDetail${crumbParam}`;

    const json = await fetchJsonAuthed(url, auth);
    const result = json?.quoteSummary?.result?.[0];
    if (result) return result;
  }

  return null;
}

async function fetchQuoteFallback(kode, auth) {
  const hosts = ["query1", "query2"];
  const crumbParam = auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";

  for (const host of hosts) {
    const url =
      `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${kode}.JK${crumbParam}`;

    const json = await fetchJsonAuthed(url, auth);
    const result = json?.quoteResponse?.result?.[0];
    if (result) return result;
  }

  return null;
}

export async function getFundamentalData(kode) {
  const data = emptyFundamental();

  const auth = await getYahooAuth();

  // 1) Coba quoteSummary (sumber paling lengkap: ada ROE & DER)
  const summary = await fetchQuoteSummary(kode, auth);

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
    const q = await fetchQuoteFallback(kode, auth);

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