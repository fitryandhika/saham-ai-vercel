// ==========================
// Kalender Hari Bursa IDX
// ==========================
//
// Sumber: Pengumuman BEI No. Peng-00171/BEI.POP/09-2025, "Kalender Libur
// Bursa Tahun 2026", 23 September 2025 (merujuk SKB 3 Menteri No. 1497
// Tahun 2025, No. 2 Tahun 2025, No. 5 Tahun 2025 tentang Hari Libur
// Nasional dan Cuti Bersama 2026).
//
// CATATAN: daftar ini cuma hari libur TAMBAHAN di luar Sabtu/Minggu
// (yang sudah otomatis di-skip oleh isTradingDay()). Total hari bursa
// 2026 versi BEI: 239 hari.
//
// PENTING: BEI bisa merevisi kalender ini kalau ada perubahan kalender
// kliring Bank Indonesia atau keputusan pemerintah baru soal cuti
// bersama — cek ulang ke idx.co.id kalau sudah masuk tahun berikutnya
// atau kalau ada pengumuman revisi.
export const IDX_HOLIDAYS_2026 = [
  "2026-01-01", // Tahun Baru 2026 Masehi
  "2026-01-16", // Isra Mikraj Nabi Muhammad SAW
  "2026-02-16", // Cuti Bersama Tahun Baru Imlek 2577 Kongzili
  "2026-02-17", // Tahun Baru Imlek 2577 Kongzili
  "2026-03-18", // Cuti Bersama Hari Suci Nyepi
  "2026-03-19", // Hari Suci Nyepi Tahun Baru Saka 1948
  "2026-03-20", // Cuti Bersama Idul Fitri 1447 H
  "2026-03-23", // Cuti Bersama Idul Fitri 1447 H
  "2026-03-24", // Cuti Bersama Idul Fitri 1447 H
  "2026-04-03", // Wafat Yesus Kristus (Jumat Agung)
  "2026-05-01", // Hari Buruh Internasional
  "2026-05-14", // Kenaikan Yesus Kristus
  "2026-05-15", // Cuti Bersama Kenaikan Yesus Kristus
  "2026-05-27", // Idul Adha 1447 H
  "2026-05-28", // Cuti Bersama Idul Adha 1447 H
  "2026-06-01", // Hari Lahir Pancasila
  "2026-06-16", // Tahun Baru Islam 1448 H
  "2026-08-17", // Hari Proklamasi Kemerdekaan RI
  "2026-08-25", // Maulid Nabi Muhammad SAW
  "2026-12-24", // Cuti Bersama Hari Raya Natal
  "2026-12-25", // Hari Raya Natal
  "2026-12-31"  // Libur Bursa Akhir Tahun
];

// Tambahkan array tahun berikutnya di sini kalau sudah tersedia, lalu
// gabungkan ke ALL_HOLIDAYS di bawah.
const ALL_HOLIDAYS = new Set([...IDX_HOLIDAYS_2026]);

// Ambil tanggal (YYYY-MM-DD) menurut waktu Jakarta (WIB, UTC+7),
// supaya konsisten dengan scan_date yang disimpan — bukan tanggal UTC
// server, yang bisa geser kalau cron/request terjadi larut malam WIB.
export function todayWIB(date = new Date()) {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

// true kalau tanggal (YYYY-MM-DD, default hari ini WIB) adalah hari
// bursa IDX: bukan Sabtu/Minggu, dan bukan hari libur di daftar di atas.
export function isTradingDay(dateStr = todayWIB()) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Minggu, 6 = Sabtu
  if (day === 0 || day === 6) return false;
  if (ALL_HOLIDAYS.has(dateStr)) return false;
  return true;
}

// Alasan singkat kenapa suatu tanggal bukan hari bursa (buat pesan
// error yang informatif) — null kalau memang hari bursa.
export function nonTradingDayReason(dateStr = todayWIB()) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return "weekend";
  if (ALL_HOLIDAYS.has(dateStr)) return "libur_bursa";
  return null;
}