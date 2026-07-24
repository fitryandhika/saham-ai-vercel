// ==========================
// Liquidity Guard — deteksi saham "beku" / tidak likuid
// ==========================
//
// Latar belakang: analisa scan_history 15-23 Juli 2026 menemukan 27
// saham yang berulang kali muncul dengan harga sama sekali tidak
// bergerak berhari-hari (mis. TELE stuck di Rp9 selama 7 hari penuh),
// termasuk beberapa persis di Rp50 (floor price resmi BEI / "gocap").
// Saham begini rutin membuat RSI mentok di titik ekstrem (lihat bug
// yang sudah diperbaiki di technical.js) dan mendominasi kandidat
// STRONG SELL — 95% dari total STRONG SELL minggu itu adalah saham
// kelompok ini, tanpa nilai sinyal apa pun karena memang tidak ada
// transaksi wajar untuk disimpulkan arahnya.
//
// Guard ini TIDAK menghapus baris dari histori (tetap dicatat untuk
// training/dataset — negative example tetap berguna), tapi menandai
// saham ini supaya:
//   1. Tidak masuk daftar hasil screener yang ditampilkan ke user
//      (di api/scan.js) — karena tidak actionable untuk beli-sore.
//   2. Tidak dinilai session_gain_score seperti saham normal.

const IDX_FLOOR_PRICE = 50; // Auto Reject Bawah — harga minimum resmi BEI

// Berapa hari ke belakang dicek untuk pola "harga beku".
const FROZEN_LOOKBACK_DAYS = 5;

/**
 * @param {Array<{open:number, high:number, low:number, close:number, volume:number}>} candles
 *   Candle harian terurut naik berdasarkan tanggal (candles.at(-1) = hari terakhir/terbaru).
 * @param {{ lookback?: number }} [opts]
 * @returns {{ illiquid: boolean, reason: string|null, detail: string|null }}
 */
export function checkLiquidity(candles, { lookback = FROZEN_LOOKBACK_DAYS } = {}) {
  if (!candles || candles.length === 0) {
    return { illiquid: false, reason: null, detail: null };
  }

  const last = candles.at(-1);
  const lastClose = last.close;

  // 1) Harga di / di bawah floor price resmi BEI — saham distressed,
  //    tidak bisa turun lagi, biasanya juga nyaris tanpa transaksi.
  if (lastClose <= IDX_FLOOR_PRICE) {
    return {
      illiquid: true,
      reason: "FLOOR_PRICE",
      detail: `Close Rp${lastClose} <= floor price BEI Rp${IDX_FLOOR_PRICE}`
    };
  }

  // 2) Hari terakhir sama sekali tidak ada range (open=high=low=close)
  //    -> kemungkinan besar tidak ada transaksi/perdagangan hari itu.
  if (last.high === last.low && last.low === last.close && last.close === last.open) {
    return {
      illiquid: true,
      reason: "NO_RANGE_TODAY",
      detail: "High = Low = Open = Close hari ini (indikasi tidak ada transaksi)"
    };
  }

  // 3) Harga close IDENTIK selama beberapa hari berturut-turut -> beku/suspend.
  if (candles.length >= lookback) {
    const recent = candles.slice(-lookback);
    const allSame = recent.every((c) => c.close === recent[0].close);

    if (allSame) {
      return {
        illiquid: true,
        reason: "FROZEN_PRICE",
        detail: `Close tidak berubah selama ${lookback} hari bursa terakhir (Rp${recent[0].close})`
      };
    }
  }

  return { illiquid: false, reason: null, detail: null };
}

export default checkLiquidity;
