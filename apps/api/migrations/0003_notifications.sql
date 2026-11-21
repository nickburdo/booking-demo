-- v3: when the owner's Telegram notification was accepted (ISO 8601 UTC).
-- NULL means not sent (Telegram not configured or the call failed). See ADR-018.
ALTER TABLE reservations ADD COLUMN notified_at TEXT;
ALTER TABLE reservations ADD COLUMN cancel_notified_at TEXT;
