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

  const timestamps = result.timestamp || [];
  const quote = result.indicators.quote[0];

  // Bangun candle per-index supaya open/high/low/close/volume tetap sejajar.
  // (Versi lama memfilter closePrices dan volumes terpisah, yang bisa
  // membuat index-nya geser kalau null muncul di posisi berbeda.)
  const candles = [];

  for (let i = 0; i < timestamps.length; i++) {
    const close = quote.close[i];
    const high = quote.high[i];
    const low = quote.low[i];
    const open = quote.open[i];
    const volume = quote.volume[i];

    if (
      close === null ||
      high === null ||
      low === null ||
      open === null ||
      volume === null
    ) {
      continue;
    }

    candles.push({
      date: new Date(timestamps[i] * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume
    });
  }

  if (candles.length === 0) {
    throw new Error(`Data ${kode} tidak lengkap dari Yahoo Finance.`);
  }

  return {
    kode,
    candles,
    closePrices: candles.map(c => c.close),
    volumes: candles.map(c => c.volume)
  };
}
