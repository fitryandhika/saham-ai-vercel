// ==========================
// Label Outcomes — TAHAP 1: open pagi ini
// ==========================
//
// Dijalankan besok pagi untuk melabeli snapshot KEMARIN.
//
// Prioritas sumber harga H+1:
//   1. Candle harian Yahoo/IDX jika sudah tersedia
//   2. ZAPI first intraday price sebagai FALLBACK jika candle H+1
//      belum tersedia dan targetnya adalah hari berjalan.
//
// CATATAN PENTING:
// ZAPI firstPrice = harga intraday pertama yang tersedia dari ZAPI.
// Ini BUKAN klaim bahwa field tersebut adalah official opening price IDX.
// Karena itu ZAPI hanya digunakan sebagai fallback.
//
// Definisi label:
// gap_up_realized = true kalau harga H+1 >= +2%
// dari close snapshot H.
//
// TAHAP 2:
// api/label-outcomes-close.js tetap bertugas mengambil:
//   - actual_next_close
//   - actual_next_high
//   - actual_next_low
//   - max_gain_from_open_pct
//   - next_day_max_gain_from_close_pct
//   - next_day_close_return_from_close_pct
//   - peak_time_wib
//   - peak_session_phase
//
// ==========================

import {
  getUnlabeledSnapshots,
  updateLabel,
  getOldestUnlabeledDate
} from "../services/dataLogService.js";

import {
  getStockData
} from "../services/stockService.js";

import {
  getZapiFirstPriceToday
} from "../services/zapiService.js";

export const config = {
  maxDuration: 60
};

const CONCURRENCY = 12;
const DEFAULT_THRESHOLD_PCT = 2;

// ==========================
// Helper: WIB date
// ==========================
//
// Jangan menggunakan UTC date untuk menentukan "hari ini" karena
// server Vercel biasanya berjalan dalam UTC.
// Indonesia = UTC+7.

function todayWIB() {
  const now = new Date();

  const wib = new Date(
    now.getTime() + 7 * 60 * 60 * 1000
  );

  return wib.toISOString().slice(0, 10);
}

// ==========================
// Helper: run concurrency pool
// ==========================

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);

  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const i = cursor++;

      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = {
          error: e.message
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(concurrency, items.length)
      },
      next
    )
  );

  return results;
}

// ==========================
// Handler
// ==========================

export default async function handler(req, res) {
  try {

    // ==========================
    // CRON AUTH
    // ==========================

    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization;

      if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized."
        });
      }
    }

    // ==========================
    // THRESHOLD
    // ==========================

    const thresholdPct = req.query.threshold
      ? parseFloat(req.query.threshold)
      : DEFAULT_THRESHOLD_PCT;

    if (!Number.isFinite(thresholdPct)) {
      return res.status(400).json({
        success: false,
        message: "Parameter threshold tidak valid."
      });
    }

    // ==========================
    // TENTUKAN SCAN DATE
    // ==========================
    //
    // Jika ?date= diberikan:
    // gunakan tanggal tersebut.
    //
    // Jika tidak:
    // ambil snapshot paling lama yang belum dilabel.
    //
    // Ini penting untuk mengejar backlog seperti:
    //
    // Jumat → Senin
    //
    // tanpa salah menganggap Minggu sebagai hari berikutnya.

    const scanDate =
      req.query.date ||
      (await getOldestUnlabeledDate());

    if (!scanDate) {
      return res.status(200).json({
        success: true,
        scanDate: null,
        message:
          "Tidak ada snapshot yang perlu dilabel — semua sudah dilabel.",
        labeled: 0
      });
    }

    // ==========================
    // JANGAN LABEL HARI INI
    // ==========================
    //
    // Snapshot hari ini membutuhkan data H+1.
    //
    // Walaupun ZAPI punya intraday hari ini, snapshot hari ini
    // belum mempunyai "besok", sehingga tidak boleh dilabel.

    if (scanDate === todayWIB()) {
      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Snapshot tertua yang belum dilabel adalah scan hari ini — tunggu sampai besok.",
        labeled: 0
      });
    }

    // ==========================
    // AMBIL SNAPSHOT PENDING
    // ==========================

    const pending =
      await getUnlabeledSnapshots(scanDate);

    if (pending.length === 0) {
      return res.status(200).json({
        success: true,
        scanDate,
        message:
          "Tidak ada snapshot yang perlu dilabel.",
        labeled: 0
      });
    }

    // ==========================
    // LABELING
    // ==========================

    const results = await runPool(
      pending,
      async (row) => {

        // ============================================================
        // 1. COBA DATA DAILY TERLEBIH DAHULU
        // ============================================================

        let stockData = null;

        try {
          stockData = await getStockData(row.kode);
        } catch (e) {
          console.error(
            `getStockData(${row.kode}) gagal:`,
            e.message
          );
        }

        let nextOpen = null;
        let nextOpenSource = null;
        let nextOpenDate = null;

        // ============================================================
        // 2. CARI CANDLE H+1
        // ============================================================

        if (stockData?.candles?.length) {

          for (const candle of stockData.candles) {

            const candleDate =
              candle.date.slice(0, 10);

            if (candleDate > scanDate) {

              nextOpen = Number(candle.open);

              if (Number.isFinite(nextOpen)) {
                nextOpenSource =
                  stockData.priceSource === "IDX_OFFICIAL"
                    ? "IDX_OFFICIAL"
                    : "YAHOO";

                nextOpenDate = candleDate;
              }

              break;
            }
          }
        }

        // ============================================================
        // 3. FALLBACK ZAPI
        // ============================================================
        //
        // ZAPI timeframe=today hanya menyediakan hari berjalan.
        //
        // Karena itu ZAPI HANYA boleh digunakan jika:
        //
        // scanDate < todayWIB()
        //
        // dan target H+1 memang adalah hari ini.
        //
        // Contoh:
        //
        // scanDate = 2026-08-10
        // today    = 2026-08-11
        //
        // → BOLEH menggunakan ZAPI.
        //
        // Tetapi:
        //
        // scanDate = 2026-08-08
        // today    = 2026-08-11
        //
        // → TIDAK boleh menggunakan ZAPI untuk mencari H+1
        //    karena target sebenarnya adalah 2026-08-09.

        const currentDateWIB = todayWIB();

        const isTargetToday =
          scanDate < currentDateWIB;

        if (
          nextOpen === null &&
          isTargetToday
        ) {

          try {

            const zapi =
              await getZapiFirstPriceToday(row.kode);

            if (zapi?.firstPrice != null) {

              const firstPrice =
                Number(zapi.firstPrice);

              if (
                Number.isFinite(firstPrice) &&
                firstPrice > 0
              ) {

                nextOpen = firstPrice;

                nextOpenSource =
                  "ZAPI_STOCKBIT_FIRST_INTRADAY";

                nextOpenDate =
                  currentDateWIB;
              }
            }

          } catch (e) {

            console.error(
              `ZAPI fallback ${row.kode} gagal:`,
              e.message
            );
          }
        }

        // ============================================================
        // 4. JIKA H+1 MASIH TIDAK TERSEDIA
        // ============================================================
        //
        // Jangan pernah memakai candle H atau tanggal lain sebagai H+1.
        //
        // Lebih baik record belum dilabel daripada memasukkan label salah
        // ke dataset training SahamAI.

        if (
          nextOpen === null ||
          !Number.isFinite(nextOpen)
        ) {

          return {
            kode: row.kode,
            status: "NOT_FOUND",
            error:
              `Candle H+1 belum tersedia untuk ${row.kode} setelah ${scanDate}. Snapshot belum dilabel.`
          };
        }

        // ============================================================
        // 5. VALIDASI CLOSE SNAPSHOT
        // ============================================================

        const previousClose =
          Number(row.close);

        if (
          !Number.isFinite(previousClose) ||
          previousClose <= 0
        ) {

          return {
            kode: row.kode,
            status: "INVALID_REFERENCE_CLOSE",
            error:
              `Close snapshot ${row.kode} tidak valid: ${row.close}`
          };
        }

        // ============================================================
        // 6. HITUNG RETURN H+1
        // ============================================================

        const nextDayReturnPct =
          Number(
            (
              ((nextOpen - previousClose) /
                previousClose) *
              100
            ).toFixed(2)
          );

        // ============================================================
        // 7. GAP UP REALIZED
        // ============================================================

        const gapUpRealized =
          nextDayReturnPct >= thresholdPct;

        // ============================================================
        // 8. SIMPAN LABEL
        // ============================================================
        //
        // Kolom lama tetap dipertahankan supaya kompatibel dengan
        // dataset SahamAI yang sudah ada.
        //
        // actual_next_open:
        //   - IDX_OFFICIAL / Yahoo jika tersedia
        //   - ZAPI first intraday jika fallback
        //
        // labeled_at:
        //   menandakan Tahap 1 sudah selesai.

        await updateLabel(row.id, {

          actual_next_open:
            nextOpen,

          next_day_return_pct:
            nextDayReturnPct,

          gap_up_realized:
            gapUpRealized,

          labeled_at:
            new Date().toISOString()
        });

        // ============================================================
        // 9. RETURN HASIL
        // ============================================================

        return {
          kode: row.kode,
          status: "OK",

          nextOpen,
          nextOpenDate,
          nextOpenSource,

          nextDayReturnPct,
          gapUpRealized
        };
      },
      CONCURRENCY
    );

    // ==========================
    // SUMMARY
    // ==========================

    const successful =
      results.filter(
        (r) =>
          r &&
          r.status === "OK"
      );

    const notFound =
      results.filter(
        (r) =>
          r &&
          r.status === "NOT_FOUND"
      );

    const invalidReference =
      results.filter(
        (r) =>
          r &&
          r.status === "INVALID_REFERENCE_CLOSE"
      );

    const failed =
      results
        .map((r, i) => {

          if (!r) return null;

          if (r.error) {
            return {
              kode: pending[i].kode,
              error: r.error,
              status: r.status
            };
          }

          return null;

        })
        .filter(Boolean);

    // ==========================
    // SUMBER DATA
    // ==========================

    const sourceStats = {
      IDX_OFFICIAL: successful.filter(
        r => r.nextOpenSource === "IDX_OFFICIAL"
      ).length,

      YAHOO: successful.filter(
        r => r.nextOpenSource === "YAHOO"
      ).length,

      ZAPI_STOCKBIT_FIRST_INTRADAY:
        successful.filter(
          r =>
            r.nextOpenSource ===
            "ZAPI_STOCKBIT_FIRST_INTRADAY"
        ).length
    };

    // ==========================
    // RESPONSE
    // ==========================

    return res.status(200).json({

      success: true,

      scanDate,

      todayWIB: todayWIB(),

      thresholdPct,

      pending: pending.length,

      labeled: successful.length,

      failed: failed.length,

      notFound: notFound.length,

      invalidReference:
        invalidReference.length,

      gapUpCount:
        successful.filter(
          r => r.gapUpRealized
        ).length,

      sourceStats,

      results: successful,

      failedCodes: failed

    });

  } catch (error) {

    console.error(
      "label-outcomes error:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Labeling gagal.",

      error:
        error.message,

      stack:
        error.stack

    });
  }
}