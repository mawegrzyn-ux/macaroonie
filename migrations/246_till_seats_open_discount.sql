-- Till fixes (14 Nov 2026): seats on or off per revenue stream, the guests
-- prompt back on table-service tills, typing a discount as a till role
-- permission, and a location's layout for tills on phones.
--
-- pos_revenue_streams.seats  whether the till numbers seats on the stream's
--                            checks (the seat bar, By seat on the check),
--                            like courses (migration 231). Until now seats
--                            followed the guests setting (covers off meant no
--                            seats); they are their own switch now, on by
--                            default. A till can choose its own (device
--                            settings seats: stream | on | off). Counter
--                            tills never use seats, courses or guests.
--
-- pos_revenue_streams.covers   'off' becomes 'ask' (the column's default):
--                            migration 231 turned the venue's old "guests
--                            must be entered" switch into 'off' where it was
--                            off, which also took the seat numbers away; a
--                            table-service till now asks how many guests
--                            when a table or a tab opens, with a Skip.
--                            Counter tills never ask.
--
-- Till roles (pos_roles.permissions): open_discount, may type a discount on
-- the till (one that isn't on Store tech > Discounts), up to the role's
-- discount_max_pct; without it a manager types their PIN
-- (shared/pos/permissions.js). It replaces the venue switch "Discounts typed
-- in on the till need a manager" (pos_settings.approvals.custom_discount):
-- roles that could give a discount keep doing so, except in groups where a
-- location had the switch on (there a manager stays needed: the role gets
-- open_discount false, written out so the rule can't change if this runs
-- again after the switch is gone).
--
-- pos_settings.phone_layout_id   the till layout (made for a phone) the
--                            location's tills draw on a phone-sized screen,
--                            when the layout picked for the till isn't one
--                            made for a phone. NULL = the built-in phone
--                            screen, as before (pos/src/lib/tillLayout.js).

ALTER TABLE pos_revenue_streams ADD COLUMN IF NOT EXISTS seats boolean NOT NULL DEFAULT true;

UPDATE pos_revenue_streams SET covers = 'ask' WHERE covers = 'off';

UPDATE pos_roles r
   SET permissions = r.permissions || jsonb_build_object('open_discount', NOT EXISTS (
         SELECT 1 FROM pos_settings p
          WHERE p.tenant_id = r.tenant_id
            AND p.approvals->>'custom_discount' = 'true'))
 WHERE NOT (r.permissions ? 'open_discount')
   AND CASE WHEN (r.permissions->>'discount_max_pct') ~ '^[0-9]+(\.[0-9]+)?$'
            THEN (r.permissions->>'discount_max_pct')::numeric > 0 ELSE false END;

UPDATE pos_settings SET approvals = approvals - 'custom_discount' WHERE approvals ? 'custom_discount';

ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS phone_layout_id uuid REFERENCES pos_till_layouts(id) ON DELETE SET NULL;
