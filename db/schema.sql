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
-- BELAKANGAN oleh /api/label-outcomes.js keesokan paginya. Setelah
-- beberapa minggu/bulan, tabel ini jadi dataset training: fitur hari
-- H -> label hasil hari H+1.

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

  -- ==========================
  -- Label (diisi keesokan harinya oleh api/label-outcomes.js)
  -- ==========================
  actual_next_open numeric,
  actual_next_close numeric,
  next_day_return_pct numeric,     -- (next_open - close) / close * 100
  gap_up_realized boolean,         -- next_day_return_pct >= ambang (default 2%)
  labeled_at timestamptz,

  unique (kode, scan_date)
);

-- Index untuk query training (ambil semua baris yang sudah dilabel)
create index if not exists idx_scan_history_labeled
  on scan_history (scan_date)
  where gap_up_realized is not null;

create index if not exists idx_scan_history_kode_date
  on scan_history (kode, scan_date);
