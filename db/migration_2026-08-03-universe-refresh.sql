-- ==========================
-- Migration: Universe Snapshot (filter likuiditas otomatis) — 3 Agustus 2026
-- ==========================
--
-- Menggantikan config/universe.js (daftar manual) sebagai sumber utama
-- daftar emiten yang di-scan. Diisi mingguan oleh cron
-- api/universe-refresh.js — lihat file itu untuk detail kriteria filter
-- (likuiditas >= Rp1 miliar/hari, harga > 51).
--
-- Ditulis ulang TOTAL tiap kali cron jalan (delete-then-insert, lihat
-- replaceUniverseSnapshot di services/dataLogService.js) — bukan
-- akumulasi baris, karena emiten yang minggu ini lolos filter bisa saja
-- tidak lolos lagi minggu depan.

create table if not exists universe_snapshot (
  kode text primary key,
  sector text,
  last_price numeric,
  daily_value numeric,   -- nilai transaksi hari snapshot diambil (proxy likuiditas, lihat catatan di universe-refresh.js)
  market_cap numeric,
  refreshed_at timestamptz default now()
);

create index if not exists idx_universe_snapshot_sector on universe_snapshot (sector);