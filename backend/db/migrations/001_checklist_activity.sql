-- Case checklist and activity log, maintained by the chat agent (and checked off by the founder).
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT,
  state TEXT NOT NULL DEFAULT 'todo' CHECK (state IN ('todo', 'in_progress', 'blocked', 'done')),
  position INT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'agent' CHECK (created_by IN ('agent', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checklist_items_case_idx ON checklist_items (case_id, position);

CREATE TABLE IF NOT EXISTS case_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('agent', 'founder', 'advisor', 'system')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_activity_case_idx ON case_activity (case_id, created_at DESC);
