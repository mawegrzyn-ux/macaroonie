-- 173_pepper.sql
--
-- The staff AI assistant is now called Pepper and works across every area,
-- so its module (ai_assistant) leaves the Bookings group for its own
-- "Pepper (AI assistant)" switch (config/modules.js). The module's
-- tenant_modules rows are kept as they are: a tenant that had Bookings
-- switched off keeps Pepper off until an owner switches it on.
--
-- Navigation links seeded as "AI assistant" (migration 148, defaultNav.js)
-- are renamed; a label an operator changed by hand is left alone.

UPDATE nav_items
   SET label = 'Pepper'
 WHERE route = '/ai' AND label = 'AI assistant';
