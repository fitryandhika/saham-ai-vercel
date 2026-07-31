// ==========================
// Kondisi Pasar Asia — /api/asia-markets
// ==========================
//
// Snapshot indeks-indeks utama bursa Asia (termasuk IHSG sendiri
// sebagai referensi) buat widget "Kondisi Pasar Asia" di Dashboard.
// Sumber sama seperti services/marketService.js — Yahoo Finance chart
// endpoint, tanpa API key. Fetch paralel per simbol, best-effort:
// satu simbol gagal tidak menggagalkan simbol lain.

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

    return {
      ...index,
      symbol: undefined,
      close: Number(latest.toFixed(2)),
      changePct,
      status: "ok"
    };
  } catch (e) {
    return { ...index, symbol: undefined, close: null, changePct: null, status: "error" };
  }
}

export default async function handler(req, res) {
  try {
    const snapshots = await Promise.all(INDICES.map(getIndexSnapshot));

    const okList = snapshots.filter((s) => s.status === "ok" && s.changePct !== null);
    const up = okList.filter((s) => s.changePct > 0).length;
    const down = okList.filter((s) => s.changePct < 0).length;

    let overallMood = "MIXED";
    if (okList.length > 0) {
      if (up >= okList.length * 0.7) overallMood = "MOSTLY_GREEN";
      else if (down >= okList.length * 0.7) overallMood = "MOSTLY_RED";
    }

    return res.status(200).json({
      success: true,
      overallMood,
      upCount: up,
      downCount: down,
      data: snapshots
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil kondisi pasar Asia.",
      error: error.message
    });
  }
}
