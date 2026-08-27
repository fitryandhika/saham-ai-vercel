// ==========================
// Intraday Exit Reasoning — Watchlist Besok
// ==========================
//
// Ditambahkan untuk fitur "Watchlist Besok": begitu posisi beli-sore
// sudah masuk hari H+1, modul ini menilai APAKAH SEBAIKNYA JUAL
// SEKARANG atau MASIH LAYAK DI-HOLD, berdasarkan candle intraday
// real-time (dari services/realtimeIntradayService.js) hari itu.
//
// PRINSIP: setiap verdict WAJIB punya alasan yang bisa ditelusuri ke
// angka nyata (VWAP, high sesi, volume) — bukan ambang sembarangan
// seperti "-3% dari high". Gaya penilaian sama seperti
// engine/indicators/exhaustion.js & distribution.js: score + reasons[].
//
// EMPAT SINYAL:
//   1. Posisi vs VWAP sesi berjalan — di bawah VWAP = tekanan jual
//      mulai dominan (standar acuan intraday trader).
//   2. Jarak harga sekarang ke titik tertinggi sesi (sessionHigh) —
//      makin jauh, makin besar potensi profit sudah diambil pasar.
//   3. Waktu sejak high terakhir dibuat — makin lama tanpa rekor
//      baru sementara harga menjauh dari high, makin besar tanda
//      momentum sudah mandek (bukan cuma koreksi sesaat).
//   4. Tren volume — volume mengecil di dekat high (minat beli
//      mengering) ATAU volume melonjak saat harga turun (tekanan
//      jual nyata, bukan cuma sepi transaksi).
//
// CATATAN JUJUR: baru dipasang, belum divalidasi dari data outcome
// nyata (beda dengan scorer utama yang sudah dikalibrasi dari ribuan
// baris scan_history). Bobot di bawah adalah titik awal yang masuk
// akal secara teknikal, BUKAN hasil backtest. Perlu dikumpulkan dulu
// datanya (lihat exit_reason yang dicatat pas user tandai "Sudah
// Dijual" di watchlist) sebelum bobotnya dikalibrasi ulang.

const MIN_CANDLES_FOR_VALID_READ = 5;

function minutesBetweenHHMM(fromHHMM, toHHMM) {
  if (!fromHHMM || !toHHMM) return null;

  const [fh, fm] = fromHHMM.split(":").map(Number);
  const [th, tm] = toHHMM.split(":").map(Number);

  if (![fh, fm, th, tm].every(Number.isFinite)) return null;

  return (th * 60 + tm) - (fh * 60 + fm);
}

function computeVWAP(candles) {
  let sumPV = 0;
  let sumV = 0;

  for (const c of candles) {
    const vol = Number(c.volume) || 0;
    if (vol <= 0) continue;

    const typicalPrice = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;

    sumPV += typicalPrice * vol;
    sumV += vol;
  }

  if (sumV <= 0) return null;

  return sumPV / sumV;
}

function findSessionHigh(candles) {
  let high = -Infinity;
  let highIndex = -1;

  candles.forEach((c, i) => {
    const h = Number(c.high);
    if (Number.isFinite(h) && h >= high) {
      high = h;
      highIndex = i;
    }
  });

  if (highIndex === -1) return null;

  return { high, index: highIndex, timeWIB: candles[highIndex].timeWIB };
}

function computeVolumeTrend(candles, recentN = 5) {
  if (candles.length < recentN + 3) return null;

  const recent = candles.slice(-recentN);
  const before = candles.slice(0, -recentN);

  const avgRecent = recent.reduce((s, c) => s + (Number(c.volume) || 0), 0) / recent.length;
  const avgBefore = before.reduce((s, c) => s + (Number(c.volume) || 0), 0) / before.length;

  if (avgBefore <= 0) return null;

  const trendPct = ((avgRecent - avgBefore) / avgBefore) * 100;

  return { trendPct, avgRecent, avgBefore };
}

export function calculateIntradayExit({ candles }) {

  if (!candles || candles.length < MIN_CANDLES_FOR_VALID_READ) {
    return {
      verdict: "BELUM_CUKUP_DATA",
      label: "Data Belum Cukup",
      score: null,
      reasons: [
        `Baru ada ${candles ? candles.length : 0} candle sesi ini — minimal ${MIN_CANDLES_FOR_VALID_READ} candle diperlukan supaya penilaian valid, bukan tebakan.`
      ],
      vwap: null,
      sessionHigh: null,
      currentPrice: candles && candles.length ? Number(candles.at(-1).close) : null,
      distanceFromHighPct: null,
      minutesSinceHigh: null,
      volumeTrendPct: null
    };
  }

  const reasons = [];
  let score = 0;

  const currentPrice = Number(candles.at(-1).close);
  const currentTimeWIB = candles.at(-1).timeWIB;

  const vwap = computeVWAP(candles);
  const sessionHighInfo = findSessionHigh(candles);
  const sessionHigh = sessionHighInfo ? sessionHighInfo.high : null;
  const volTrend = computeVolumeTrend(candles);

  // --------------------------------------------------------
  // 1. Posisi vs VWAP
  // --------------------------------------------------------
  let vwapDistPct = null;

  if (vwap && vwap > 0) {
    vwapDistPct = ((currentPrice - vwap) / vwap) * 100;

    if (currentPrice < vwap) {
      score += 25;
      reasons.push(
        `Harga sekarang ${Math.abs(vwapDistPct).toFixed(1)}% di bawah VWAP sesi (${vwap.toFixed(0)}) — momentum beli melemah.`
      );
    } else {
      reasons.push(
        `Harga masih ${vwapDistPct.toFixed(1)}% di atas VWAP sesi (${vwap.toFixed(0)}) — pembeli masih pegang kendali.`
      );
    }
  }

  // --------------------------------------------------------
  // 2. Jarak dari sessionHigh
  // --------------------------------------------------------
  let distanceFromHighPct = null;

  if (sessionHigh && sessionHigh > 0) {
    distanceFromHighPct = ((sessionHigh - currentPrice) / sessionHigh) * 100;

    if (distanceFromHighPct >= 5) {
      score += 30;
      reasons.push(
        `Sudah turun ${distanceFromHighPct.toFixed(1)}% dari titik tertinggi sesi (${sessionHigh.toFixed(0)}) — potensi profit besar sudah lewat.`
      );
    } else if (distanceFromHighPct >= 2) {
      score += 15;
      reasons.push(
        `Turun ${distanceFromHighPct.toFixed(1)}% dari tertinggi sesi (${sessionHigh.toFixed(0)}), mulai ada tekanan jual.`
      );
    } else if (distanceFromHighPct <= 0.3) {
      reasons.push(`Harga sekarang berada persis di/dekat titik tertinggi sesi.`);
    }
  }

  // --------------------------------------------------------
  // 3. Waktu sejak high terakhir
  // --------------------------------------------------------
  let minutesSinceHigh = null;

  if (sessionHighInfo) {
    minutesSinceHigh = minutesBetweenHHMM(sessionHighInfo.timeWIB, currentTimeWIB);

    if (minutesSinceHigh !== null) {
      if (minutesSinceHigh >= 30 && (distanceFromHighPct === null || distanceFromHighPct >= 2)) {
        score += 20;
        reasons.push(
          `Sudah ${minutesSinceHigh} menit sejak rekor tertinggi terakhir (${sessionHighInfo.timeWIB} WIB) — momentum kenaikan mandek.`
        );
      } else if (minutesSinceHigh >= 15 && (distanceFromHighPct === null || distanceFromHighPct >= 2)) {
        score += 10;
        reasons.push(
          `${minutesSinceHigh} menit tanpa rekor tertinggi baru sejak ${sessionHighInfo.timeWIB} WIB.`
        );
      }
    }
  }

  // --------------------------------------------------------
  // 4. Tren volume
  // --------------------------------------------------------
  let volumeTrendPct = null;

  if (volTrend) {
    volumeTrendPct = volTrend.trendPct;

    const priceDropping = distanceFromHighPct !== null && distanceFromHighPct >= 2;

    if (volumeTrendPct >= 50 && priceDropping) {
      score += 25;
      reasons.push(
        `Volume ${5}-candle terakhir naik ${volumeTrendPct.toFixed(0)}% dibanding rata-rata sesi SAAT harga turun dari high — indikasi tekanan jual nyata, bukan sekadar sepi transaksi.`
      );
    } else if (volumeTrendPct <= -40 && priceDropping) {
      score += 12;
      reasons.push(
        `Volume ${5}-candle terakhir turun ${Math.abs(volumeTrendPct).toFixed(0)}% dari rata-rata sesi sambil harga menjauh dari high — minat transaksi mengering.`
      );
    }
  }

  score = Math.max(0, Math.min(100, score));

  let verdict = "HOLD";
  let label = "HOLD — Momentum Masih Terjaga";

  if (score >= 55) {
    verdict = "EXIT";
    label = "JUAL — Tekanan Jual Dominan";
  } else if (score >= 30) {
    verdict = "WASPADA";
    label = "WASPADA — Pertimbangkan Exit";
  }

  return {
    verdict,
    label,
    score,
    reasons,
    vwap: vwap ? Number(vwap.toFixed(2)) : null,
    sessionHigh,
    currentPrice,
    distanceFromHighPct: distanceFromHighPct !== null ? Number(distanceFromHighPct.toFixed(2)) : null,
    minutesSinceHigh,
    volumeTrendPct: volumeTrendPct !== null ? Number(volumeTrendPct.toFixed(1)) : null
  };
}

export default calculateIntradayExit;
