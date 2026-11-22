-- v7: pre-orders paid on Stripe Checkout in test mode (ADR-028, ADR-029).

CREATE TABLE orders (
  id                  TEXT PRIMARY KEY,
  reservation_id      TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  items               TEXT NOT NULL,            -- JSON: [{ id, name (en), quantity, price (UAH) }]
  total_uah           INTEGER NOT NULL,         -- full price
  discounted_uah      INTEGER NOT NULL,         -- after the discount
  amount              INTEGER NOT NULL,         -- charged, in minor units of `currency`
  currency            TEXT NOT NULL,            -- 'eur' (v7 R1)
  status              TEXT NOT NULL
                      CHECK (status IN ('checkout', 'paid', 'expired', 'refunded', 'refund_failed')),
  checkout_session_id TEXT UNIQUE,
  payment_intent_id   TEXT,
  refund_id           TEXT,
  created_at          TEXT NOT NULL,
  paid_at             TEXT,
  refunded_at         TEXT
);

CREATE INDEX orders_by_reservation ON orders (reservation_id, created_at);

-- At most one paid order per reservation (ADR-029). A second payment (e.g. from an old browser
-- tab) is refunded at once and stored as 'refunded', so the index covers 'paid' only.
CREATE UNIQUE INDEX orders_one_paid ON orders (reservation_id) WHERE status = 'paid';
