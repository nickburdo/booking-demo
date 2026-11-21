-- v4: statuses confirmed / no_show, owner actions, demo flag, admin sessions (ADR-020…022).
-- SQLite cannot change a CHECK constraint, so `reservations` is rebuilt: new table, copy, drop,
-- rename. reservation_slots references reservations(id); D1 always enforces foreign keys, so the
-- checks are deferred to the end of this migration's transaction (D1 docs, foreign keys).

PRAGMA defer_foreign_keys = on;

CREATE TABLE reservations_new (
  id                 TEXT PRIMARY KEY,                -- UUID
  table_id           INTEGER NOT NULL REFERENCES tables(id),
  date               TEXT NOT NULL,                   -- YYYY-MM-DD, Kyiv local
  start_time         TEXT NOT NULL,                   -- HH:MM, Kyiv local
  guests             INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 4),
  name               TEXT NOT NULL,
  phone              TEXT NOT NULL,                   -- E.164
  comment            TEXT,
  status             TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'no_show')),
  token_hash         TEXT NOT NULL UNIQUE,            -- SHA-256 of the guest token
  created_at         TEXT NOT NULL,                   -- ISO 8601 UTC
  cancelled_at       TEXT,
  notified_at        TEXT,                            -- v3: Telegram accepted "new booking"
  cancel_notified_at TEXT,                            -- v3: Telegram accepted "cancelled"
  confirmed_at       TEXT,                            -- v4
  no_show_at         TEXT,                            -- v4
  cancelled_by       TEXT CHECK (cancelled_by IN ('guest', 'owner')),
  cancel_reason      TEXT,                            -- v4: owner's optional reason
  is_demo            INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))
);

-- Every cancellation before v4 was made by the guest.
INSERT INTO reservations_new (
  id, table_id, date, start_time, guests, name, phone, comment, status, token_hash,
  created_at, cancelled_at, notified_at, cancel_notified_at, cancelled_by
)
SELECT
  id, table_id, date, start_time, guests, name, phone, comment, status, token_hash,
  created_at, cancelled_at, notified_at, cancel_notified_at,
  CASE WHEN status = 'cancelled' THEN 'guest' END
FROM reservations;

DROP TABLE reservations;
ALTER TABLE reservations_new RENAME TO reservations;

-- Admin day view and demo limit.
CREATE INDEX reservations_by_date ON reservations(date, start_time);

-- Admin sessions: only the SHA-256 of the bearer token is stored (ADR-020).
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,                           -- ISO 8601 UTC
  expires_at TEXT NOT NULL                            -- ISO 8601 UTC
);

PRAGMA defer_foreign_keys = off;
