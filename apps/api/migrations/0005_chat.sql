-- v5: scripted chat conversations (ADR-023, ADR-024).

CREATE TABLE chat_sessions (
  id             TEXT PRIMARY KEY,                -- UUID
  token_hash     TEXT NOT NULL UNIQUE,            -- SHA-256 of the chat bearer token
  locale         TEXT NOT NULL CHECK (locale IN ('en', 'ru', 'uk')),
  state          TEXT NOT NULL,                   -- JSON: current step and collected answers
  outcome        TEXT NOT NULL DEFAULT 'left'
                 CHECK (outcome IN ('left', 'questions', 'found', 'person', 'booked')),
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  guest_messages INTEGER NOT NULL DEFAULT 0,      -- limit: 60 per conversation
  message_count  INTEGER NOT NULL DEFAULT 0,      -- next chat_messages.seq
  -- Concurrency guard (v5 plan, R3): a request first claims the step by bumping the version
  -- (UPDATE … WHERE version = ?), so a double click cannot run an action (e.g. a booking) twice.
  version        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,                   -- ISO 8601 UTC
  updated_at     TEXT NOT NULL                    -- ISO 8601 UTC; conversations expire after 2 h of silence
);

CREATE INDEX chat_sessions_by_created ON chat_sessions(created_at);

CREATE TABLE chat_messages (
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,                    -- order within the conversation
  sender     TEXT NOT NULL CHECK (sender IN ('guest', 'bot')),
  field      TEXT,                                -- for guest text: name / phone / comment / link / question
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
