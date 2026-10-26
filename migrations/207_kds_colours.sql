-- 207_kds_colours.sql
--
-- Kitchen screen colours (Store tech > Kitchen screens > Ticket colours).
--
--   pos_settings.kds_colours  { states: { [key]: '#rrggbb' }, sections: [{ name, colour }] }
--                             states: the background of a dish row or a
--                             ticket's top in each state, and the timer's
--                             amber and late colours (shared/pos/kitchenColours.js
--                             KITCHEN_COLOURS); a state not set keeps the
--                             standard look. sections: dish names in a colour
--                             by their menu section, matched by name (case and
--                             spaces ignored) so every menu's "Sides" is one row.
--
-- One set per venue, for all its kitchen screens. The kitchen screen's config
-- carries the states and the section colours by section id (kdsConfig()).
--
-- Nothing else here: the pass's packing check (tapping a dish ticks it off,
-- kitchen.item_checked) keeps its ticks on the kitchen order
-- (kds_orders.state items[].checked), and whether ticking off every dish
-- bumps the ticket is a station setting (kds_stations.settings.bump_when_checked).

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS kds_colours jsonb NOT NULL DEFAULT '{}'::jsonb;
