-- Lets the founder mark an advisor's returned questions as resolved, so they stop being shown.
-- A new review from the advisor is a new row with resolved_at NULL, so its questions show again. Safe to re-run.
ALTER TABLE advisor_actions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
