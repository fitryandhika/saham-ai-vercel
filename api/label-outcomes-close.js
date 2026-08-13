// ==========================
// Label Outcomes — TAHAP 2: CLOSE / HIGH / LOW H+1
// ==========================
//
// Tahap 2 berjalan setelah Tahap 1 berhasil.
//
// Mengisi:
//
//   actual_next_close
//   actual_next_high
//   actual_next_low
//   next_day_close_return_from_close_pct
//   next_day_max_gain_from_close_pct
//   next_day_max_loss_from_close_pct
//   next_day_high_3pct_realized
//   next_day_close_2pct_realized
//   next_day_success
//   close_labeled_at
//
// Selain daily OHLC, fungsi ini juga mencoba mengambil:
//
//   peakTimeWIB
//   peakHigh
//   peakSessionPhase
//   peak_source
//
// Untuk peak intraday:
//
//   ZAPI Stockbit -> Yahoo 15m fallback
//
// IMPORTANT:
// Daily OHLC tetap menggunakan getStockData().
// ZAPI intraday hanya digunakan untuk peak time.
//
// Jangan menggunakan candles.at(-1).
// Selalu cari candle trading pertama SETELAH scan_date.

import {
  getPendingCloseSnapshots,
  updateLabel,
  getOldestOpenLabeledDate
} from "../services/dataLogService.js";

import {
  getStockData,
  findTradingDayCandleAfter,
  getIntradayPeakTime
} from "../services/stockService.js";

import { todayWIB } from "../config/tradingCalendar.js";

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 8;

// ============================================================
// THRESHOLD
// ============================================================

const HIGH_TARGET_PCT = 3;
const CLOSE_TARGET_PCT = 2;

// ============================================================
// MARKET CLOSE
// ============================================================
//
// Jangan melabel candle hari berjalan sebelum market selesai.
// Dipakai hanya kalau H+1 ternyata adalah hari ini.
//
// ROOT CAUSE (audit ZAPI-skip):
// Candle harian dari Yahoo/IDX Official belum tentu SUDAH TERBIT
// persis jam 16:00:00 WIB — publikasinya punya delay beberapa
// menit dari jam tutup resmi. Kalau cron jalan tepat jam 16:00
// dan candle H+1 belum terbit, findTradingDayCandleAfter() tidak
// menemukan apa-apa (NEXT_CANDLE_NOT_FOUND) untuk hari itu.
// Baris tersebut baru berhasil dilabel BESOK, dan saat itu
// targetDate (nextDate) sudah bukan lagi todayWIB() lagi — jadi
// gate "ZAPI — PRIORITAS" (targetDate === todayWIB()) di
// getIntradayPeakTime() selalu bernilai false, dan peak SELALU
// jatuh ke fallback Yahoo. Ini bukan Yahoo yang "lebih baik",
// tapi ZAPI yang tidak pernah kebagian giliran mencoba.
//
// FIX: beri buffer publikasi setelah jam tutup resmi (16:00),
// supaya saat candle dicek, datanya sudah tersedia PADA HARI
// YANG SAMA. Dengan begitu targetDate === todayWIB() bisa benar
// tercapai, dan ZAPI benar-benar dicoba dulu sebagai sumber
// pertama sesuai desain awal.
//
// PENTING — WAJIB DIIKUTI SAAT DEPLOY:
// Jadwal cron endpoint ini di vercel.json juga harus digeser
// mundur supaya selaras dengan buffer ini, misalnya dari
// "0 9 * * 1-5" (= 16:00 WIB) menjadi "20 9 * * 1-5" (= 16:20
// WIB). Tanpa perubahan itu, cron akan tetap jalan jam 16:00,
// isAfterMarketCloseWIB() akan selalu false saat itu, dan
// snapshot hari ini akan selalu berstatus WAIT_MARKET_CLOSE
// pada satu-satunya kesempatan cron jalan hari itu — sehingga
// tetap baru kelabel besok (masalah yang sama, tidak terfix).
// ============================================================

const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 20;

// ============================================================
// GIVE UP THRESHOLD
// ============================================================
//
// Sama seperti di api/label-outcomes.js (lihat catatan di sana) — kalau
// baris gagal cari candle H+1 dan scan_date-nya sudah lebih tua dari
// GIVE_UP_AFTER_DAYS hari, tulis close_labeled_at supaya baris ini
// keluar dari antrean getOldestOpenLabeledDate() dan tidak menyumbat
// tanggal-tanggal baru selamanya.
const GIVE_UP_AFTER_DAYS = 10;

function daysSince(dateStr) {
  const then = new Date(dateStr + "T00:00:00Z").getTime();
  const now = new Date(todayWIB() + "T00:00:00Z").getTime();
  return Math.floor((now - then) / 86400000);
}

async function giveUpIfStale(row) {
  if (daysSince(row.scan_date) < GIVE_UP_AFTER_DAYS) {
    return false;
  }

  await updateLabel(row.id, {
    close_labeled_at: new Date().toISOString()
  });

  return true;
}

// ============================================================
// CONCURRENCY POOL
// ============================================================

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const i = cursor++;

      try {
        results[i] =
          await worker(items[i], i);
      } catch (e) {
        results[i] = {
          error:
            e?.message ||
            String(e)
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            concurrency,
            items.length
          )
      },
      next
    )
  );

  return results;
}

// ============================================================
// CEK MARKET SUDAH CLOSE
// ============================================================

function isAfterMarketCloseWIB() {
  const now = new Date();

  const utcMinutes =
    now.getUTCHours() * 60 +
    now.getUTCMinutes();

  // UTC + 7
  const wibMinutes =
    utcMinutes + 7 * 60;

  const normalized =
    wibMinutes % (24 * 60);

  const hour =
    Math.floor(
      normalized / 60
    );

  const minute =
    normalized % 60;

  return (
    hour > MARKET_CLOSE_HOUR ||
    (
      hour === MARKET_CLOSE_HOUR &&
      minute >= MARKET_CLOSE_MINUTE
    )
  );
}

// ============================================================
// HANDLER
// ============================================================

export default async function handler(req, res) {

  try {

    // ============================================================
    // SECURITY
    // ============================================================

    if (process.env.CRON_SECRET) {

      const auth =
        req.headers.authorization;

      if (
        auth !==
        `Bearer ${process.env.CRON_SECRET}` &&
        !req.query.manual
      ) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Tambahkan ?manual=1 kalau menjalankan manual dari browser."
        });
      }
    }

    // ============================================================
    // TARGET DATE
    // ============================================================

    const scanDate =
      req.query.date ||
      await getOldestOpenLabeledDate();

    // ============================================================
    // TIDAK ADA BACKLOG
    // ============================================================

    if (!scanDate) {

      return res.status(200).json({
        success: true,
        scanDate: null,
        message:
          "Tidak ada snapshot yang menunggu labeling close.",
        labeled: 0
      });
    }

    // ============================================================
    // JANGAN PROSES SCAN HARI INI
    // ============================================================

    if (scanDate === todayWIB()) {

      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Scan hari ini belum mempunyai candle H+1.",
        labeled: 0
      });
    }

    // ============================================================
    // AMBIL SNAPSHOT YANG SUDAH OPEN LABELED
    // TAPI CLOSE BELUM
    // ============================================================

    const pending =
      await getPendingCloseSnapshots(
        scanDate
      );

    if (
      !pending ||
      pending.length === 0
    ) {

      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Tidak ada snapshot yang menunggu labeling close pada tanggal ini.",
        labeled: 0
      });
    }

    // ============================================================
    // LABEL
    // ============================================================

    const results =
      await runPool(
        pending,
        async (row) => {

          // ======================================================
          // AMBIL DAILY DATA
          // ======================================================

          const stockData =
            await getStockData(
              row.kode,
              "3mo"
            );

          if (
            !stockData ||
            !Array.isArray(
              stockData.candles
            ) ||
            stockData.candles.length === 0
          ) {

            const gaveUp = await giveUpIfStale(row);
            return {
              kode: row.kode,
              status: gaveUp ? "GIVEN_UP_NO_DATA" : "NO_DATA"
            };
          }

          // ======================================================
          // CARI H+1
          // ======================================================

          const nextCandle =
            findTradingDayCandleAfter(
              stockData.candles,
              row.scan_date
            );

          if (!nextCandle) {

            const gaveUp = await giveUpIfStale(row);
            return {
              kode: row.kode,
              status:
                gaveUp ? "GIVEN_UP_NEXT_CANDLE_NOT_FOUND" : "NEXT_CANDLE_NOT_FOUND",
              scanDate:
                row.scan_date
            };
          }

          // ======================================================
          // TANGGAL H+1
          // ======================================================

          const nextDate =
            nextCandle.date?.slice(
              0,
              10
            );

          if (
            !nextDate ||
            nextDate <=
              row.scan_date
          ) {

            const gaveUp = await giveUpIfStale(row);
            return {
              kode: row.kode,
              status:
                gaveUp ? "GIVEN_UP_INVALID_CANDLE_DATE" : "INVALID_CANDLE_DATE",
              scanDate:
                row.scan_date,
              foundDate:
                nextDate
            };
          }

          // ======================================================
          // JIKA H+1 ADALAH HARI INI,
          // JANGAN LABEL SEBELUM MARKET CLOSE
          // ======================================================

          if (
            nextDate ===
              todayWIB() &&
            !isAfterMarketCloseWIB()
          ) {

            return {
              kode: row.kode,
              status:
                "WAIT_MARKET_CLOSE",
              nextDate
            };
          }

          // ======================================================
          // AMBIL OHLC
          // ======================================================

          const nextOpen =
            Number(
              nextCandle.open
            );

          const nextHigh =
            Number(
              nextCandle.high
            );

          const nextLow =
            Number(
              nextCandle.low
            );

          const nextClose =
            Number(
              nextCandle.close
            );

          const previousClose =
            Number(row.close);

          // ======================================================
          // VALIDASI
          // ======================================================

          if (
            !Number.isFinite(
              previousClose
            ) ||
            previousClose <= 0
          ) {

            return {
              kode: row.kode,
              status:
                "INVALID_PREVIOUS_CLOSE",
              previousClose:
                row.close
            };
          }

          if (
            !Number.isFinite(
              nextOpen
            ) ||
            nextOpen <= 0
          ) {

            return {
              kode: row.kode,
              status:
                "INVALID_NEXT_OPEN",
              nextDate,
              nextOpen:
                nextCandle.open
            };
          }

          if (
            !Number.isFinite(
              nextHigh
            ) ||
            nextHigh <= 0
          ) {

            return {
              kode: row.kode,
              status:
                "INVALID_NEXT_HIGH",
              nextDate,
              nextHigh:
                nextCandle.high
            };
          }

          if (
            !Number.isFinite(
              nextLow
            ) ||
            nextLow <= 0
          ) {

            return {
              kode: row.kode,
              status:
                "INVALID_NEXT_LOW",
              nextDate,
              nextLow:
                nextCandle.low
            };
          }

          if (
            !Number.isFinite(
              nextClose
            ) ||
            nextClose <= 0
          ) {

            return {
              kode: row.kode,
              status:
                "INVALID_NEXT_CLOSE",
              nextDate,
              nextClose:
                nextCandle.close
            };
          }

          // ======================================================
          // RETURN CLOSE H+1 VS CLOSE H
          // ======================================================

          const closeReturnPct =
            Number(
              (
                (
                  (nextClose -
                    previousClose) /
                  previousClose
                ) *
                100
              ).toFixed(2)
            );

          // ======================================================
          // MAX GAIN DARI CLOSE H
          //
          // Mengukur seberapa tinggi harga H+1
          // dibanding close saat snapshot.
          // ======================================================

          const maxGainFromClosePct =
            Number(
              (
                (
                  (nextHigh -
                    previousClose) /
                  previousClose
                ) *
                100
              ).toFixed(2)
            );

          // ======================================================
          // MAX LOSS DARI CLOSE H
          // ======================================================

          const maxLossFromClosePct =
            Number(
              (
                (
                  (nextLow -
                    previousClose) /
                  previousClose
                ) *
                100
              ).toFixed(2)
            );

          // ======================================================
          // MAX GAIN DARI OPEN H+1
          //
          // Beda dengan maxGainFromClosePct (basis close H):
          // ini basis actual_next_open (beli di open H+1,
          // jual di titik tertinggi hari yang sama).
          //
          // FIX (13 Agustus 2026): sebelumnya field ini HANYA
          // dihitung di api/relabel-high-low.js (backfill manual,
          // tidak ada di cron). Padahal riwayat.js dan CSV_COLUMNS
          // di api/history.js membaca max_gain_from_open_pct —
          // bukan next_day_max_gain_from_close_pct — jadi kolom
          // "Max Gain%" di tabel Riwayat AI selalu kosong untuk
          // baris baru. Dihitung juga di sini supaya terisi
          // otomatis lewat cron harian, konsisten dengan komentar
          // di db/schema.sql: "(high - open) / open * 100".
          // ======================================================

          const maxGainFromOpenPct =
            Number(
              (
                (
                  (nextHigh -
                    nextOpen) /
                  nextOpen
                ) *
                100
              ).toFixed(2)
            );

          // ======================================================
          // HIGH +3%
          // ======================================================

          const high3PctRealized =
            maxGainFromClosePct >=
            HIGH_TARGET_PCT;

          // ======================================================
          // CLOSE +2%
          // ======================================================

          const close2PctRealized =
            closeReturnPct >=
            CLOSE_TARGET_PCT;

          // ======================================================
          // SUCCESS
          //
          // Success utama:
          // harga H+1 sempat mencapai +3%
          // ATAU close H+1 minimal +2%.
          //
          // Ini menangkap strategi:
          // beli sore -> jual pagi.
          // ======================================================

          const nextDaySuccess =
            high3PctRealized ||
            close2PctRealized;

          // ======================================================
          // INTRADAY PEAK
          //
          // ZAPI Stockbit:
          // hanya untuk hari berjalan.
          //
          // Kalau tidak tersedia:
          // Yahoo 15m menjadi fallback.
          //
          // Kalau data historis sudah tidak tersedia:
          // hasil tetap dilabel tanpa peak time.
          // ======================================================

          let peak = null;

          try {

            peak =
              await getIntradayPeakTime(
                row.kode,
                nextDate,
                {
                  range: "5d",
                  interval: "15m"
                }
              );

          } catch (e) {

            console.error(
              `Peak ${row.kode} gagal:`,
              e.message
            );

            peak = null;
          }

          // ======================================================
          // PATCH DATABASE
          // ======================================================

          const patch = {

            actual_next_close:
              nextClose,

            actual_next_high:
              nextHigh,

            actual_next_low:
              nextLow,

            next_day_close_return_from_close_pct:
              closeReturnPct,

            next_day_max_gain_from_close_pct:
              maxGainFromClosePct,

            next_day_max_loss_from_close_pct:
              maxLossFromClosePct,

            max_gain_from_open_pct:
              maxGainFromOpenPct,

            next_day_high_3pct_realized:
              high3PctRealized,

            next_day_close_2pct_realized:
              close2PctRealized,

            next_day_success:
              nextDaySuccess,

            close_labeled_at:
              new Date().toISOString()
          };

          // ======================================================
          // SIMPAN PEAK KALAU TERSEDIA
          // ======================================================

          if (peak) {

            patch.peak_time_wib =
              peak.peakTimeWIB ??
              null;

            patch.peak_high =
              Number.isFinite(
                Number(
                  peak.peakHigh
                )
              )
                ? Number(
                    peak.peakHigh
                  )
                : null;

            patch.peak_session_phase =
              peak.peakSessionPhase ??
              null;

            patch.peak_source =
              peak.source ??
              null;
          }

          // ======================================================
          // UPDATE
          // ======================================================

          await updateLabel(
            row.id,
            patch
          );

          // ======================================================
          // RESPONSE PER SAHAM
          // ======================================================

          return {

            kode:
              row.kode,

            scanDate:
              row.scan_date,

            nextDate,

            previousClose,

            nextOpen,

            nextHigh,

            nextLow,

            nextClose,

            closeReturnPct,

            maxGainFromClosePct,

            maxLossFromClosePct,

            maxGainFromOpenPct,

            high3PctRealized,

            close2PctRealized,

            nextDaySuccess,

            peakTimeWIB:
              peak?.peakTimeWIB ??
              null,

            peakHigh:
              peak?.peakHigh ??
              null,

            peakSessionPhase:
              peak?.peakSessionPhase ??
              null,

            peakSource:
              peak?.source ??
              null,

            status:
              "OK"
          };
        },
        CONCURRENCY
      );

    // ============================================================
    // HASIL
    // ============================================================

    const ok =
      results.filter(
        r =>
          r &&
          r.status === "OK"
      );

    const failed =
      results
        .map((r, i) => {

          if (!r) {

            return {
              kode:
                pending[i].kode,
              status:
                "ERROR",
              error:
                "Worker tidak menghasilkan result."
            };
          }

          if (r.error) {

            return {
              kode:
                pending[i].kode,
              status:
                "ERROR",
              error:
                r.error
            };
          }

          if (
            r.status !== "OK"
          ) {

            return {
              kode:
                pending[i].kode,
              status:
                r.status,
              detail:
                r
            };
          }

          return null;

        })
        .filter(Boolean);

    // ============================================================
    // STATISTIK
    // ============================================================

    const successCount =
      ok.filter(
        r =>
          r.nextDaySuccess
      ).length;

    const high3PctCount =
      ok.filter(
        r =>
          r.high3PctRealized
      ).length;

    const close2PctCount =
      ok.filter(
        r =>
          r.close2PctRealized
      ).length;

    // ============================================================
    // PEAK SOURCE STATISTICS
    // ============================================================

    const peakSourceStats = {
      ZAPI_STOCKBIT_INTRADAY: 0,
      YAHOO_15M: 0,
      NONE: 0
    };

    for (const r of ok) {

      if (
        r.peakSource ===
        "ZAPI_STOCKBIT_INTRADAY"
      ) {

        peakSourceStats
          .ZAPI_STOCKBIT_INTRADAY++;

      } else if (
        r.peakSource
          ?.toUpperCase()
          .includes("YAHOO")
      ) {

        peakSourceStats
          .YAHOO_15M++;

      } else {

        peakSourceStats.NONE++;
      }
    }

    // ============================================================
    // RESPONSE
    // ============================================================

    return res.status(200).json({

      success: true,

      scanDate,

      totalPending:
        pending.length,

      labeled:
        ok.length,

      failed:
        failed.length,

      successCount,

      high3PctCount,

      close2PctCount,

      peakSourceStats,

      failedDetail:
        failed.slice(0, 20),

      examples:
        ok.slice(0, 10)

    });

  } catch (error) {

    console.error(
      "Label outcomes close error:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Close labeling gagal.",

      error:
        error?.message ||
        String(error)

    });
  }
}