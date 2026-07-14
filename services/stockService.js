import { getOfficialTodayData } from "./idxService.js";

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

  // Tambal candle terakhir dengan data resmi IDX kalau tersedia & cocok
  // tanggalnya — ini yang bikin harga acuan analisa lebih presisi
  // dibanding hanya andalin Yahoo yang delay/estimasi.
  let priceSource = "YAHOO";

  try {
    const official = await getOfficialTodayData(kode);

    if (official) {
      const lastCandle = candles[candles.length - 1];
      const lastCandleDate = lastCandle.date.split("T")[0];

      if (lastCandleDate === official.date) {
        lastCandle.open = official.open;
        lastCandle.high = official.high;
        lastCandle.low = official.low;
        lastCandle.close = official.close;
        lastCandle.volume = official.volume;
        priceSource = "IDX_OFFICIAL";
      } else if (official.date > lastCandleDate) {
        // IDX punya data lebih baru dari Yahoo (Yahoo belum update) -> tambahkan candle baru
        candles.push({
          date: `${official.date}T00:00:00.000Z`,
          open: official.open,
          high: official.high,
          low: official.low,
          close: official.close,
          volume: official.volume
        });
        priceSource = "IDX_OFFICIAL";
      }
    }
  } catch (e) {
    console.error("Gagal ambil data resmi IDX, pakai Yahoo saja:", e.message);
  }

  return {
    kode,
    candles,
    closePrices: candles.map(c => c.close),
    volumes: candles.map(c => c.volume),
    priceSource
  };
}