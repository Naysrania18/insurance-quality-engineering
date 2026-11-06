-- Legacy (v1) flat policy table, as it might exist in an older system being retired.
-- Up to three insurers per row, shares as percentages, money as decimal dollars.
CREATE TABLE IF NOT EXISTS legacy_policies (
  row_id         SERIAL PRIMARY KEY,
  policy_no      TEXT NOT NULL,
  status         CHAR(1) NOT NULL,            -- 'B' bound, 'C' cancelled
  insured_value  NUMERIC(14,2) NOT NULL,
  premium        NUMERIC(14,2) NOT NULL,
  insurer1       TEXT, share1 NUMERIC(5,2),
  insurer2       TEXT, share2 NUMERIC(5,2),
  insurer3       TEXT, share3 NUMERIC(5,2),
  bound_on       DATE NOT NULL
);

-- Records that cannot be migrated are quarantined here, never silently dropped.
CREATE TABLE IF NOT EXISTS migration_rejects (
  policy_no  TEXT NOT NULL,
  row_id     INTEGER NOT NULL,
  reason     TEXT NOT NULL
);
