-- Saved conversations. AI chats are private to the role that started them (owner_role);
-- founder <-> advisor chats are shared (owner_role NULL). Safe to re-run.

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ai', 'human')),
  owner_role TEXT CHECK (owner_role IN ('founder', 'advisor')),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'ai') = (owner_role IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS conversations_case_idx ON conversations (case_id, kind, updated_at DESC);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);
