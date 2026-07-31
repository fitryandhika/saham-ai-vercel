// ==========================
// IHSG Chart — /api/ihsg-chart
// ==========================
//
// Endpoint ringan khusus buat grafik IHSG di Dashboard. Beda dengan
// services/marketService.js (yang cuma nyimpen array closes buat hitung
// Relative Strength), di sini kita butuh TANGGAL juga buat sumbu-x
// grafik, jadi fetch langsung ke Yahoo Finance chart endpoint sendiri
// (pola sama seperti services/marketService.js dan macroFetchService.js).

const RANGE_PRESETS = {
  "1bln": { range: "1mo", interval: "1d", points: 22 },
  "3bln": { range: "3mo", interval: "1d", points: 65 },
  "6bln": { range: "6mo", interval: "1d", points: 130 },
  "1thn": { range: "1y", interval: "1wk", points: 52 }
};

export default async function handler(req, res) {
  try {
    const period = RANGE_PRESETS[req.query.period] ? req.query.period : "3bln";
    const { range, interval, points } = RANGE_PRESETS[period];

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=${range}&interval=${interval}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Yahoo Finance gagal (${response.status})`);
    }

    const json = await response.json();
    const result = json.chart.result?.[0];

    if (!result) {
      throw new Error("Data IHSG tidak ditemukan.");
    }

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
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil grafik IHSG.",
      error: error.message
    });
  }
}
