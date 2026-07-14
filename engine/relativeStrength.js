// ==========================
// Relative Strength vs IHSG & Sektor
// ==========================
//
// RS vs IHSG: return N-hari saham dikurangi return N-hari IHSG.
// Positif -> saham outperform pasar, bukan cuma ikut naik rame-rame.
//
// RS vs sektor: return N-hari saham dikurangi rata-rata return N-hari
// saham lain di sektor yang sama (dihitung dari batch scan itu sendiri,
// bukan indeks sektor eksternal terpisah — lihat config/universe.js).

export function nDayReturn(closes, period = 20) {
  if (!closes || closes.length <= period) return null;

  const current = closes.at(-1);
  const past = closes.at(-(period + 1));

  if (!past) return null;

  return Number((((current - past) / past) * 100).toFixed(2));
}

export function calculateRelativeStrength({
  stockReturn,
  ihsgReturn = null,
  sectorReturn = null
}) {
  if (stockReturn === null || stockReturn === undefined) {
    return {
      vsIhsg: null,
      vsSector: null,
      label: "TIDAK TERSEDIA"
    };
  }

  const vsIhsg = ihsgReturn === null || ihsgReturn === undefined
    ? null
    : Number((stockReturn - ihsgReturn).toFixed(2));

  const vsSector = sectorReturn === null || sectorReturn === undefined
    ? null
    : Number((stockReturn - sectorReturn).toFixed(2));

  let label = "NETRAL";

  // Prioritaskan vs IHSG kalau tersedia, karena itu tolok ukur pasar
  // yang lebih relevan untuk keputusan beli-sore; vs sektor jadi
  // konfirmasi tambahan.
  const primary = vsIhsg !== null ? vsIhsg : vsSector;

  if (primary !== null) {
    if (primary >= 5) label = "JAUH OUTPERFORM";
    else if (primary >= 1.5) label = "OUTPERFORM";
    else if (primary <= -5) label = "JAUH UNDERPERFORM";
    else if (primary <= -1.5) label = "UNDERPERFORM";
  }

  return { vsIhsg, vsSector, label };
}

export default calculateRelativeStrength;
