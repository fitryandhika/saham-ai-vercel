-- ==========================
-- Migrasi 24 Juli 2026 — Liquidity Guard, Close Labeling Tahap 2, Peak Time
-- ==========================
--
-- Jalankan SEKALI di Supabase SQL Editor. Semua statement pakai
-- IF NOT EXISTS supaya aman dijalankan berkali-kali (idempotent), dan
-- aman juga kalau db/schema.sql yang lama sempat tidak sinkron dengan
-- kondisi tabel yang sebenarnya (beberapa kolom di bawah kemungkinan
-- sudah ada dari migrasi manual sebelumnya — session_gain_score,
-- actual_next_high/low, max_gain_from_open_pct — statement untuk
-- kolom itu disertakan juga supaya schema.sql & migration ini jadi
-- satu sumber kebenaran yang lengkap.

-- Kolom yang sudah pernah ditambahkan manual sebelumnya (disertakan di
-- sini juga untuk konsistensi, tidak akan mengubah apa pun kalau sudah ada):
alter table scan_history add column if not exists actual_next_high numeric;
alter table scan_history add column if not exists actual_next_low numeric;
alter table scan_history add column if not exists max_gain_from_open_pct numeric;
alter table scan_history add column if not exists session_gain_score numeric;
alter table scan_history add column if not exists session_gain_label text;

-- Baru: Liquidity Guard (engine/liquidity.js) — menandai saham beku/
-- floor price supaya bisa dikecualikan dari analisa win-rate & dari
-- hasil screener yang ditampilkan ke user.
alter table scan_history add column if not exists illiquid boolean default false;
alter table scan_history add column if not exists illiquid_reason text;

-- Baru: Close Labeling Tahap 2 (api/label-outcomes-close.js) — penanda
-- terpisah dari `labeled_at` (yang sekarang murni penanda tahap 1/open),
-- supaya query "baris mana yang masih perlu dilabel close" bisa presisi.
alter table scan_history add column if not exists close_labeled_at timestamptz;

-- Baru: Peak Time — jam berapa (WIB) harga tertinggi hari itu tercapai,
-- diisi dari data intraday Yahoo Finance (best-effort, bisa null kalau
-- data intraday sudah tidak tersedia / di luar retensi ~60 hari Yahoo).
alter table scan_history add column if not exists peak_time_wib text;   -- format "HH:MM", mis. "10:15"
alter table scan_history add column if not exists peak_session_phase text; -- SESI1_AWAL / SESI1_AKHIR / SESI2_AWAL / SESI2_AKHIR / dst, lihat services/stockService.js

-- Index tambahan untuk query "baris yang masih perlu label tahap 2"
-- (dipakai getOldestOpenLabeledDate() di services/dataLogService.js).
create index if not exists idx_scan_history_pending_close
  on scan_history (scan_date)
  where labeled_at is not null and close_labeled_at is null;

-- Index untuk analisa saham likuid saja (paling sering dipakai — hampir
-- semua query evaluasi win-rate seharusnya mengecualikan saham beku).
create index if not exists idx_scan_history_illiquid
  on scan_history (illiquid);