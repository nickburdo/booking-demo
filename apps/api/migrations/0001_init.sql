-- v2 schema: tables, reservations and the slot cells that prevent double booking.

CREATE TABLE tables (
  id    INTEGER PRIMARY KEY,
  label TEXT    NOT NULL UNIQUE,
  seats INTEGER NOT NULL CHECK (seats > 0)
);

CREATE TABLE reservations (
  id           TEXT PRIMARY KEY,                -- UUID
  table_id     INTEGER NOT NULL REFERENCES tables(id),
  date         TEXT NOT NULL,                   -- YYYY-MM-DD, Kyiv local
  start_time   TEXT NOT NULL,                   -- HH:MM, Kyiv local
  guests       INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 4),
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,                   -- E.164
  comment      TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'cancelled')),
  token_hash   TEXT NOT NULL UNIQUE,            -- SHA-256 of the guest token
  created_at   TEXT NOT NULL,                   -- ISO 8601 UTC
  cancelled_at TEXT
);

-- One row per occupied 30-minute cell. The primary key is the double-booking guard:
-- a second reservation of the same table and slot cannot be inserted.
CREATE TABLE reservation_slots (
  table_id       INTEGER NOT NULL REFERENCES tables(id),
  slot           TEXT NOT NULL,                 -- YYYY-MM-DDTHH:MM, Kyiv local
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  PRIMARY KEY (table_id, slot)
);

CREATE INDEX reservation_slots_by_reservation ON reservation_slots(reservation_id);
