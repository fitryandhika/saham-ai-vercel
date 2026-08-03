-- ==========================
-- Migration: Fundamental zapi.web.id (marketCap, PE ratio) — 3 Agustus 2026
-- ==========================
--
-- Data fundamental dari endpoint finance:stockbit:symbol (zapi.web.id),
-- diambil best-effort di api/scan.js lewat services/zapiService.js
-- (getZapiFundamentals). Kalau fetch gagal / simbol tidak ditemukan,
-- kedua kolom ini tetap NULL — tidak menggagalkan scan.
--
-- Dipakai sebagai fitur tambahan untuk model (mis. filter/bobot skor
-- berdasarkan valuasi atau ukuran market cap), belum diikutsertakan
-- langsung ke engine/scorer.js — masih murni kolom data mentah dulu
-- sampai ada cukup sampel untuk dianalisa polanya.

alter table scan_history add column if not exists market_cap numeric;
alter table scan_history add column if not exists pe_ratio numeric;