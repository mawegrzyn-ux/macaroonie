-- Inventory phase 8b (docs/INVENTORY.md 8.3, 10.3): allergen checks opened
-- again when something changes, and the Today item.
--
-- A change that could alter a dish's suggested allergens (a supplier price
-- added, changed or switched off, a product's allergens saved, the usual
-- supplier switched, a substitute delivered, a recipe, a link or an option
-- rule changed) works the affected dishes' checks out again in the change's
-- own transaction (allergensChanged() in services/allergenCheckSvc.js). A
-- check it opened, opened again or changed is marked with when and what
-- changed, and Today shows those to whoever can decide them ("Allergen
-- checks to review"); a decision clears the mark.
--
-- venue_ids: the venues the dish is sold at (its menu's venue, or every
-- active venue), as last worked out, so Today shows a check at those venues.

ALTER TABLE allergen_checks
  ADD COLUMN IF NOT EXISTS venue_ids  uuid[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS change     text         CHECK (change IS NULL OR length(change) <= 500);

CREATE INDEX IF NOT EXISTS allergen_checks_changed ON allergen_checks (tenant_id, changed_at) WHERE changed_at IS NOT NULL;
