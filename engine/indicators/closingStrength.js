// ==========================
// Closing Strength
// ==========================
//
// (close - low) / (high - low) — makin dekat ke 1, makin dekat close
// ke high hari itu -> buyer dominan sampai penutupan, sering
// mendahului gap-up esok pagi. Makin dekat ke 0 -> seller yang
// menekan sampai akhir sesi, meski hari itu ditutup hijau sekalipun.

export function calculateClosingStrength(candle) {
  if (!candle) return null;

  const { high, low, close } = candle;
  const range = high - low;

  // Range nol (limit/no-trade day) -> netral, bukan sinyal kuat/lemah.
  if (!range || range <= 0) return 0.5;

  const strength = (close - low) / range;

  return Number(Math.max(0, Math.min(1, strength)).toFixed(3));
}

export function classifyClosingStrength(strength) {
  if (strength === null) return "UNKNOWN";
  if (strength >= 0.8) return "SANGAT_KUAT"; // close dekat high, buyer dominan
  if (strength >= 0.6) return "KUAT";
  if (strength >= 0.4) return "NETRAL";
  if (strength >= 0.2) return "LEMAH";
  return "SANGAT_LEMAH"; // close dekat low, seller dominan
}

export default calculateClosingStrength;
