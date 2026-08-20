// ==========================
// Snapshot Row Builder
// ==========================
//
// Mapping dari hasil analyzeStock() (engine/analyzer.js) ke bentuk baris
// scan_history yang dikirim ke Supabase. Field-nya SAMA PERSIS dengan
// snapshotRows di api/scan.js — dipisah ke file ini supaya bisa dipakai
// ulang oleh backfill (api/relabel-high-low.js?target=backfill-gap) tanpa
// duplikat mapping. Duplikat mapping ini sebelumnya yang bikin bug
// 'entryTimingConflict' (camelCase, bukan kolom valid) nyangkut di
// snapshotRows dan bikin SELURUH insert Supabase gagal — lihat commit
// perbaikannya di api/scan.js sekitar 19-20 Agustus 2026.
//
// Kalau kolom baru ditambahkan ke tabel scan_history, cukup update di
// SINI SATU TEMPAT — api/scan.js dan backfill otomatis ikut konsisten.

export function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function buildSnapshotRow(d, scanDate) {
  const opportunity = d.nextDayOpportunity || null;

  return {
    // Basic
    kode: d.kode,
    sector: d.sector,
    scan_date: scanDate,

    close: d.close,

    score: d.score,
    signal: d.signal,
    entry: d.entry,

    rsi: d.rsi,

    macd: d.macd?.macd ?? null,

    sma20: d.sma20,
    sma50: d.sma50,

    ema9: d.ema9,
    ema20: d.ema20,

    risk_reward: d.riskReward,

    atr: d.atr,

    // Breakout
    breakout_level: d.breakout?.level ?? null,
    breakout_distance_pct: d.breakout?.distancePercent ?? null,

    // Closing
    closing_strength: d.closingStrength,

    // Volume
    volume_ratio: d.volume?.ratio ?? null,
    volume_signal: d.volume?.signal ?? null,
    volume_accel_slope_pct: d.volumeAcceleration?.slopePercent ?? null,
    volume_accelerating: d.volumeAcceleration?.accelerating ?? null,

    // Relative strength
    rs_vs_ihsg: d.relativeStrength?.vsIhsg ?? null,
    rs_vs_sector: d.relativeStrength?.vsSector ?? null,
    rs_label: d.relativeStrength?.label ?? null,

    // Gap
    gap_outlook: d.gap?.outlook ?? null,
    gap_probability: d.gap?.probability
      ? parseFloat(String(d.gap.probability).replace("%", ""))
      : null,
    gap_calibration_applied: d.gap?.calibrationApplied ?? false,
    gap_bucket_sample_count: d.gap?.bucketSampleCount ?? null,

    // Session gain
    session_gain_score: d.sessionGain?.sessionGainScore ?? null,
    session_gain_label: d.sessionGain?.label ?? null,

    // Liquidity
    illiquid: d.liquidity?.illiquid ?? false,
    illiquid_reason: d.liquidity?.reason ?? null,

    // Market regime
    market_regime: d.marketRegime ?? null,
    market_regime_score: d.marketRegimeScore ?? null,
    score_adjusted: d.scoreAdjusted ?? null,

    // Existing candidates
    reversal_candidate: d.reversalCandidate ?? false,
    capitulation_bounce_candidate: d.capitulationBounceCandidate ?? false,
    strong_buy_confirmed: d.strongBuyConfirmed ?? false,
    volume_rs_synergy: d.volumeRsSynergy ?? false,

    // Exhaustion
    exhaustion_score: d.exhaustion?.exhaustionScore ?? null,
    exhaustion_label: d.exhaustion?.label ?? null,

    // Distribution
    distribution_score: d.distribution?.distributionScore ?? null,
    distribution_label: d.distribution?.label ?? null,

    // Fundamentals
    market_cap: d.marketCap ?? null,
    pe_ratio: null,

    // Next-Day Opportunity
    next_day_opportunity_score: safeNumber(opportunity?.opportunityScore),
    next_day_opportunity_label: opportunity?.opportunityLabel ?? null,
    next_day_opportunity_setup: opportunity?.coreSetup ?? null,
    next_day_opportunity_eligible: opportunity?.eligible ?? false,
    next_day_entry_quality_score: safeNumber(opportunity?.entryQualityScore),
    next_day_entry_quality_label: opportunity?.entryQualityLabel ?? null,
    next_day_chase_risk: opportunity?.chaseRisk ?? null,
    next_day_entry_decision: opportunity?.entryDecision ?? null,
    next_day_entry_eligible: opportunity?.entryEligible ?? false,

    daily_change_pct: safeNumber(d.dailyChangePercent),

    entry_timing_conflict: d.entryTimingConflict ?? false
  };
}

export default buildSnapshotRow;
