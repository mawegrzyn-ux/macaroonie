-- Migration 295: leaving a table-service order with items not sent asks by
-- default (24 Nov 2026).
--
-- pos_devices.settings.leave_unsent  'ask' (or absent) = the till asks
--   whether to send them first (Send and leave, Leave without sending, Stay
--   on the order); 'leave' = it just leaves. leaveUnsent() in
--   pos/src/lib/checkOps.js; counter tills never ask.
--
-- Pre-production (CLAUDE.md): every till asks from now on, including those
-- that were set to just leave.
UPDATE pos_devices
   SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('leave_unsent', 'ask')
 WHERE kind = 'terminal';
