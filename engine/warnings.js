export function generateWarnings({
  rsi,
  riskReward,
  volume
}) {

  const warnings = [];

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

  if (warnings.length === 0) {
    warnings.push(
      "Tidak ada peringatan penting."
    );
  }

  return warnings;
}