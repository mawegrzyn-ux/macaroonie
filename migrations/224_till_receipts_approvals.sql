-- Till: what happens to the receipt when a check is paid, and actions that
-- need a manager every time.
--
--   receipt_mode  'ask' (the till asks: Close and print / Close, no receipt),
--                 'always' (prints and closes), 'never' (closes without one).
--                 A till can have its own (pos_devices.settings.receipt_mode).
--   approvals     { delete_unsent, void_sent, cancel_order, refund }: true =
--                 someone whose role has Approve for others must allow it,
--                 whatever the person's own role allows (shared/pos/
--                 permissions.js MANAGER_ACTIONS, checked by the check rules).
ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS receipt_mode text NOT NULL DEFAULT 'ask';
ALTER TABLE pos_settings DROP CONSTRAINT IF EXISTS pos_settings_receipt_mode_check;
ALTER TABLE pos_settings ADD CONSTRAINT pos_settings_receipt_mode_check CHECK (receipt_mode IN ('ask', 'always', 'never'));
ALTER TABLE pos_settings ADD COLUMN IF NOT EXISTS approvals jsonb NOT NULL DEFAULT '{}'::jsonb;
