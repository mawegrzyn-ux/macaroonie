-- 289_cash_ext_documents.sql
--
-- Sales from other tills, phase 1 (docs/SALES_IMPORT.md 3.2): the raw store.
-- Every document a connector reads (a receipt, an item, a modifier, a store,
-- ...) is kept as received, with personal data taken out first (decision D3:
-- a customer is kept as the other till's id only; no names, emails or phone
-- numbers anywhere). A changed mapping or a fix re-runs from here without
-- asking the other till again.
--
--   kind                 sale | item | variant | modifier | category | tax |
--                        discount | payment_type | store | employee |
--                        pos_device | dining_option
--   external_id          the other till's id (a Loyverse receipt's number)
--   external_updated_at  when the other till last changed it
--   hash                 sha256 of the stored payload: an unchanged copy is
--                        not normalised again
--
-- Kept 400 days from when it was last fetched (the sync job's sweep,
-- services/salesImportSvc.js RAW_KEEP_DAYS); the normalised rows stay.

CREATE TABLE ext_documents (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id        uuid        NOT NULL REFERENCES pos_connections(id) ON DELETE CASCADE,
  kind                 text        NOT NULL CHECK (kind IN ('sale', 'item', 'variant', 'modifier', 'category', 'tax', 'discount',
                                                            'payment_type', 'store', 'employee', 'pos_device', 'dining_option')),
  external_id          text        NOT NULL,
  external_updated_at  timestamptz,
  payload              jsonb       NOT NULL,
  hash                 text        NOT NULL,
  fetched_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, kind, external_id)
);
CREATE INDEX ext_documents_tenant  ON ext_documents (tenant_id, connection_id, kind);
CREATE INDEX ext_documents_fetched ON ext_documents (fetched_at);

ALTER TABLE ext_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ext_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY ext_documents_tenant ON ext_documents
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
