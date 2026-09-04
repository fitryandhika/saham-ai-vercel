// ==========================
// Pattern Detectors — Reversal & Capitulation Bounce
// ==========================
//
// Dipindah dari engine/scorer.js (4 September 2026) saat scorer.js
// (skor & signal teknikal lama) dihapus — dua fungsi ini TIDAK ada
// hubungannya dengan skor/signal, jadi dipisah ke sini supaya badge
// "🔄 Reversal Candidate" dan "⚡ Capitulation Bounce" di kartu Analisa
// tetap jalan.
//
// Bonus skornya di scorer.js sudah lama di-nonaktifkan (kill-switch,
// win rate di bawah baseline saat diuji ulang) — yang tersisa dan
// masih dipakai cuma flag boolean-nya untuk badge & pencatatan ke
// scan_history (reversal_candidate/capitulation_bounce_candidate),
// bukan sebagai poin tambahan ke skor manapun.
// ==========================

// Dipisah jadi fungsi sendiri (bukan cuma inline di skor) supaya
// analyzer.js bisa attach flag-nya ke hasil (d.reversalCandidate)
// untuk dicatat & dievaluasi terpisah.
export function isReversalCandidate(data) {
  return Boolean(
    data.relativeStrength &&
    (data.relativeStrength.label === "UNDERPERFORM" || data.relativeStrength.label === "JAUH UNDERPERFORM") &&
    typeof data.rsi === "number" && data.rsi < 60 &&
    data.macd && data.macd.macd < 0 &&
    typeof data.close === "number" && typeof data.sma50 === "number" && data.close > data.sma50 &&
    typeof data.closingStrength === "number" && data.closingStrength >= 0.3
  );
}

// Sama filosofinya dengan isReversalCandidate: dipisah jadi fungsi sendiri
// supaya analyzer.js bisa attach flag-nya ke hasil
// (d.capitulationBounceCandidate) untuk dicatat & dievaluasi terpisah.
export function isCapitulationBounceCandidate(data) {
  return Boolean(
    data.relativeStrength &&
    (data.relativeStrength.label === "UNDERPERFORM" || data.relativeStrength.label === "JAUH UNDERPERFORM") &&
    typeof data.rsi === "number" && data.rsi >= 40 && data.rsi <= 55 &&
    data.macd && data.macd.macd < 0 &&
    typeof data.close === "number" && typeof data.sma50 === "number" && data.close < data.sma50 &&
    typeof data.closingStrength === "number" && data.closingStrength >= 0.3
  );
}
