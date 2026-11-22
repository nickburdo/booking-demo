-- v6: AI chat next to the scripted one (ADR-026, ADR-027).

-- Which engine runs a conversation. Existing conversations are scripted.
ALTER TABLE chat_sessions ADD COLUMN engine TEXT NOT NULL DEFAULT 'scripted'
  CHECK (engine IN ('scripted', 'ai'));

-- Workers AI neurons used per UTC day (Cloudflare resets its free quota at 00:00 UTC).
CREATE TABLE ai_usage (
  day     TEXT PRIMARY KEY,                -- YYYY-MM-DD, UTC
  neurons INTEGER NOT NULL DEFAULT 0
);
