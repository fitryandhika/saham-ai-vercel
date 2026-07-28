// ==========================
// Market Regime — Layer Fundamental Makro
// ==========================
//
// Tujuan: tahu ARAH MARKET dulu (risk-on / risk-off / netral) sebelum
// percaya sinyal BUY dari saham manapun — konsisten dengan pola blend
// yang sudah ada di analyzer.js (skor teknikal 80% + fundamental 20%,
// lihat engine/fundamental.js). Di sini market_regime_score dipakai
// sebagai LAPISAN TERPISAH di atas score gabungan itu, bukan
// menggantikannya — supaya scan_history tetap konsisten dengan data
// yang sudah dikumpulkan (kolom `score` lama tidak berubah arti).
//
// Regime dihitung dari data yang TERSEDIA saja (nullable-safe): yield
// spread 10Y-2Y, tren DXY, tren IHSG. bi_rate & foreign_net_flow_idx
// dipakai kalau ada datanya (manual), tapi tidak wajib.

const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

// Bandingkan nilai terbaru vs N hari sebelumnya dari array snapshot
// (terurut lama->baru), return persen perubahan atau null kalau data
// kurang.
function trendPct(snapshots, field, lookback = 5) {
  const values = snapshots
    .map((s) => s[field])
    .filter((v) => v !== null && v !== undefined);

  if (values.length < 2) return null;

  const recent = values.at(-1);
  const past = values.length > lookback ? values.at(-(lookback + 1)) : values[0];

  if (!past) return null;

  return Number((((recent - past) / past) * 100).toFixed(2));
}

// snapshots: array hasil getRecentMacroSnapshots() (lama -> baru),
// baris terakhir dianggap "hari ini".
export function classifyMarketRegime(snapshots = []) {
  if (!snapshots.length) {
    return {
      regime: "NEUTRAL",
      regimeScore: 50,
      label: "DATA MAKRO TIDAK TERSEDIA",
      reasons: ["Belum ada data macro_snapshot — regime dinetralkan (tidak menghukum/menguntungkan)."]
    };
  }

  const today = snapshots.at(-1);
  const reasons = [];
  let score = 50; // 50 = netral, >50 = risk-on, <50 = risk-off

  // Yield spread 10Y-2Y — inversi (negatif) historisnya sinyal
  // resesi/risk-off; spread melebar = risk-on.
  if (today.yield_spread_10y2y !== null && today.yield_spread_10y2y !== undefined) {
    if (today.yield_spread_10y2y < 0) {
      score -= 15;
      reasons.push(`Yield curve US 10Y-2Y inverted (${today.yield_spread_10y2y}) — sinyal risk-off/resesi.`);
    } else if (today.yield_spread_10y2y < 0.3) {
      score -= 5;
      reasons.push(`Yield spread 10Y-2Y tipis (${today.yield_spread_10y2y}) — waspada.`);
    } else {
      score += 5;
      reasons.push(`Yield spread 10Y-2Y positif dan sehat (${today.yield_spread_10y2y}).`);
    }
  }

  // DXY (Dollar Index) tren 5 hari — dolar menguat tajam biasanya
  // tekanan untuk aset emerging market termasuk IHSG.
  const dxyTrend = trendPct(snapshots, "dxy_index", 5);
  if (dxyTrend !== null) {
    if (dxyTrend >= 1.5) {
      score -= 12;
      reasons.push(`DXY menguat ${dxyTrend}% dalam 5 hari — tekanan risk-off untuk emerging market.`);
    } else if (dxyTrend <= -1.5) {
      score += 10;
      reasons.push(`DXY melemah ${dxyTrend}% dalam 5 hari — kondusif untuk emerging market.`);
    }
  }

  // IHSG sendiri tren 5 hari — konfirmasi arah market lokal langsung.
  const ihsgTrend = trendPct(snapshots, "ihsg_close", 5);
  if (ihsgTrend !== null) {
    if (ihsgTrend >= 2) {
      score += 12;
      reasons.push(`IHSG naik ${ihsgTrend}% dalam 5 hari — momentum market lokal positif.`);
    } else if (ihsgTrend <= -2) {
      score -= 12;
      reasons.push(`IHSG turun ${ihsgTrend}% dalam 5 hari — momentum market lokal negatif.`);
    }
  }

  // USD/IDR tren — rupiah melemah tajam biasanya berbarengan dengan
  // outflow asing.
  const usdidrTrend = trendPct(snapshots, "usdidr", 5);
  if (usdidrTrend !== null && usdidrTrend >= 1.5) {
    score -= 8;
    reasons.push(`Rupiah melemah ${usdidrTrend}% dalam 5 hari terhadap USD — indikasi tekanan outflow.`);
  }

  // Foreign net flow — kalau datanya ada (manual/opsional).
  if (today.foreign_net_flow_idx !== null && today.foreign_net_flow_idx !== undefined) {
    if (today.foreign_net_flow_idx < 0) {
      score -= 8;
      reasons.push("Net flow asing negatif (net sell) di IDX.");
    } else if (today.foreign_net_flow_idx > 0) {
      score += 8;
      reasons.push("Net flow asing positif (net buy) di IDX.");
    }
  }

  score = clamp(Math.round(score), 0, 100);

  let regime = "NEUTRAL";
  if (score >= 65) regime = "RISK_ON";
  else if (score <= 35) regime = "RISK_OFF";

  let label = "MARKET NETRAL";
  if (regime === "RISK_ON") label = "RISK-ON — kondusif untuk sinyal BUY";
  else if (regime === "RISK_OFF") label = "RISK-OFF — sinyal BUY perlu ekstra hati-hati";

  if (!reasons.length) {
    reasons.push("Data makro tersedia tapi belum ada sinyal kuat ke arah manapun.");
  }

  return { regime, regimeScore: score, label, reasons };
}

// Adjustment ke score saham (0-100) berdasarkan regime — LAPISAN
// TERPISAH dari score asli, dipakai untuk kolom score_adjusted &
// (opsional, lihat api/scan.js) untuk menurunkan urutan ranking saat
// risk-off, TANPA mengubah kolom `score` asli yang sudah dipakai
// dataset training sebelumnya.
//
// Skala penyesuaian sengaja kecil (maks ±8) — layer makro ini adalah
// FILTER/KONTEKS, bukan penentu utama; strategi beli-sore-jual-pagi
// tetap didominasi price action per saham (lihat komentar serupa di
// analyzer.js soal bobot fundamental 20%).
export function applyRegimeAdjustment(score, regimeScore) {
  if (typeof score !== "number" || typeof regimeScore !== "number") return score;

  // regimeScore 50 = netral (adjustment 0), 100 = risk-on penuh (+8),
  // 0 = risk-off penuh (-8).
  const adjustment = Math.round(((regimeScore - 50) / 50) * 8);
  return clamp(score + adjustment, 0, 100);
}

export default classifyMarketRegime;
