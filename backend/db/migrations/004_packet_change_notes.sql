-- What changed in each packet version and who made it, shown when comparing versions. Safe to re-run.
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS change_note TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS created_by TEXT;
