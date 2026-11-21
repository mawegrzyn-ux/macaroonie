-- Voice for Pepper (OUTSTANDING 44, item 12; docs/PEPPER_FIRST.md 4.7, steps
-- 5a to 5c). Dictation and talk mode need no data. A spoken "yes" confirms a
-- card only when the group switches this on, and only for checks (a fridge,
-- hold or cooking reading, a checklist tick): VOICE_CONFIRM_TOOLS in
-- api/src/ai/chat.js. Money, orders, bookings, the rota and anything deleted
-- keep a tap.

ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS voice_confirm boolean NOT NULL DEFAULT false;
