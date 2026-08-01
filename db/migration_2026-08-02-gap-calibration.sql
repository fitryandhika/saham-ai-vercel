-- ==========================
-- Migration: Gap Probability Engine (Hybrid) — 2 Agustus 2026
-- ==========================
--
-- Tabel kecil (maksimal 45 baris — lihat engine/gapCalibration.js
-- untuk definisi bucket) yang menyimpan win rate EMPIRIS dari
-- scan_history, dihitung ulang tiap hari setelah label tahap 2
-- selesai (lihat api/label-outcomes-close.js). Dipakai engine/gap.js
-- untuk blending Bayesian shrinkage antara rumus heuristik lama
-- dengan data historis aktual — bukan tabel besar per-baris, cuma
-- ringkasan per bucket, jadi lookup-nya cepat (1x fetch semua baris
-- saat scan, bukan query per saham).

create table if not exists gap_calibration (
  bucket_key text primary key,
  sample_count integer not null,
  win_rate numeric not null,       -- 0-1, proporsi gap_up_realized=true di bucket ini
  avg_return_pct numeric,          -- rata-rata next_day_return_pct di bucket ini
  computed_at timestamptz not null default now()
);

-- Dicatat per baris scan_history supaya bisa dievaluasi nanti apakah
-- prediksi yang dapat "bantuan" dari data historis (calibration_applied
-- true) memang lebih akurat dari yang murni heuristik.
alter table scan_history add column if not exists gap_calibration_applied boolean default false;
alter table scan_history add column if not exists gap_bucket_sample_count integer;