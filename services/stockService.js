import yahooFinance from "yahoo-finance2";

export async function getStockData(kode) {

  const symbol = `${kode}.JK`;

  const result = await yahooFinance.chart(symbol, {
    period1: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
    interval: "1d"
  });

  if (!result?.quotes?.length) {
    throw new Error(`Data saham ${kode} tidak ditemukan.`);
  }

  const closePrices = result.quotes
    .map(q => q.close)
    .filter(v => typeof v === "number");

  return {
    kode,
    closePrices
  };
}