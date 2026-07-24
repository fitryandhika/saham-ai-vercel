-- ==========================
-- Skema tabel scan_history
-- ==========================
--
-- Jalankan file ini SEKALI di Supabase: buka project kamu di
-- supabase.com -> SQL Editor -> New query -> paste semua isi file ini
-- -> Run.
--
-- Tabel ini menyimpan snapshot fitur teknikal setiap kali /api/scan
-- jalan (score, signal, breakout, RS, dll — semua fitur yang sudah
-- ada di engine/analyzer.js), PLUS kolom "hasil aktual" yang diisi
-- BELAKANGAN lewat 2 tahap: api/label-outcomes.js (pagi, open saja)
-- lalu api/label-outcomes-close.js (sore setelah market close, sisanya).
-- Setelah beberapa minggu/bulan, tabel ini jadi dataset training:
-- fitur hari H -> label hasil hari H+1.
--
-- CATATAN: kalau tabel ini SUDAH ada dari sebelumnya (bukan setup
-- baru), jalankan db/migration_2026-07-24.sql saja — file itu berisi
-- ALTER TABLE idempotent untuk semua kolom baru di bawah.

create table if not exists scan_history (
  id bigint generated always as identity primary key,

  kode text not null,
  sector text,
  scan_date date not null,        -- tanggal candle terakhir yang dianalisa
  scanned_at timestamptz not null default now(),

  -- ==========================
  -- Fitur (input model nantinya)
  -- ==========================
  close numeric,
  score numeric,
  signal text,
  entry text,
  rsi numeric,
  macd numeric,
  sma20 numeric,
  sma50 numeric,
  ema9 numeric,
  ema20 numeric,
  risk_reward numeric,
  atr numeric,

  breakout_level text,             -- NONE / WEAK_BREAKOUT / BREAKOUT / STRONG_BREAKOUT
  breakout_distance_pct numeric,

  closing_strength numeric,

  volume_ratio numeric,
  volume_signal text,
  volume_accel_slope_pct numeric,
  volume_accelerating boolean,

  rs_vs_ihsg numeric,
  rs_vs_sector numeric,
  rs_label text,

  gap_outlook text,
  gap_probability numeric,

  session_gain_score numeric,      -- 0-100, lihat engine/sessionGainScore.js
  session_gain_label text,         -- TINGGI / SEDANG / RENDAH / SANGAT RENDAH

  illiquid boolean default false,  -- lihat engine/liquidity.js — saham beku/floor price
  illiquid_reason text,            -- FLOOR_PRICE / FROZEN_PRICE / NO_RANGE_TODAY

  -- ==========================
  -- Label TAHAP 1 (diisi pagi besok, api/label-outcomes.js) — open saja,
  -- karena open sudah final begitu sesi dibuka.
  -- ==========================
  actual_next_open numeric,
  next_day_return_pct numeric,     -- (next_open - close) / close * 100
  gap_up_realized boolean,         -- next_day_return_pct >= ambang (default 2%)
  labeled_at timestamptz,

  -- ==========================
  -- Label TAHAP 2 (diisi setelah market close, ~16:00 WIB, oleh
  -- api/label-outcomes-close.js) — close/high/low baru final di sini,
  -- BUKAN pagi hari seperti tahap 1.
  -- ==========================
  actual_next_close numeric,
  actual_next_high numeric,
  actual_next_low numeric,
  max_gain_from_open_pct numeric,  -- (high - open) / open * 100
  peak_time_wib text,              -- format "HH:MM", jam harga tertinggi tercapai
  peak_session_phase text,         -- SESI1_AWAL / SESI1_AKHIR / SESI2_AWAL / SESI2_AKHIR / dst
  close_labeled_at timestamptz,

  unique (kode, scan_date)
);

-- Index untuk query training (ambil semua baris yang sudah dilabel)
create index if not exists idx_scan_history_labeled
  on scan_history (scan_date)
  where gap_up_realized is not null;

create index if not exists idx_scan_history_kode_date
  on scan_history (kode, scan_date);