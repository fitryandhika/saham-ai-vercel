// ==========================
// Batch Scanner — Semua Emiten
// ==========================
//
// Menggantikan pola lama (frontend loop fetch /api/analyze satu-satu
// per kode, ratusan request sekuensial dari browser). Di sini semua
// emiten di-scan SERVER-SIDE dengan concurrency pool, jadi:
//   1. Jauh lebih cepat (paralel, bukan sekuensial di HP).
//   2. Relative Strength vs sektor bisa dihitung (butuh data semua
//      peer sektor dalam satu batch yang sama).
//   3. Satu response berisi hasil sudah diranking, siap dipakai untuk
//      alert / notifikasi otomatis di masa depan (bukan cuma UI).
//
// Vercel Hobby plan default timeout 10s — kalau universe penuh (~240
// kode) tidak selesai dalam waktu itu, upgrade ke Pro (maxDuration di
// bawah) atau kecilkan lewat query ?limit=100.

import { analyzeStock } from "../engine/analyzer.js";
import { getStockData } from "../services/stockService.js";
import { getIhsgCloses } from "../services/marketService.js";
import { nDayReturn } from "../engine/relativeStrength.js";
import { UNIVERSE, getSector } from "../config/universe.js";

// Butuh Vercel Pro (atau plan dengan maxDuration lebih besar) untuk scan
// universe penuh. Di Hobby, function akan terpotong di ~10s — pakai
// ?limit= untuk scan sebagian kalau masih di Hobby plan.
export const config = {
  maxDuration: 60
};

const CONCURRENCY = 12;
const RETURN_PERIOD = 20; // n-hari untuk relative strength

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { error: e.message };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, next)
  );

  return results;
}

export default async function handler(req, res) {
  try {
    const {
      limit,
      minScore,
      maxPrice,
      sector,
      onlyBreakout
    } = req.query;

    let kodeList = UNIVERSE;

    if (limit) {
      const n = parseInt(limit, 10);
      if (Number.isFinite(n) && n > 0) kodeList = kodeList.slice(0, n);
    }

    if (sector) {
      kodeList = kodeList.filter(
        (k) => getSector(k).toLowerCase() === String(sector).toLowerCase()
      );
    }

    const ihsgCloses = await getIhsgCloses();

    // ==========================
    // Tahap 1 — fetch data candle semua kode (paralel, concurrency-limited)
    // ==========================
    const fetched = await runPool(
      kodeList,
      async (kode) => {
        const stockData = await getStockData(kode);
        const stockReturn = nDayReturn(stockData.closePrices, RETURN_PERIOD);
        return { kode, stockData, stockReturn, sector: getSector(kode) };
      },
      CONCURRENCY
    );

    const ok = fetched.filter((f) => f && !f.error);
    const failed = fetched
      .map((f, i) => (f && f.error ? kodeList[i] : null))
      .filter(Boolean);

    // ==========================
    // Tahap 2 — rata-rata return per sektor dari hasil batch ini sendiri
    // ==========================
    const sectorReturns = {};
    const sectorGroups = {};

    for (const item of ok) {
      if (item.stockReturn === null) continue;
      if (!sectorGroups[item.sector]) sectorGroups[item.sector] = [];
      sectorGroups[item.sector].push(item.stockReturn);
    }

    for (const [sec, returns] of Object.entries(sectorGroups)) {
      sectorReturns[sec] =
        returns.reduce((a, b) => a + b, 0) / returns.length;
    }

    // ==========================
    // Tahap 3 — analyzeStock() penuh per kode, dengan RS vs IHSG & sektor
    // ==========================
    const analyzed = ok.map((item) => {
      item.stockData.ihsgCloses = ihsgCloses;
      item.stockData.sectorReturn = sectorReturns[item.sector] ?? null;
      item.stockData.sector = item.sector;

      const hasil = analyzeStock(item.stockData);
      hasil.sector = item.sector;
      return hasil;
    });

    // ==========================
    // Filter opsional
    // ==========================
    let hasilFilter = analyzed;

    if (minScore) {
      const n = parseInt(minScore, 10);
      if (Number.isFinite(n)) hasilFilter = hasilFilter.filter((d) => d.score >= n);
    }

    if (maxPrice) {
      const n = parseFloat(maxPrice);
      if (Number.isFinite(n)) hasilFilter = hasilFilter.filter((d) => d.close < n);
    }

    if (onlyBreakout === "true") {
      hasilFilter = hasilFilter.filter((d) => d.breakout && d.breakout.isBreakout);
    }

    // Ranking: breakout dulu (sinyal paling actionable untuk beli sore),
    // baru diurut berdasarkan rank komposit (score + confidence + RR).
    hasilFilter.sort((a, b) => {
      const aBreak = a.breakout && a.breakout.isBreakout ? 1 : 0;
      const bBreak = b.breakout && b.breakout.isBreakout ? 1 : 0;
      if (aBreak !== bBreak) return bBreak - aBreak;
      return b.rank - a.rank;
    });

    return res.status(200).json({
      success: true,
      scanned: kodeList.length,
      succeeded: ok.length,
      failed: failed.length,
      failedCodes: failed,
      breakoutCount: analyzed.filter((d) => d.breakout && d.breakout.isBreakout).length,
      data: hasilFilter
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Batch scan gagal.",
      error: error.message
    });
  }
}
