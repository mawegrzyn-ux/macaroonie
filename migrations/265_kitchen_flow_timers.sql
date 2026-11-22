-- 265_kitchen_flow_timers.sql
--
-- Kitchen flow timers (22 Nov 2026, OUTSTANDING 44.9): a flow's timers, each
-- measuring how long dishes take between two points of the flow (drawn in
-- the designer as a dotted arrow). A list of
--   { id, name, from, from_when, to, per, target_mins }
-- from: 'start' (Orders in) or a station id (a venue's own flow) / box id (a
-- shared flow); from_when: 'reached' | 'done'; to: a station or box someone
-- taps (prep, expo, runner); per: 'dish' | 'ticket'. Tidied by
-- normaliseTimers() in shared/pos/kitchenTimers.js. Results are worked out
-- from kds_orders for the kitchen report; nothing on the tills, kitchen
-- screens or the venue hub reads them.

ALTER TABLE kds_flows ADD COLUMN IF NOT EXISTS timers jsonb NOT NULL DEFAULT '[]'::jsonb;
