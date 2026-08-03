// ==========================
// Universe Refresh — Filter Likuiditas Otomatis (3 Agustus 2026)
// ==========================
//
// Menggantikan kurasi manual config/universe.js sebagai sumber utama
// daftar emiten yang di-scan. Latar belakang: saham seperti IATA yang
// hari itu naik +18% tidak pernah ter-scan sama sekali karena memang
// tidak pernah dimasukkan ke daftar manual — bukan soal skor/filter.
//
// Alur:
//   1. Tarik SEMUA emiten aktif IDX (~959) dari finance:idx/stock-summary
//      (zapi.web.id), dipaginate ~10x request.
//   2. Tarik SEKALI daftar sektor RESMI dari
//      finance:idx:companies/listed-companies (Sektor/SubSektor asli
//      IDX, bukan kategorisasi komunitas) — juga dipaginate, tapi cuma
//      1x untuk SEMUA emiten sekaligus, bukan per-saham satu-satu.
//      (Sebelumnya sempat pakai getZapiFundamentals per-saham buat
//      sektor — diganti karena ini jauh lebih murah/cepat dan sumbernya
//      lebih otoritatif.)
//   3. Filter likuiditas: nilai transaksi (Value) HARI SNAPSHOT INI
//      >= Rp1.000.000.000 (Rp1 miliar). CATATAN JUJUR: ini proxy dari
//      SATU hari trading (hari cron ini jalan), BUKAN rata-rata N-hari
//      sungguhan — menghitung rata-rata N-hari untuk ~959 emiten butuh
//      panggilan candle history yang terlalu berat untuk 1x cron run.
//      Karena refresh-nya mingguan, distorsi dari satu hari yang
//      kebetulan sepi/ramai tetap kekoreksi minggu berikutnya.
//   4. Exclude harga <= 51 (gocap ekstrem, biasanya tidak bergerak wajar
//      untuk strategi beli-sore-jual-pagi).
//   5. Simpan ke tabel universe_snapshot (replace total, bukan upsert
//      parsial — lihat replaceUniverseSnapshot).
//
// api/scan.js membaca dari tabel ini lewat config/universe.js
// resolveUniverse(), dengan fallback ke daftar statis lama kalau tabel
// kosong/gagal.

import { getAllIdxStockSummary, getIdxSectorMap } from "../services/zapiService.js";
import { replaceUniverseSnapshot } from "../services/dataLogService.js";

export const config = {
  maxDuration: 60
};

const MIN_DAILY_VALUE = 1_000_000_000; // Rp1 miliar — lihat catatan di atas
const MIN_PRICE = 51; // exclude gocap ekstrem

export default async function handler(req, res) {
  try {
    const [allRows, sectorMap] = await Promise.all([
      getAllIdxStockSummary({ pageSize: 100, maxPages: 20 }),
      getIdxSectorMap({ pageSize: 100, maxPages: 20 })
    ]);

    if (!allRows || allRows.length === 0) {
      return res.status(200).json({
        ok: false,
        message: "Tidak ada data dari finance:idx/stock-summary — universe TIDAK diubah (tabel lama tetap dipakai sebagai fallback).",
        fetchedTotal: 0
      });
    }

    // Filter likuiditas + harga, sekalian susun baris final (sektor dari
    // Map yang sudah ditarik sekali di atas, bukan fetch per-saham).
    const validRows = [];

    for (const row of allRows) {
      const value = Number(row.Value);
      const close = Number(row.Close);
      const kode = row.StockCode;

      if (
        !kode ||
        !Number.isFinite(value) ||
        value < MIN_DAILY_VALUE ||
        !Number.isFinite(close) ||
        close <= MIN_PRICE
      ) {
        continue;
      }

      const listedShares = Number(row.ListedShares);
      const marketCap =
        Number.isFinite(close) && Number.isFinite(listedShares)
          ? close * listedShares
          : null;

      validRows.push({
        kode,
        sector: sectorMap.get(kode)?.sector || "Lainnya",
        last_price: close,
        daily_value: value,
        market_cap: marketCap,
        refreshed_at: new Date().toISOString()
      });
    }

    if (validRows.length === 0) {
      return res.status(200).json({
        ok: false,
        message: "Tidak ada emiten yang lolos filter likuiditas — universe TIDAK diubah.",
        fetchedTotal: allRows.length,
        sectorMapSize: sectorMap.size
      });
    }

    const { saved, error } = await replaceUniverseSnapshot(validRows);

    return res.status(200).json({
      ok: !error,
      fetchedTotal: allRows.length,
      sectorMapSize: sectorMap.size,
      survivorsAfterLiquidityFilter: validRows.length,
      saved,
      minDailyValue: MIN_DAILY_VALUE,
      minPrice: MIN_PRICE,
      error: error || null
    });
  } catch (e) {
    console.error("universe-refresh error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
