-- ==========================
-- Migration: STRONG BUY Volume+Breakout Confirmation Gate — 8 Agustus 2026
-- ==========================
--
-- Latar belakang: analisis balik export scan_history 15 Jul-7 Agt 2026
-- (2.150 baris berlabel max_gain_from_open_pct) menemukan skor AI
-- (`score`) yang dipakai sekarang TIDAK diskriminatif untuk metrik
-- "potensi naik hari itu" — dari skor 55 sampai 95 peluang naik >=3%
-- nyaris flat di 17-20%. Sementara jumlah signal STRONG BUY per hari
-- melonjak dari 7-19% emiten (27-31 Jul) jadi 34-42% emiten (4-7 Agt),
-- padahal win rate STRONG BUY cuma 9% — nyaris sama dengan HOLD/BUY
-- biasa. Akar masalahnya: skor mentok di cap 100 (banyak kombinasi
-- faktor bullish berbeda-beda semuanya nabrak plafon yang sama), jadi
-- STRONG BUY kehilangan daya bedanya di hari-hari market Risk-On kuat.
--
-- Yang justru diskriminatif dari analisis data: volume relatif tinggi
-- (volume_ratio/volume_signal, makin tinggi makin besar potensi naik,
-- monoton & robust) dan RSI<80 (RSI>=80/overbought ekstrem adalah bucket
-- TERBURUK, cuma 8.6% peluang naik >=3% vs baseline 16.2%). Kombinasi
-- breakout (STRONG_BREAKOUT/BREAKOUT) + volume EXPLOSIVE/HIGH + RSI<80:
-- n=46, 26.1% peluang naik >=3% & 17.4% peluang naik >=5% (vs baseline
-- 16.2%/7.7%).
--
-- Diimplementasikan sebagai GATE untuk signal STRONG BUY di
-- engine/analyzer.js (hasStrongBuyConfirmation, lihat catatan lengkap di
-- engine/scorer.js) — skor >=90 tapi konfirmasi pola ini tidak ada,
-- signal diturunkan ke BUY biasa. Flag dicatat untuk SEMUA signal (bukan
-- cuma yang STRONG BUY) supaya bisa dievaluasi lebih lanjut dari data
-- yang terus bertambah.
--
-- Jalankan sekali di Supabase SQL Editor. Idempotent & additive — tidak
-- mengubah baris/kolom yang sudah ada.

alter table scan_history add column if not exists strong_buy_confirmed boolean default false;

create index if not exists idx_scan_history_strong_buy_confirmed
  on scan_history (strong_buy_confirmed)
  where strong_buy_confirmed = true;
