// ==========================
// IDX Official Data Service
// ==========================
//
// Sumber: endpoint publik (tidak resmi didokumentasikan, tapi dipakai
// luas oleh developer) di situs resmi idx.co.id untuk trading summary
// harian per saham — jauh lebih presisi dari Yahoo karena datanya
// langsung dari bursa, bukan estimasi pihak ketiga.
//
// CATATAN: situs IDX beberapa kali ganti struktur, jadi fungsi ini
// mencoba beberapa kemungkinan path. Kalau SEMUA gagal, return null
// supaya caller bisa fallback ke Yahoo tanpa error fatal.
//
// Kalau di kemudian hari ini berhenti berfungsi total, cek dari browser
// desktop: buka https://www.idx.co.id/en/market-data/trading-summary/stock-summary
// lalu buka DevTools > Network > filter "XHR/Fetch", cari request yang
// mengembalikan JSON data saham, copy URL-nya ke sini.

function formatDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function tryFetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json;
  } catch (e) {
    console.error("idxService fetch error:", url, e.message);
    return null;
  }
}

function findStockRow(json, kode) {
  // Struktur umum: { data: [ { StockCode, Close, OpenPrice, High, Low, Volume, Value, ... } ] }
  const rows = json?.data || json?.Data || json?.results || [];
  if (!Array.isArray(rows)) return null;

  return rows.find(
    (r) =>
      (r.StockCode || r.Code || r.stock_code || "").toUpperCase() === kode.toUpperCase()
  ) || null;
}

async function fetchForDate(kode, dateStr) {
  const candidates = [
    `https://www.idx.co.id/primary/TradingSummary/GetStockSummary?date=${dateStr}&start=0&length=9999`,
    `https://www.idx.co.id/umbraco/Surface/TradingSummary/GetStockSummary?date=${dateStr}&start=0&length=9999`
  ];

  for (const url of candidates) {
    const json = await tryFetchJson(url);
    if (!json) continue;

    const row = findStockRow(json, kode);
    if (row) return row;
  }

  return null;
}

export async function getOfficialTodayData(kode) {
  const now = new Date();

  // IDX belum publish data "hari ini" sebelum market close (~16:00 WIB).
  // Kalau dipanggil pagi/siang, coba data hari kerja terakhir yang tersedia.
  for (let daysBack = 0; daysBack <= 5; daysBack++) {
    const d = new Date(now);
    d.setDate(d.getDate() - daysBack);

    const day = d.getDay();
    if (day === 0 || day === 6) continue; // skip weekend

    const dateStr = formatDateYYYYMMDD(d);
    const row = await fetchForDate(kode, dateStr);

    if (row) {
      const open = Number(row.OpenPrice ?? row.Open ?? row.open_price);
      const high = Number(row.High ?? row.high);
      const low = Number(row.Low ?? row.low);
      const close = Number(row.Close ?? row.close);
      const volume = Number(row.Volume ?? row.volume);

      if ([open, high, low, close, volume].some((v) => !Number.isFinite(v))) {
        continue;
      }

      return {
        date: d.toISOString().split("T")[0],
        open,
        high,
        low,
        close,
        volume,
        source: "IDX_OFFICIAL"
      };
    }
  }

  return null;
}