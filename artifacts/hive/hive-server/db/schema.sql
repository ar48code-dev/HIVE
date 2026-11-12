-- HIVE schema. Idempotent: safe to run on every deploy.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id      TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  paypal_id     TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('payment','refund','failed')),
  amount_cents  BIGINT NOT NULL,
  fee_cents     BIGINT NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL,
  customer_key  TEXT NOT NULL,
  at            TIMESTAMPTZ NOT NULL,
  note          TEXT,
  source        TEXT NOT NULL CHECK (source IN ('paypal','synthetic')),
  order_id      TEXT,
  capture_id    TEXT
);
CREATE INDEX IF NOT EXISTS transactions_at_idx ON transactions (at);
CREATE INDEX IF NOT EXISTS transactions_customer_idx ON transactions (customer_key, at);
CREATE INDEX IF NOT EXISTS transactions_capture_idx ON transactions (capture_id);

CREATE TABLE IF NOT EXISTS alerts (
  id            BIGSERIAL PRIMARY KEY,
  txn_id        TEXT NOT NULL REFERENCES transactions(id),
  score         REAL NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  signals       JSONB NOT NULL,
  next_step     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (txn_id)
);

CREATE TABLE IF NOT EXISTS actions (
  id            BIGSERIAL PRIMARY KEY,
  alert_id      BIGINT REFERENCES alerts(id),
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','executed','failed')),
  proposed_by   TEXT NOT NULL DEFAULT 'queen-ai',
  decided_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor         TEXT NOT NULL,
  event         TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS wasplab_runs (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  report        JSONB NOT NULL
);

ALTER TABLE actions ADD COLUMN IF NOT EXISTS result JSONB;

-- Disputes, payouts and invoices. Same approve-then-confirm gate as actions, but not tied to an alert.
CREATE TABLE IF NOT EXISTS ops (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('dispute_response','payout','invoice')),
  key           TEXT,
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','executed','failed')),
  decided_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ,
  result        JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_kind_key_idx ON ops (kind, key) WHERE key IS NOT NULL;
