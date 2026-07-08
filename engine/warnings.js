export function generateWarnings({
  rsi,
  riskReward,
  volume,
  atr,
  close
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

  if (warnings.length === 0) {
    warnings.push(
      "Tidak ada peringatan penting."
    );
  }

  return warnings;
}
