-- ==========================
-- Migration: Layer Makro (kebijakan moneter, yield curve, fund flow,
-- korelasi antar aset) — 28 Juli 2026
-- ==========================
--
-- Jalankan file ini SEKALI di Supabase SQL Editor. Semuanya idempotent
-- (create if not exists / add column if not exists), jadi aman
-- dijalankan ulang.
--
-- SIFATNYA ADDITIVE — tidak mengubah/menghapus baris scan_history yang
-- sudah ada. Baris lama otomatis dapat NULL di kolom baru sampai
-- macro_snapshot mulai terisi (lihat api/macro-scan.js) dan
-- api/scan.js mulai menyertakannya.

-- ==========================
-- Tabel baru: macro_snapshot
-- ==========================
-- Satu baris per hari bursa, diisi oleh cron /api/macro-scan SEBELUM
-- /api/scan jalan. Field yang datanya belum ada API gratis yang stabil
-- (BI Rate, foreign net flow IDX) sengaja dibiarkan nullable — diisi
-- manual belakangan lewat endpoint yang sama (lihat catatan di
-- services/macroFetchService.js), bukan diblokir sampai lengkap.
create table if not exists macro_snapshot (
  id bigint generated always as identity primary key,

  snapshot_date date not null unique,
  captured_at timestamptz not null default now(),

  -- Kebijakan moneter
  fed_rate numeric,              -- Fed Funds Rate (FRED: FEDFUNDS)
  bi_rate numeric,                -- BI Rate — manual/opsional, lihat catatan di atas

  -- Yield curve
  us10y_yield numeric,            -- FRED: DGS10
  us2y_yield numeric,             -- FRED: DGS2
  yield_spread_10y2y numeric,     -- us10y_yield - us2y_yield (indikator resesi)

  -- Korelasi antar aset / risk sentiment
  dxy_index numeric,              -- Dollar Index (Yahoo: DX-Y.NYB)
  usdidr numeric,                 -- Yahoo: IDR=X
  ihsg_close numeric,             -- Yahoo: ^JKSE (dipakai juga oleh marketService.js)

  -- Fund flow — belum ada API gratis resmi, diisi manual/opsional
  foreign_net_flow_idx numeric,

  -- Hasil klasifikasi (lihat engine/marketRegime.js)
  market_regime text,             -- RISK_ON / RISK_OFF / NEUTRAL
  market_regime_score numeric,    -- 0-100, dipakai sebagai adjustment ke score saham
  regime_reasons jsonb,           -- array alasan (untuk debugging/transparansi)

  created_at timestamptz default now()
);

create index if not exists idx_macro_snapshot_date
  on macro_snapshot (snapshot_date desc);

-- ==========================
-- Kolom tambahan di scan_history — TIDAK mengubah kolom `score` yang
-- sudah ada (arti & nilainya tetap sama seperti sebelumnya, supaya
-- tidak merusak dataset training yang sudah dikumpulkan). Layer makro
-- ditambahkan sebagai kolom BARU di sebelahnya.
-- ==========================
alter table scan_history add column if not exists market_regime text;
alter table scan_history add column if not exists market_regime_score numeric;
alter table scan_history add column if not exists score_adjusted numeric;