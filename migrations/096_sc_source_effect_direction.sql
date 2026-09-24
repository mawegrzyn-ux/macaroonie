-- ============================================================
-- 096_sc_source_effect_direction.sql
--
-- Replaces cash_sc_sources' two booleans (included_in_takings,
-- included_in_income) with two independent tri-state columns that let
-- the operator choose a SIGN per side, not just on/off:
--
--   takings_effect / income_effect: 'none' | 'add' | 'subtract'
--
-- Previously the reconciliation adjustment was hardcoded as
-- "if in takings, always add; if in income, always subtract" (an XOR of
-- the two booleans — see migration 034's comment). That covered the
-- common case (SC lands in the till but isn't in the income figure, or
-- vice versa) but not a source that needs to be DEDUCTED from takings,
-- or ADDED to the income side of the adjustment.
--
-- adj = takingsTerm + incomeTerm, where each term is +amount ('add'),
-- -amount ('subtract'), or 0 ('none'). The migration below maps the old
-- booleans onto this so every existing source computes an IDENTICAL
-- adjustment number before and after:
--   included_in_takings = true  -> takings_effect = 'add'      (+amount, same as before)
--   included_in_income  = true  -> income_effect  = 'subtract' (-amount, same as before)
-- ============================================================

BEGIN;

ALTER TABLE cash_sc_sources
  ADD COLUMN IF NOT EXISTS takings_effect text NOT NULL DEFAULT 'none'
    CHECK (takings_effect IN ('none', 'add', 'subtract')),
  ADD COLUMN IF NOT EXISTS income_effect text NOT NULL DEFAULT 'none'
    CHECK (income_effect IN ('none', 'add', 'subtract'));

UPDATE cash_sc_sources
   SET takings_effect = CASE WHEN included_in_takings THEN 'add'      ELSE 'none' END,
       income_effect  = CASE WHEN included_in_income  THEN 'subtract' ELSE 'none' END;

ALTER TABLE cash_sc_sources
  DROP COLUMN IF EXISTS included_in_takings,
  DROP COLUMN IF EXISTS included_in_income;

COMMENT ON COLUMN cash_sc_sources.takings_effect IS
  'How this SC source adjusts the reconciliation variance against Takings: none / add / subtract.';
COMMENT ON COLUMN cash_sc_sources.income_effect IS
  'How this SC source adjusts the reconciliation variance against Income: none / add / subtract.';

COMMIT;
