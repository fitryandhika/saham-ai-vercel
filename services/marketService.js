// ==========================
// IHSG (Market Index) Data Service
// ==========================
//
// Dipakai untuk Relative Strength — return saham dibanding return IHSG
// di periode yang sama. Sumber sama seperti stockService.js (Yahoo
// Finance chart endpoint), simbol ^JKSE.
//
// Dicache in-memory per invocation function (bukan lintas request) —
// pada batch scan, satu kali fetch dipakai ulang untuk semua kode
// dalam scan yang sama supaya tidak fetch berkali-kali.

let cached = null;

export async function getIhsgCloses({ forceRefresh = false } = {}) {
  if (cached && !forceRefresh) return cached;

  try {
    const url =
      "https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=6mo&interval=1d";

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Gagal mengambil data IHSG dari Yahoo Finance.");
    }

    const json = await response.json();
    const result = json.chart.result?.[0];

    if (!result) {
      throw new Error("Data IHSG tidak ditemukan.");
    }

    const quote = result.indicators.quote[0];
    const closes = (quote.close || []).filter(
      (c) => c !== null && c !== undefined
    );

    if (closes.length === 0) {
      throw new Error("Data IHSG kosong.");
    }

    cached = closes;
    return closes;
  } catch (e) {
    console.error("Gagal ambil data IHSG, RS vs IHSG dilewati:", e.message);
    return null;
  }
}

export default getIhsgCloses;
