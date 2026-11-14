-- 249_local_info_merge.sql
--
-- One entry per real event (14 Nov 2026): after each search capture's run
-- (not the weather), Pepper looks at what the venue's captures of that kind
-- found and puts the entries that are the same event or incident under
-- different names into one. The other reports of it stay stored, hidden
-- behind the entry, so the next capture that finds them again updates them
-- instead of adding them back; the entry lists them as Also reported as.
--
-- local_info_items gains:
--   merged_into       the entry this one was put into (always an entry
--                     that is itself merged into nothing). Never listed,
--                     never in reports; deleting the entry deletes them.
--                     Flags live on the entry: a merge moves them there.
--   keep_separate     staff said Not the same: never merged again.
--   merge_checked_at  when a merge pass last compared it with its
--                     neighbours (null: not yet, so the next pass does).
-- local_info_sources gains merge_error: why the last merge pass after its
-- run failed (the findings stay as they are and are looked at next time).

ALTER TABLE local_info_items
  ADD COLUMN IF NOT EXISTS merged_into      uuid REFERENCES local_info_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS keep_separate    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merge_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS local_info_items_merged
  ON local_info_items (tenant_id, merged_into) WHERE merged_into IS NOT NULL;

ALTER TABLE local_info_sources
  ADD COLUMN IF NOT EXISTS merge_error text;
