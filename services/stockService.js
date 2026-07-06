import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export async function getStockData(kode) {

  const symbol = `${kode}.JK`;

  const history = await yahooFinance.historical(symbol, {
    period1: new Date(Date.now() - 1000 * 60 * 60 * 24 * 120),
    interval: "1d"
  });

  if (!history || history.length === 0) {
    throw new Error(`Data saham ${kode} tidak ditemukan.`);
  }

  const closePrices = history
    .map(item => item.close)
    .filter(price => price !== null);

  return {
    kode,
    closePrices
  };
}