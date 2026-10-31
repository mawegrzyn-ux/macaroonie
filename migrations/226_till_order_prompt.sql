-- Till: how it asks for a new order's order type, customer name and tent
-- number (pos/src/components/OrderPrompt.jsx). The prompt takes over the
-- screen with keys of its own (letters for a name, digits for a tent).
--
--   order_prompt  'one' (one screen: the order types, the name and the tent
--                 number together) or 'two' (two steps: the order type
--                 first, then the name and tent number it asks for).
--                 A till can have its own (pos_devices.settings.order_prompt).
ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS order_prompt text NOT NULL DEFAULT 'one';
ALTER TABLE pos_settings DROP CONSTRAINT IF EXISTS pos_settings_order_prompt_check;
ALTER TABLE pos_settings ADD CONSTRAINT pos_settings_order_prompt_check CHECK (order_prompt IN ('one', 'two'));
