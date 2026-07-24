export function calculateSMA(prices, period) {
  if (prices.length < period) return null;

  const data = prices.slice(-period);
  const total = data.reduce((sum, value) => sum + value, 0);

  return Number((total / period).toFixed(2));
}

export function calculateEMA(prices, period) {
  if (prices.length < period) return null;

  const k = 2 / (period + 1);

  let ema = calculateSMA(prices.slice(0, period), period);

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }

  return Number(ema.toFixed(2));
}

export function calculateRSI(prices, period = 14) {
  if (prices.length <= period) return null;

  let gain = 0;
  let loss = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];

    if (diff > 0) {
      gain += diff;
    } else {
      loss -= diff;
    }
  }

  const avgGain = gain / period;
  const avgLoss = loss / period;

  // Bug lama: `avgLoss === 0` langsung return 100 tanpa cek avgGain.
  // Kalau harga TIDAK BERGERAK SAMA SEKALI selama seluruh periode
  // (saham beku/gocap/suspend), avgGain dan avgLoss dua-duanya 0 —
  // bukan cuma avgLoss. Kondisi lama salah mengartikan "tidak ada
  // pergerakan" sebagai "sangat overbought" (RSI 100), yang lewat
  // scorer.js (rsi > 70 -> skor -10) bikin saham beku selalu didorong
  // ke skor rendah -> signal SELL/STRONG SELL, padahal sama sekali
  // tidak ada transaksi untuk disimpulkan arahnya.
  // Ditemukan dari analisa scan_history 15-23 Juli 2026: 154 baris
  // (7% dari total) RSI persis 0/100, 95% masuk STRONG SELL, dan
  // 94,8% di antaranya harga besoknya tidak bergerak sama sekali.
  if (avgGain === 0 && avgLoss === 0) return 50; // netral, bukan overbought
  if (avgLoss === 0) return 100; // avgGain > 0 tapi avgLoss = 0 -> tetap valid overbought

  const rs = avgGain / avgLoss;

  return Number((100 - (100 / (1 + rs))).toFixed(2));
}

export function calculateMACD(prices) {

  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  if (ema12 === null || ema26 === null) {
    return null;
  }

  const macd = Number((ema12 - ema26).toFixed(2));

  return {
    ema12,
    ema26,
    macd
  };
}

export function calculateBollingerBands(prices, period = 20) {

  if (prices.length < period) return null;

  const slice = prices.slice(-period);

  const sma = calculateSMA(prices, period);

  const variance =
    slice.reduce((sum, price) => {
      return sum + Math.pow(price - sma, 2);
    }, 0) / period;

  const stdDev = Math.sqrt(variance);

  return {
    upper: Number((sma + 2 * stdDev).toFixed(2)),
    middle: sma,
    lower: Number((sma - 2 * stdDev).toFixed(2))
  };
}