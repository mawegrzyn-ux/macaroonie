-- 010_allocation_rules.sql
-- Two per-venue flags controlling how the smart-allocate engine (PATCH /relocate)
-- combines tables, plus an explicit block-list of table pairs that must never
-- be combined regardless of any other rule.

-- ── Flags on booking_rules ────────────────────────────────────
-- allow_cross_section_combo  (default OFF)
--   When OFF:  adjacency expansion and combination lookups only consider tables
--              that are in the same section as the drop-target table.
--   When ON:   tables from different sections may be combined.
--
-- allow_non_adjacent_combo   (default OFF)
--   When OFF:  only combinations whose member tables are all consecutive in
--              sort_order are considered by the engine.
--   When ON:   any combination is eligible regardless of adjacency.
--              Note: adjacency *expansion* (step 3c) always remains contiguous.

ALTER TABLE booking_rules
  ADD COLUMN IF NOT EXISTS allow_cross_section_combo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_non_adjacent_combo  boolean NOT NULL DEFAULT false;

-- ── Disallowed table pairs ────────────────────────────────────
-- A pair listed here is never used by the smart-allocate engine, whether the
-- match comes from an existing combination or the adjacency-expansion path.
-- table_id_a is always the lexicographically smaller UUID so (A,B) = (B,A).

CREATE TABLE disallowed_table_pairs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid        NOT NULL REFERENCES venues(id)  ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_id_a  uuid        NOT NULL REFERENCES tables(id)  ON DELETE CASCADE,
  table_id_b  uuid        NOT NULL REFERENCES tables(id)  ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Normalised: always store the smaller UUID first
  CONSTRAINT dtp_ordered  CHECK (table_id_a < table_id_b),
  UNIQUE (table_id_a, table_id_b)
);

ALTER TABLE disallowed_table_pairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY dtp_tenant ON disallowed_table_pairs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX ON disallowed_table_pairs (venue_id);
CREATE INDEX ON disallowed_table_pairs (table_id_a);
CREATE INDEX ON disallowed_table_pairs (table_id_b);
