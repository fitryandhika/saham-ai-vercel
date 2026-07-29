-- ==========================
-- Migration: Reversal Candidate bonus tracking — 29 Juli 2026
-- ==========================
--
-- Latar belakang: analisis export scan_history 15-29 Juli 2026 menemukan
-- 133 kejadian saham yang diberi HOLD/SELL oleh scorer tapi harganya
-- gap up besoknya (dari 2065 kejadian bukan-BUY, ~6.4%), dengan pola
-- karakteristik: RSI belum jenuh beli, MACD negatif, underperform vs
-- pasar (JAUH UNDERPERFORM/UNDERPERFORM), tapi harga masih di atas
-- SMA50. Sampel INI BARU 10 hari — lihat catatan lengkap di
-- engine/scorer.js (isReversalCandidate) soal kenapa bonusnya sengaja
-- dibuat kecil (+6) dan dicatat terpisah di sini, bukan langsung
-- dipakai reweight besar-besaran.
--
-- Jalankan sekali di Supabase SQL Editor. Idempotent & additive — tidak
-- mengubah baris/kolom yang sudah ada.

alter table scan_history add column if not exists reversal_candidate boolean default false;

create index if not exists idx_scan_history_reversal_candidate
  on scan_history (reversal_candidate)
  where reversal_candidate = true;
