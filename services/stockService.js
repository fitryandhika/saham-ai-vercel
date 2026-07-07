export async function getStockData(kode) {

  const symbol = `${kode}.JK`;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=6mo&interval=1d`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Gagal mengambil data Yahoo Finance.");
  }

  const json = await response.json();

  const result = json.chart.result?.[0];

  if (!result) {
    throw new Error(`Data ${kode} tidak ditemukan.`);
  }

  const closePrices =
    result.indicators.quote[0].close
      .filter(price => price !== null);

  return {
  kode,
  closePrices,
  volumes: result.indicators.quote[0].volume
    .filter(volume => volume !== null)
};
}