-- Schema v2 (normalised). Money is stored as integer cents.
CREATE TABLE IF NOT EXISTS brokers (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risks (
  id                    UUID PRIMARY KEY,
  broker_id             UUID NOT NULL REFERENCES brokers(id),
  risk_type             TEXT NOT NULL CHECK (risk_type IN ('marine_cargo','commercial_property')),
  insured_value_cents   BIGINT NOT NULL CHECK (insured_value_cents > 0),
  currency              TEXT NOT NULL DEFAULT 'USD',
  description           TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('SUBMITTED','QUOTED','BOUND')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id             UUID PRIMARY KEY,
  risk_id        UUID NOT NULL REFERENCES risks(id),
  premium_cents  BIGINT NOT NULL CHECK (premium_cents > 0),
  status         TEXT NOT NULL CHECK (status IN ('QUOTED','ACCEPTED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policies (
  id                   UUID PRIMARY KEY,
  policy_ref           TEXT NOT NULL UNIQUE,
  quote_id             UUID NOT NULL UNIQUE REFERENCES quotes(id),
  status               TEXT NOT NULL CHECK (status IN ('BOUND','CANCELLED')),
  sum_insured_cents    BIGINT NOT NULL,
  total_premium_cents  BIGINT NOT NULL,
  open_claims          INTEGER NOT NULL DEFAULT 0,
  claims_paid_cents    BIGINT NOT NULL DEFAULT 0,
  bound_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insurer_shares (
  id            UUID PRIMARY KEY,
  policy_id     UUID NOT NULL REFERENCES policies(id),
  insurer       TEXT NOT NULL,
  share_bps     INTEGER NOT NULL CHECK (share_bps > 0 AND share_bps <= 10000),
  amount_cents  BIGINT NOT NULL,
  UNIQUE (policy_id, insurer)
);

CREATE TABLE IF NOT EXISTS premiums (
  id            UUID PRIMARY KEY,
  policy_id     UUID NOT NULL UNIQUE REFERENCES policies(id),
  amount_cents  BIGINT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS claims (
  id                    UUID PRIMARY KEY,
  claim_ref             TEXT NOT NULL UNIQUE,
  policy_id             UUID NOT NULL REFERENCES policies(id),
  loss_date             DATE NOT NULL,
  amount_claimed_cents  BIGINT NOT NULL CHECK (amount_claimed_cents > 0),
  assessed_cents        BIGINT,
  settled_cents         BIGINT,
  description           TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('NOTIFIED','ASSESSED','SETTLED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  from_state  TEXT,
  to_state    TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox: events are written with the business change, then relayed to the broker.
CREATE TABLE IF NOT EXISTS outbox (
  id            BIGSERIAL PRIMARY KEY,
  event_id      UUID NOT NULL UNIQUE,
  payload       TEXT NOT NULL,
  published_at  TIMESTAMPTZ
);

-- Consumer idempotency.
CREATE TABLE IF NOT EXISTS processed_events (
  consumer      TEXT NOT NULL,
  event_id      UUID NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- Order-independent projection of claim events onto a policy (see policy-service consumers).
CREATE TABLE IF NOT EXISTS policy_claim_ledger (
  claim_id       UUID PRIMARY KEY,
  policy_id      UUID NOT NULL,
  notified       BOOLEAN NOT NULL DEFAULT FALSE,
  settled_cents  BIGINT
);
