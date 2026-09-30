-- ============================================================
-- 135_menu_print_designs.sql
--
-- More than one print design per menu (a full A3, a folded A4, a
-- table card, ...). Each design is its own row, with the same layout
-- shape menus.print_layout had (see 121, validated by LayoutBody in
-- api/src/routes/menus.js, rendered by shared/menuLayout.js).
--
-- menus.print_design_id picks the design used by the print page
-- (GET /api/menus/:id/print: admin Print, the website's PDF link).
-- NULL = the automatic layout. Any design can still be printed with
-- ?design=<id>.
--
-- Existing designed layouts become "Design 1" and stay the one used.
-- menus.print_layout is dropped.
-- ============================================================

CREATE TABLE IF NOT EXISTS menu_print_designs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  menu_id     uuid        NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  layout      jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menu_print_designs_menu_idx ON menu_print_designs (menu_id, created_at);

ALTER TABLE menu_print_designs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS menu_print_designs_tenant ON menu_print_designs;
CREATE POLICY menu_print_designs_tenant ON menu_print_designs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS print_design_id uuid REFERENCES menu_print_designs(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'menus' AND column_name = 'print_layout') THEN
    WITH moved AS (
      INSERT INTO menu_print_designs (tenant_id, menu_id, name, layout)
      SELECT tenant_id, id, 'Design 1', print_layout
        FROM menus
       WHERE print_layout IS NOT NULL
      RETURNING id, menu_id
    )
    UPDATE menus m SET print_design_id = moved.id FROM moved WHERE moved.menu_id = m.id;

    ALTER TABLE menus DROP COLUMN print_layout;
  END IF;
END $$;
