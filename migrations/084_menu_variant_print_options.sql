-- Two per-menu display toggles for variant options:
--   print_hide_variant_group_headers — skip the variant group's label
--     (e.g. "Choose your protein") on the printed/PDF menu only. The
--     group's options themselves still print, just without the heading.
--   hide_zero_priced_variants — suppress the "£0.00" price text next to
--     a variant option priced at exactly zero (an "included, no upcharge"
--     option), on both the printed menu and the website's inline menu
--     block. The option's label still shows — this only affects whether
--     its price is printed, matching how a NULL price already renders
--     as no price text.
-- Both default to false so existing menus render unchanged.

ALTER TABLE menus
  ADD COLUMN print_hide_variant_group_headers boolean NOT NULL DEFAULT false,
  ADD COLUMN hide_zero_priced_variants        boolean NOT NULL DEFAULT false;
