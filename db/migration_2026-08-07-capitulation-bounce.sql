-- ==========================
-- Migration: Capitulation Bounce Candidate tracking — 7 Agustus 2026
-- ==========================
--
-- Latar belakang: analisis export scan_history 15 Jul-6 Agt 2026 (5.692
-- baris) menemukan 164 saham naik >=5% dari open besoknya, 103 (63%)
-- berstatus HOLD/SELL H-1 (bukan BUY/STRONG BUY). Dari 103 itu, 41 (40%)
-- punya pola RSI netral (40-55) + MACD negatif + underperform pasar yang
-- SAMA seperti isReversalCandidate yang sudah ada, tapi gagal kena bonus
-- karena syarat "close > sma50" ternyata salah arah untuk kelompok ini:
-- 35/41 (85%) justru close-nya di BAWAH sma50, dengan ATR% lebih tinggi
-- dari rata-rata (5.46% vs 3.68%) — kelompok yang lebih berisiko/volatil,
-- bukan "coiling tenang" seperti reversal candidate biasa.
--
-- Rule baru ini divalidasi balik ke seluruh 5.692 baris (bukan cuma 103
-- kejadian yang memunculkan pola ini): menyala 428 kali, rata-rata
-- max_gain_from_open_pct 2.45% vs baseline 1.76% di seluruh data —
-- lift-nya nyata tapi modest, makanya bonus skornya dibuat kecil (+5) di
-- engine/scorer.js (isCapitulationBounceCandidate), dan mutually
-- exclusive dengan reversal_candidate (syarat close vs sma50 berkebalikan
-- sehingga tidak pernah menyala bersamaan). Lihat catatan lengkap di
-- engine/scorer.js soal kenapa bobotnya sengaja tidak diperbesar dulu.
--
-- Jalankan sekali di Supabase SQL Editor. Idempotent & additive — tidak
-- mengubah baris/kolom yang sudah ada.

alter table scan_history add column if not exists capitulation_bounce_candidate boolean default false;

create index if not exists idx_scan_history_capitulation_bounce_candidate
  on scan_history (capitulation_bounce_candidate)
  where capitulation_bounce_candidate = true;