-- A separate, stronger toggle alongside hide_zero_priced_variants (084):
-- that one keeps a zero-priced option's label and only drops its "£0.00"
-- price text; this one drops the option row entirely — label included —
-- when it has no price at all. Applies to both the printed menu and the
-- website's inline menu block. Defaults to false so existing menus
-- render unchanged.

ALTER TABLE menus
  ADD COLUMN hide_unpriced_variants boolean NOT NULL DEFAULT false;
