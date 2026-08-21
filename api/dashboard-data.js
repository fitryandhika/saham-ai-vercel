// ==========================
// Dashboard Data — /api/dashboard-data
// ==========================
//
// Vercel Hobby plan cuma boleh maksimal 12 Serverless Functions per
// deployment (satu file di /api = satu function). Awalnya 4 fitur
// dashboard baru ini masing-masing file sendiri (ihsg-chart.js,
// asia-markets.js, foreign-flow.js, market-news.js) — total jadi 14
// function dan deploy GAGAL (melebihi limit Hobby). Digabung jadi SATU
// file di sini, dibedakan lewat query ?type=, supaya total function
// tetap di bawah limit. Logika masing-masing tipe TIDAK berubah dari
// versi file terpisah sebelumnya, cuma dipindah jadi function lokal.

import { getRecentMacroSnapshots } from "../services/macroDataService.js";
import { fetchMarketNews } from "../services/marketNewsService.js";
import { getScannedKodeForDate } from "../services/dataLogService.js";
import { todayWIB, lastTradingDay, isTradingDay } from "../config/tradingCalendar.js";

// ----------------------------------------------------------
// type=scanhealth — cek apakah scan harian sudah jalan
// ----------------------------------------------------------
// Ditambahkan 21 Agustus 2026 setelah insiden scan tanggal 20 Agustus
// kosong (cron gagal/tidak jalan, baru ketahuan sehari kemudian lewat
// Riwayat AI). Endpoint ini mengecek hari bursa TERAKHIR (bisa hari ini
// kalau sudah lewat jam scan, atau hari bursa sebelumnya kalau belum)
// dan memberi tahu FE kalau baris scan_history untuk tanggal itu masih
// kosong, supaya dashboard bisa tampilkan peringatan HARI ITU JUGA,
// bukan ketauan pas cek Riwayat besoknya.
async function handleScanHealth(req, res) {
  const today = todayWIB();
  const checkDate = isTradingDay(today) ? today : lastTradingDay(today);

  const kodeList = await getScannedKodeForDate(checkDate);
  const count = kodeList.length;

  // Jam scan cron dijadwalkan 16:30 WIB (30 9 * * 1-5). Vercel Hobby
  // cron cuma dijamin jalan dalam JAM yang dijadwalkan (bisa kapan saja
  // 16:00-16:59 WIB), jadi baru dianggap "telat/gagal" setelah 17:00 WIB.
  const nowWibHour = Number(
    new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(11, 13)
  );
  const pastScanWindow = checkDate === today ? nowWibHour >= 17 : true;

  return res.status(200).json({
    success: true,
    view: "scanhealth",
    data: {
      checkDate,
      scannedCount: count,
      ok: count > 0,
      pastScanWindow,
      // FE sebaiknya cuma tampilkan banner peringatan kalau ok=false DAN
      // pastScanWindow=true (supaya tidak false-alarm sebelum jam 17:00 WIB).
      warning: count === 0 && pastScanWindow
    }
  });
}

// ----------------------------------------------------------
// type=ihsg — grafik IHSG
// ----------------------------------------------------------

const RANGE_PRESETS = {
  "1bln": { range: "1mo", interval: "1d", points: 22 },
  "3bln": { range: "3mo", interval: "1d", points: 65 },
  "6bln": { range: "6mo", interval: "1d", points: 130 },
  "1thn": { range: "1y", interval: "1wk", points: 52 }
};

async function handleIhsgChart(req, res) {
  const period = RANGE_PRESETS[req.query.period] ? req.query.period : "3bln";
  const { range, interval, points } = RANGE_PRESETS[period];

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=${range}&interval=${interval}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Yahoo Finance gagal (${response.status})`);

  const json = await response.json();
  const result = json.chart.result?.[0];
  if (!result) throw new Error("Data IHSG tidak ditemukan.");

  const timestamps = result.timestamp || [];
  const closes = result.indicators.quote[0].close || [];

  const rows = timestamps
    .map((t, i) => ({ t, c: closes[i] }))
    .filter((r) => r.c !== null && r.c !== undefined);

  const trimmed = rows.slice(-points);

  const dates = trimmed.map((r) =>
    new Date(r.t * 1000).toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short"
    })
  );
  const values = trimmed.map((r) => Number(r.c.toFixed(2)));

  const latest = values.at(-1) ?? null;
  const first = values[0] ?? null;
  const prev = values.length > 1 ? values.at(-2) : null;

  const changeFromPrevPct =
    latest !== null && prev !== null ? Number((((latest - prev) / prev) * 100).toFixed(2)) : null;
  const changeFromStartPct =
    latest !== null && first !== null ? Number((((latest - first) / first) * 100).toFixed(2)) : null;

  return res.status(200).json({
    success: true,
    period,
    dates,
    values,
    latest,
    changeFromPrevPct,
    changeFromStartPct
  });
}

// ----------------------------------------------------------
// type=asia — kondisi pasar Asia
// ----------------------------------------------------------

const INDICES = [
  { symbol: "%5EJKSE", name: "IHSG", country: "Indonesia" },
  { symbol: "%5EN225", name: "Nikkei 225", country: "Jepang" },
  { symbol: "%5EHSI", name: "Hang Seng", country: "Hong Kong" },
  { symbol: "000001.SS", name: "Shanghai Composite", country: "China" },
  { symbol: "%5ESTI", name: "STI", country: "Singapura" },
  { symbol: "%5EKS11", name: "KOSPI", country: "Korea Selatan" },
  { symbol: "%5ETWII", name: "Taiwan Weighted", country: "Taiwan" }
];

async function getIndexSnapshot(index) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${index.symbol}?range=5d&interval=1d`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`status ${response.status}`);

    const json = await response.json();
    const result = json.chart.result?.[0];
    if (!result) throw new Error("data kosong");

    const closes = (result.indicators.quote[0].close || []).filter(
      (c) => c !== null && c !== undefined
    );
    if (closes.length < 1) throw new Error("closes kosong");

    const latest = closes.at(-1);
    const prev = closes.length > 1 ? closes.at(-2) : null;
    const changePct = prev ? Number((((latest - prev) / prev) * 100).toFixed(2)) : null;

    return { ...index, symbol: undefined, close: Number(latest.toFixed(2)), changePct, status: "ok" };
  } catch (e) {
    return { ...index, symbol: undefined, close: null, changePct: null, status: "error" };
  }
}

async function handleAsiaMarkets(req, res) {
  const snapshots = await Promise.all(INDICES.map(getIndexSnapshot));

  const okList = snapshots.filter((s) => s.status === "ok" && s.changePct !== null);
  const up = okList.filter((s) => s.changePct > 0).length;
  const down = okList.filter((s) => s.changePct < 0).length;

  let overallMood = "MIXED";
  if (okList.length > 0) {
    if (up >= okList.length * 0.7) overallMood = "MOSTLY_GREEN";
    else if (down >= okList.length * 0.7) overallMood = "MOSTLY_RED";
  }

  return res.status(200).json({ success: true, overallMood, upCount: up, downCount: down, data: snapshots });
}

// ----------------------------------------------------------
// type=flow — estimasi arus dana asing
// ----------------------------------------------------------

function trendPct(snapshots, field, lookback = 5) {
  const values = snapshots.map((s) => s[field]).filter((v) => v !== null && v !== undefined);
  if (values.length < 2) return null;
  const recent = values.at(-1);
  const past = values.length > lookback ? values.at(-(lookback + 1)) : values[0];
  if (!past) return null;
  return Number((((recent - past) / past) * 100).toFixed(2));
}

async function handleForeignFlow(req, res) {
  const snapshots = await getRecentMacroSnapshots(10);

  if (!snapshots.length) {
    return res.status(200).json({
      success: true,
      available: false,
      message: "Belum ada data macro_snapshot — jalankan /api/macro-scan dulu."
    });
  }

  const today = snapshots.at(-1);

  if (today.foreign_net_flow_idx !== null && today.foreign_net_flow_idx !== undefined) {
    const direction = today.foreign_net_flow_idx >= 0 ? "INFLOW" : "OUTFLOW";
    return res.status(200).json({
      success: true,
      available: true,
      mode: "actual",
      direction,
      value: today.foreign_net_flow_idx,
      snapshotDate: today.snapshot_date,
      note: "Data net flow asing diinput manual (bukan estimasi)."
    });
  }

  const dxyTrend = trendPct(snapshots, "dxy_index", 5);
  const usdidrTrend = trendPct(snapshots, "usdidr", 5);
  const ihsgTrend = trendPct(snapshots, "ihsg_close", 5);

  let score = 0;
  const reasons = [];

  if (usdidrTrend !== null) {
    if (usdidrTrend >= 1) {
      score -= 2;
      reasons.push(`Rupiah melemah ${usdidrTrend}% dalam 5 hari — indikasi tekanan outflow.`);
    } else if (usdidrTrend <= -0.5) {
      score += 1;
      reasons.push(`Rupiah menguat ${Math.abs(usdidrTrend)}% dalam 5 hari — indikasi dukungan inflow.`);
    }
  }

  if (dxyTrend !== null) {
    if (dxyTrend >= 1.5) {
      score -= 1;
      reasons.push(`DXY menguat ${dxyTrend}% dalam 5 hari — dolar kuat, tekanan ke emerging market.`);
    } else if (dxyTrend <= -1.5) {
      score += 1;
      reasons.push(`DXY melemah ${Math.abs(dxyTrend)}% dalam 5 hari — kondusif untuk emerging market.`);
    }
  }

  if (ihsgTrend !== null) {
    if (ihsgTrend >= 2) {
      score += 1;
      reasons.push(`IHSG naik ${ihsgTrend}% dalam 5 hari — konsisten dengan dana masuk.`);
    } else if (ihsgTrend <= -2) {
      score -= 1;
      reasons.push(`IHSG turun ${ihsgTrend}% dalam 5 hari — konsisten dengan dana keluar.`);
    }
  }

  let direction = "NEUTRAL";
  if (score >= 2) direction = "INFLOW";
  else if (score <= -2) direction = "OUTFLOW";

  if (!reasons.length) {
    reasons.push("Belum cukup data tren untuk mengestimasi arah arus dana asing.");
  }

  return res.status(200).json({
    success: true,
    available: true,
    mode: "estimate",
    direction,
    score,
    dxyTrend,
    usdidrTrend,
    ihsgTrend,
    snapshotDate: today.snapshot_date,
    reasons,
    note: "Estimasi proxy dari tren DXY/USD-IDR/IHSG — bukan data net buy/sell asing resmi IDX."
  });
}

// ----------------------------------------------------------
// type=news — berita pasar umum
// ----------------------------------------------------------

async function handleMarketNews(req, res) {
  const items = await fetchMarketNews();
  return res.status(200).json({ success: true, data: items });
}

// ----------------------------------------------------------
// Router
// ----------------------------------------------------------

export default async function handler(req, res) {
  try {
    const type = req.query.type;

    if (type === "ihsg") return await handleIhsgChart(req, res);
    if (type === "asia") return await handleAsiaMarkets(req, res);
    if (type === "flow") return await handleForeignFlow(req, res);
    if (type === "news") return await handleMarketNews(req, res);
    if (type === "scanhealth") return await handleScanHealth(req, res);

    return res.status(400).json({
      success: false,
      message: "Parameter ?type= wajib diisi salah satu: ihsg, asia, flow, news, scanhealth."
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil data dashboard.",
      error: error.message
    });
  }
}
