-- ==========================
-- Migration: Exhaustion & Distribution engine — 31 Juli 2026
-- ==========================
--
-- Latar belakang: export scan_history akhir Juli 2026 (3.780 baris
-- ter-label) menunjukkan win rate STRONG BUY (35.1%) justru LEBIH
-- RENDAH dari HOLD/SELL (~37-38%), dan banyak saham yang
-- direkomendasikan BUY malah sideways/turun berhari-hari alih-alih
-- naik esok pagi seperti target strategi beli-sore-jual-pagi.
--
-- Dua indikator baru ditambahkan (lihat engine/indicators/exhaustion.js
-- & distribution.js untuk definisi lengkap):
--   - exhaustion_score/label: rally sudah kepanjangan / momentum
--     melemah, dihitung dari histori candle saham itu sendiri
--     (overextension vs ATR, divergence RSI, consecutive up-days).
--   - distribution_score/label: volume besar tanpa follow-through
--     harga / indikasi smart money keluar (down-day volume besar,
--     closing strength menurun beruntun, churning).
--
-- Kedua skor ini SUDAH dipakai sebagai penalti kecil di scorer.js dan
-- gate di verdict.js (getEntryTiming: AVOID kalau dua-duanya tinggi
-- sekaligus), tapi BELUM divalidasi dari data nyata — makanya dicatat
-- penuh di sini (bukan cuma dipakai internal) supaya bisa dievaluasi
-- dari next_day_return_pct yang sesungguhnya sebelum bobotnya
-- diperbesar.
--
-- Jalankan sekali di Supabase SQL Editor. Idempotent & additive —
-- tidak mengubah baris/kolom yang sudah ada.

alter table scan_history add column if not exists exhaustion_score integer;
alter table scan_history add column if not exists exhaustion_label text;
alter table scan_history add column if not exists distribution_score integer;
alter table scan_history add column if not exists distribution_label text;

create index if not exists idx_scan_history_exhaustion_score
  on scan_history (exhaustion_score);

create index if not exists idx_scan_history_distribution_score
  on scan_history (distribution_score);