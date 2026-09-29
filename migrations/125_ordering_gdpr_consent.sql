-- ============================================================
-- 125_ordering_gdpr_consent.sql
--
-- GDPR for web ordering. At checkout the guest ticks a required box
-- agreeing their details (including any allergy information, which is
-- health data) are used only to handle the order, and may tick an
-- optional newsletter box. Both are recorded with the exact wording shown
-- and the time, so consent can be demonstrated later.
--
--   orders.data_consent_at   when the guest agreed to the order-only use
--   orders.consent           { data: { text, at }, marketing: { text, at } | null,
--                              policy_url } as shown at checkout
--
-- The newsletter choice also lives on the customer, since that is who
-- receives newsletters. A later order with the box unticked does not
-- unsubscribe anyone (not ticking is not withdrawing); staff unsubscribe
-- from the Customers page.
--
--   customers.marketing_opt_in          currently subscribed
--   customers.marketing_opt_in_at       when they last opted in
--   customers.marketing_opt_in_source   where ('web_order')
--   customers.marketing_opt_out_at      when they were last unsubscribed
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS data_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent         jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS marketing_opt_in        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at     timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_source text,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at    timestamptz;

-- Orders placed before this migration that ticked the old "Send me news
-- and offers" box: carry the opt-in onto their customer.
UPDATE customers c
   SET marketing_opt_in = true,
       marketing_opt_in_at = o.created_at,
       marketing_opt_in_source = 'web_order'
  FROM (
    SELECT customer_id, MAX(created_at) AS created_at
      FROM orders
     WHERE marketing_opt_in AND customer_id IS NOT NULL
     GROUP BY customer_id
  ) o
 WHERE c.id = o.customer_id AND NOT c.is_anonymised;

CREATE INDEX IF NOT EXISTS customers_marketing_idx
  ON customers (tenant_id) WHERE marketing_opt_in;
