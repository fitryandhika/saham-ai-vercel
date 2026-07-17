export function generateWarnings({
  score,
  signal,
  rsi,
  riskReward,
  volume,
  atr,
  close,
  closingStrength,
  relativeStrength
}) {

  const warnings = [];

  // STRONG BUY (score >= 90) — observasi awal (baru 2 hari data,
  // sample kecil, BUKAN kesimpulan final) menunjukkan bucket skor
  // tertinggi ini justru konsisten underperform next-day dua sesi
  // berturut-turut, lebih buruk dari BUY biasa. Kemungkinan skor
  // setinggi ini menangkap saham yang sudah euforia/overextended
  // dan rawan profit-taking besok pagi. Ini FLAG untuk dipantau,
  // bukan alasan mengubah bobot scorer.js — perlu lebih banyak
  // data (mingguan) sebelum ditarik kesimpulan struktural.
  if (signal === "STRONG BUY" || score >= 90) {
    warnings.push(
      "Skor sangat tinggi (STRONG BUY) — data historis awal aplikasi ini (masih sedikit, perlu dipantau lebih lanjut) menunjukkan saham dengan skor setinggi ini justru rawan profit-taking di sesi berikutnya. Pertimbangkan entry lebih hati-hati dibanding sinyal BUY biasa."
    );
  }

  if (rsi >= 70) {
    warnings.push(
      "RSI berada di area overbought, potensi koreksi meningkat."
    );
  }

  if (riskReward < 1.5) {
    warnings.push(
      "Risk/Reward belum ideal."
    );
  }

  if (volume && volume.signal === "LOW") {
    warnings.push(
      "Kenaikan harga belum didukung volume yang kuat."
    );
  }

  if (atr && close) {
    const atrPercent = (atr / close) * 100;

    if (atrPercent >= 8) {
      warnings.push(
        `Volatilitas sangat tinggi (ATR ${atrPercent.toFixed(1)}% dari harga) — saham tipis/berisiko, sinyal teknikal lebih tidak reliabel.`
      );
    } else if (atrPercent >= 5) {
      warnings.push(
        `Volatilitas di atas normal (ATR ${atrPercent.toFixed(1)}% dari harga) — gunakan ukuran posisi lebih kecil.`
      );
    }
  }

  if (typeof closingStrength === "number" && closingStrength < 0.2) {
    warnings.push(
      "Close dekat low hari ini — seller dominan menjelang penutupan, waspada gap-down."
    );
  }

  if (relativeStrength && relativeStrength.label === "JAUH UNDERPERFORM") {
    warnings.push(
      "Saham jauh underperform IHSG/sektor — kenaikan (kalau ada) lebih lemah dari pasar."
    );
  }

  if (warnings.length === 0) {
    warnings.push(
      "Tidak ada peringatan penting."
    );
  }

  return warnings;
}
