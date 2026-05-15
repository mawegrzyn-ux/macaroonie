-- ============================================================
-- 053_widget_holds_nullable_table.sql
--
-- The public booking widget creates holds at venue-level (no per-table
-- selection) because get_available_slots() returns aggregate capacity,
-- not per-table availability. booking_holds.table_id was NOT NULL,
-- so every widget hold INSERT failed with a constraint violation.
--
-- Fix: make table_id nullable on booking_holds only.
--
-- booking holds with table_id = NULL represent pending venue-level
-- slots. The confirm endpoint assigns the unallocated table row (or
-- creates it) so bookings.table_id stays NOT NULL and these bookings
-- appear in the Unallocated row on the timeline.
--
-- PostgreSQL UNIQUE treats NULLs as distinct, so multiple widget
-- holds for the same starts_at don't conflict with each other.
-- ============================================================

ALTER TABLE booking_holds
  ALTER COLUMN table_id DROP NOT NULL;
