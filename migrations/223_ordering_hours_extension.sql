-- Online ordering hours extended for one day, from the orders board's clock
-- button: { date, until, open, by, at }. On that date (venue time) the day's
-- last ordering window closes at `until` instead; on a day with no window,
-- ordering opens from `open` (when it was set) until `until`. Other dates
-- ignore it, so there's nothing to clear the next day. dayWindows() in
-- services/orderSvc.js is the one rule.
ALTER TABLE ordering_settings ADD COLUMN IF NOT EXISTS hours_extension jsonb;
