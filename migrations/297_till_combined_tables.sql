-- Migration 297: combined tables on the till (26 Nov 2026).
--
-- A party sits across several tables and the till treats them as one: the
-- check keeps its main table (pos_checks.table_id) and holds the others in
-- its state's joined_table_ids, in the order they were joined (events
-- check.tables_joined / check.tables_split, shared/pos/checks.js; the rules
-- in shared/pos/tables.js).
--
-- pos_checks.joined_table_ids  the same list beside the check, written by
--                              projectionRows() (api/src/services/posSvc.js)
--                              like every other column of the row: who holds
--                              a table (the sequencer's openChecksOnTables())
--                              and what reports call a check's tables read it.
--
-- A table is held only while its check is open; a closed check keeps the
-- list as a record. Checks stored before today hold no joined tables, which
-- is what the default says, so nothing is projected again (proj_v stays).

ALTER TABLE pos_checks ADD COLUMN IF NOT EXISTS joined_table_ids uuid[] NOT NULL DEFAULT '{}';
