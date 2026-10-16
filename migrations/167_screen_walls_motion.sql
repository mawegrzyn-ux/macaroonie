-- 167_screen_walls_motion.sql
-- Menu screens, part two: walls, transitions, video.
--
--   screen_walls           several screens showing one board (or playlist)
--                          between them, cols x rows; `gap` is the pixels
--                          of board hidden behind the frames between two
--                          screens. Each screen shows its own part
--                          (shared/screenLayout.js wallRegion()).
--   screens.wall_*         which wall a screen belongs to and its place in
--                          it; while in a wall the screen shows the wall's
--                          boards, not its own design_id / playlist_id
--   screen_playlist_items.transition, transition_ms
--                          how the playlist moves to this board (fade,
--                          slide, ... TRANSITIONS in shared/screenLayout.js)
--
-- Videos are media_items with a video/* mimetype (routes/media.js); boards
-- point at them by URL like images, so no table for them. Block animations
-- live in each block's opts in screen_designs.layout.

BEGIN;

CREATE TABLE IF NOT EXISTS screen_walls (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  venue_id     uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name         text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  cols         int         NOT NULL DEFAULT 2 CHECK (cols BETWEEN 1 AND 6),
  rows         int         NOT NULL DEFAULT 1 CHECK (rows BETWEEN 1 AND 6),
  gap          int         NOT NULL DEFAULT 0 CHECK (gap BETWEEN 0 AND 400),
  playlist_id  uuid        REFERENCES screen_playlists(id) ON DELETE SET NULL,
  design_id    uuid        REFERENCES screen_designs(id) ON DELETE SET NULL,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (playlist_id IS NULL OR design_id IS NULL)
);
CREATE INDEX IF NOT EXISTS screen_walls_tenant ON screen_walls (tenant_id, sort_order);
ALTER TABLE screen_walls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screen_walls_tenant ON screen_walls;
CREATE POLICY screen_walls_tenant ON screen_walls
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP TRIGGER IF EXISTS trg_screen_walls_updated_at ON screen_walls;
CREATE TRIGGER trg_screen_walls_updated_at BEFORE UPDATE ON screen_walls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE screens
  ADD COLUMN IF NOT EXISTS wall_id  uuid REFERENCES screen_walls(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wall_col int  CHECK (wall_col BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS wall_row int  CHECK (wall_row BETWEEN 0 AND 5);
-- One screen per place in a wall (a removed wall leaves wall_id NULL).
CREATE UNIQUE INDEX IF NOT EXISTS screens_wall_place ON screens (wall_id, wall_col, wall_row) WHERE wall_id IS NOT NULL;

ALTER TABLE screen_playlist_items
  ADD COLUMN IF NOT EXISTS transition text NOT NULL DEFAULT 'fade'
    CHECK (transition IN ('none', 'fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down', 'zoom', 'wipe')),
  ADD COLUMN IF NOT EXISTS transition_ms int NOT NULL DEFAULT 800 CHECK (transition_ms BETWEEN 0 AND 5000);

COMMIT;
