-- Migration 296: the receipt when a check is paid and the order prompt move
-- from the venue to the revenue stream (24 Nov 2026).
--
-- pos_revenue_streams.receipt_mode  'ask' (the till offers Close and print or
--                                   Close, no receipt) | 'always' | 'never'
-- pos_revenue_streams.order_prompt  'one' (one screen: the order types, the
--                                   name and the tent number together) |
--                                   'two' (the order type first)
-- A till's own choice (pos_devices.settings.receipt_mode / order_prompt)
-- still wins; its follow value is now 'stream' (was 'venue'): the check's
-- revenue stream (shared/pos/tillSettings.js receiptModeOf() /
-- orderPromptOf()). The till's screen layout stays a venue setting.
--
-- Each stream takes its venue's current values, then the venue columns go
-- (pre-production, CLAUDE.md: no fallback).

ALTER TABLE pos_revenue_streams ADD COLUMN IF NOT EXISTS receipt_mode text NOT NULL DEFAULT 'ask';
ALTER TABLE pos_revenue_streams DROP CONSTRAINT IF EXISTS pos_revenue_streams_receipt_mode_check;
ALTER TABLE pos_revenue_streams ADD CONSTRAINT pos_revenue_streams_receipt_mode_check CHECK (receipt_mode IN ('ask', 'always', 'never'));
ALTER TABLE pos_revenue_streams ADD COLUMN IF NOT EXISTS order_prompt text NOT NULL DEFAULT 'one';
ALTER TABLE pos_revenue_streams DROP CONSTRAINT IF EXISTS pos_revenue_streams_order_prompt_check;
ALTER TABLE pos_revenue_streams ADD CONSTRAINT pos_revenue_streams_order_prompt_check CHECK (order_prompt IN ('one', 'two'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'pos_settings' AND column_name = 'receipt_mode') THEN
    UPDATE pos_revenue_streams s
       SET receipt_mode = p.receipt_mode
      FROM pos_settings p
     WHERE p.venue_id = s.venue_id AND p.tenant_id = s.tenant_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'pos_settings' AND column_name = 'order_prompt') THEN
    UPDATE pos_revenue_streams s
       SET order_prompt = p.order_prompt
      FROM pos_settings p
     WHERE p.venue_id = s.venue_id AND p.tenant_id = s.tenant_id;
  END IF;
END $$;

ALTER TABLE pos_settings DROP COLUMN IF EXISTS receipt_mode;
ALTER TABLE pos_settings DROP COLUMN IF EXISTS order_prompt;

-- A till that followed the venue now follows the stream.
UPDATE pos_devices
   SET settings = settings || jsonb_build_object('receipt_mode', 'stream')
 WHERE settings->>'receipt_mode' = 'venue';
UPDATE pos_devices
   SET settings = settings || jsonb_build_object('order_prompt', 'stream')
 WHERE settings->>'order_prompt' = 'venue';
