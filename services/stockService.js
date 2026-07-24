import { getOfficialTodayData } from "./idxService.js";

export async function getStockData(kode, range = "6mo") {

  const symbol = `${kode}.JK`;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`;

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

  if (range === "6mo") {
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
  }

  return {
    kode,
    candles,
    closePrices: candles.map(c => c.close),
    volumes: candles.map(c => c.volume),
    priceSource
  };
}

// Cari candle harian pertama yang tanggalnya SETELAH scanDate — dipakai
// untuk melabeli hasil "hari berikutnya" baik untuk backlog baru (T+1 =
// hari ini) maupun backlog lama (T+1 = beberapa hari/minggu lalu),
// dengan cara yang sama seperti api/relabel-high-low.js supaya kedua
// endpoint labeling konsisten dan tidak salah asumsi "candle terakhir
// pasti T+1" (yang cuma benar kalau tidak ada backlog).
export function findTradingDayCandleAfter(candles, scanDate) {
  for (const c of candles) {
    if (c.date.slice(0, 10) > scanDate) return c;
  }
  return null;
}

// ==========================
// Intraday Peak Time — jam berapa harga tertinggi hari itu tercapai
// ==========================
//
// Yahoo Finance cuma simpan data intraday (interval < 1d) untuk ~60 hari
// terakhir, jadi ini best-effort: kalau tanggalnya sudah terlalu lama,
// atau Yahoo lagi tidak punya datanya, fungsi ini return null (BUKAN
// error) — caller harus tetap bisa lanjut tanpa peak time.
//
// range="5d" (bukan "1d") supaya tetap dapat data biarpun dipanggil
// H+1/H+2 dari tanggal targetnya (mis. cron sempat gagal sehari), tapi
// cukup kecil supaya responsnya ringan.
export async function getIntradayPeakTime(kode, targetDateWIB, { range = "5d", interval = "15m" } = {}) {
  try {
    const symbol = `${kode}.JK`;
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const json = await response.json();
    const result = json.chart.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0];
    if (!timestamps.length || !quote) return null;

    let peakHigh = null;
    let peakTs = null;

    for (let i = 0; i < timestamps.length; i++) {
      const high = quote.high[i];
      if (high === null || high === undefined) continue;

      // Geser ke WIB (UTC+7) dengan menambah offset detik, lalu baca
      // komponen tanggal/jam pakai method UTC — trik umum untuk
      // menghindari timezone lokal server yang tidak jelas di Vercel.
      const wib = new Date((timestamps[i] + 7 * 3600) * 1000);
      const dateWIB = wib.toISOString().slice(0, 10);

      if (dateWIB !== targetDateWIB) continue;

      if (peakHigh === null || high > peakHigh) {
        peakHigh = high;
        peakTs = timestamps[i];
      }
    }

    if (peakTs === null) return null;

    const wib = new Date((peakTs + 7 * 3600) * 1000);
    const hh = String(wib.getUTCHours()).padStart(2, "0");
    const mm = String(wib.getUTCMinutes()).padStart(2, "0");
    const peakTimeWIB = `${hh}:${mm}`;

    return {
      peakTimeWIB,
      peakHigh,
      peakSessionPhase: classifySessionPhase(peakTimeWIB)
    };
  } catch (e) {
    console.error(`getIntradayPeakTime(${kode}) gagal:`, e.message);
    return null;
  }
}

// Perkiraan jadwal sesi reguler bursa IDX (WIB). Kalau BEI merevisi jam
// perdagangan, sesuaikan batas menit di bawah — dampaknya cuma ke label
// fase, bukan ke peakTimeWIB (yang tetap akurat apa adanya dari data).
function classifySessionPhase(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const minutes = h * 60 + m;

  if (minutes < 9 * 60) return "SEBELUM_BUKA";
  if (minutes < 10 * 60) return "SESI1_AWAL";       // 09:00-10:00
  if (minutes < 11 * 60 + 30) return "SESI1_AKHIR"; // 10:00-11:30
  if (minutes < 13 * 60 + 30) return "ISTIRAHAT";   // jeda siang
  if (minutes < 14 * 60 + 30) return "SESI2_AWAL";  // 13:30-14:30
  if (minutes <= 15 * 60 + 15) return "SESI2_AKHIR"; // 14:30-15:15 (menjelang closing)
  return "SETELAH_TUTUP";
}