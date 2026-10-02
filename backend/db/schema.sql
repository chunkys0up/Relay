-- Applied to the relay-db RDS instance (see ../README.md). Run against a
-- fresh database to reproduce it; not idempotent (no IF NOT EXISTS) since
-- it's meant to run once per database.

CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'information_needed',
  advisor_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  s3_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  field_name TEXT NOT NULL,
  value TEXT,
  confidence NUMERIC,
  source_page INT,
  status TEXT NOT NULL DEFAULT 'unconfirmed',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  version INT NOT NULL,
  s3_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (case_id, version)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE advisor_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  advisor_id UUID NOT NULL,
  draft_id UUID NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
