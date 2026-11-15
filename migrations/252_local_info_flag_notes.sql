-- 252: Local info flags can say why.
--
-- A flag on what a capture found (migration 248) takes a short note: why it
-- is relevant, or why it isn't. Other staff see it under the item, and Pepper
-- reads it with the flags when it tunes the capture's search. The note goes
-- with its flag: taking the flag off deletes the row, and flagging the other
-- way without a new note clears it.

ALTER TABLE local_info_feedback
  ADD COLUMN IF NOT EXISTS note text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 200);
