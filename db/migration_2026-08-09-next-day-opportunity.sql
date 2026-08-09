-- ============================================================
-- SahamAI - Next Day Opportunity V1
-- Migration: 2026-08-09
-- ============================================================

ALTER TABLE scan_history
ADD COLUMN IF NOT EXISTS next_day_opportunity_score NUMERIC;

ALTER TABLE scan_history
ADD COLUMN IF NOT EXISTS next_day_opportunity_label TEXT;

ALTER TABLE scan_history
ADD COLUMN IF NOT EXISTS next_day_opportunity_setup TEXT;

ALTER TABLE scan_history
ADD COLUMN IF NOT EXISTS next_day_opportunity_eligible BOOLEAN DEFAULT FALSE;

-- Optional: index untuk pencarian/filter Opportunity Score
CREATE INDEX IF NOT EXISTS idx_scan_history_next_day_opportunity_score
ON scan_history(next_day_opportunity_score);

CREATE INDEX IF NOT EXISTS idx_scan_history_next_day_opportunity_label
ON scan_history(next_day_opportunity_label);