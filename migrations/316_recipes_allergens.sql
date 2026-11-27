-- Inventory phase 8a (docs/INVENTORY.md 8.3, decision D6): allergens on the
-- supplier's product, and the check of each dish's declared allergens
-- against what its recipes suggest.
--
-- 1. A supplier product (inv_quotes, the purchasing area's table) says which
--    of the 14 UK allergens it contains and which it may contain, by the
--    keys of STANDARD_ALLERGENS in shared/menuTags.js (the menus' own list),
--    when someone last checked that (allergens_checked_at: null = unknown,
--    a gap in the roll-up) and where it came from (a note: "Brakes spec
--    sheet, March 2026"). Two suppliers' soy sauces differ, so it is the
--    product's, not the item's.
-- 2. allergen_checks: one row per menu dish (the dish of one menu, as the
--    declaration is), worked out when the Recipes page's Allergens tab or
--    Pepper asks (shared/allergenCheck.js, services/allergenCheckSvc.js) and
--    stored so a person's decision holds: open (differences nobody has
--    decided), accepted (the declaration was changed to match, through the
--    menus area's own save route, in the menu's draft) or dismissed (with a
--    note; it holds until the differences change). A dish whose suggestion
--    and declaration agree has no row unless one was accepted. Nothing here
--    changes a declaration by itself.
--
-- Dish and menu ids are plain (the menu save deletes and re-inserts dishes
-- under the same ids): nothing points at menu_items with a foreign key; the
-- nightly recipe links sweep deletes checks whose dish is on no menu.

ALTER TABLE inv_quotes
  ADD COLUMN IF NOT EXISTS allergens_contains    text[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allergens_may_contain text[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allergens_checked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS allergens_checked_by  text,
  ADD COLUMN IF NOT EXISTS allergens_source      text         CHECK (allergens_source IS NULL OR length(allergens_source) <= 300);

CREATE TABLE allergen_checks (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dish_id      uuid         NOT NULL,
  menu_id      uuid,
  dish         text         NOT NULL,
  menu         text,
  section      text,
  status       text         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  -- What differs, in order: [{ allergen, kind, suggested, declared, venues, evidence }].
  differences  jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- The differences' fingerprint (allergen, kind, levels): a decision holds while it is the same.
  fingerprint  text         NOT NULL DEFAULT '',
  -- The suggestion (the strongest level of each allergen over every scope), the
  -- declaration as it was, and each scope group with its evidence and gaps.
  suggested    jsonb        NOT NULL DEFAULT '{}'::jsonb,
  declared     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  scopes       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  gaps         integer      NOT NULL DEFAULT 0,
  complete     boolean      NOT NULL DEFAULT false,
  decided_by   text,
  decided_at   timestamptz,
  note         text         CHECK (note IS NULL OR length(note) <= 1000),
  -- Earlier decisions, newest last: [{ status, by, at, note, differences }].
  history      jsonb        NOT NULL DEFAULT '[]'::jsonb,
  worked_at    timestamptz  NOT NULL DEFAULT now(),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dish_id)
);
CREATE INDEX allergen_checks_status ON allergen_checks (tenant_id, status);

ALTER TABLE allergen_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE allergen_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY allergen_checks_tenant ON allergen_checks
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.bypass_rls', true) = 'on');
