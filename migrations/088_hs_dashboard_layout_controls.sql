-- ============================================================
-- 088_hs_dashboard_layout_controls.sql
--
-- Per-dashboard column count and per-widget width/height controls
-- for the H&S Dashboard.
--
-- `hs_dashboards.column_count`        — how many grid columns the
--                                        dashboard's widget grid uses
--                                        (1-6, default 4)
-- `hs_dashboard_widgets.col_span`     — how many of those columns one
--                                        widget's card spans (1-6,
--                                        clamped to column_count at
--                                        render time so lowering the
--                                        dashboard's column count
--                                        later never orphans a wider
--                                        card)
-- `hs_dashboard_widgets.height_px`    — the widget card's scrollable
--                                        content height in pixels
--                                        (240-1200, default 480 —
--                                        matches the previous fixed
--                                        max-height)
-- ============================================================

BEGIN;

ALTER TABLE hs_dashboards
  ADD COLUMN IF NOT EXISTS column_count int NOT NULL DEFAULT 4
    CHECK (column_count BETWEEN 1 AND 6);

ALTER TABLE hs_dashboard_widgets
  ADD COLUMN IF NOT EXISTS col_span int NOT NULL DEFAULT 1
    CHECK (col_span BETWEEN 1 AND 6),
  ADD COLUMN IF NOT EXISTS height_px int NOT NULL DEFAULT 480
    CHECK (height_px BETWEEN 240 AND 1200);

COMMIT;
