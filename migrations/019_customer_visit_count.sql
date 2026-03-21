-- ============================================================
-- 019_customer_visit_count.sql
--
-- Adds a manual visit-count adjustment column to customers.
--
-- Semantics:
--   visit_count  = pre-system or manually imported visit count
--   Total visits = visit_count + COUNT(linked bookings with active statuses)
--
-- Updated by: CSV import (5th column), PATCH /customers/:id,
--             and manual edits in the admin portal.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS visit_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN customers.visit_count IS
  'Historical / manually-adjusted visit count. '
  'Does not include bookings stored in the bookings table. '
  'Total visits = visit_count + COUNT(bookings for this customer).';
