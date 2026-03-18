-- ============================================================
-- 007_seed_example.sql
-- Example seed: one tenant, one venue, full schedule config
-- Run in dev/staging only. Not for production.
-- ============================================================

DO $$
DECLARE
  v_tenant_id   uuid := gen_random_uuid();
  v_venue_id    uuid := gen_random_uuid();
  v_section_id  uuid := gen_random_uuid();
  v_table1_id   uuid := gen_random_uuid();
  v_table2_id   uuid := gen_random_uuid();
  v_table3_id   uuid := gen_random_uuid();
  v_fri_tmpl_id uuid;
  v_fri_lunch   uuid;
  v_fri_dinner  uuid;
  v_override_id uuid;
  v_ovr_sitting uuid;
BEGIN

  -- Tenant
  INSERT INTO tenants (id, name, slug, plan)
  VALUES (v_tenant_id, 'Demo Restaurant Group', 'demo-rg', 'pro');

  -- Venue
  INSERT INTO venues (id, tenant_id, name, slug, timezone, currency, zero_cap_display)
  VALUES (v_venue_id, v_tenant_id, 'The Main Street Bistro', 'main-street-bistro',
          'Europe/London', 'GBP', 'hidden');

  -- Section
  INSERT INTO venue_sections (id, venue_id, tenant_id, name, sort_order)
  VALUES (v_section_id, v_venue_id, v_tenant_id, 'Main Floor', 1);

  -- Tables
  INSERT INTO tables (id, venue_id, section_id, tenant_id, label, min_covers, max_covers, sort_order)
  VALUES
    (v_table1_id, v_venue_id, v_section_id, v_tenant_id, 'T1', 2, 4, 1),
    (v_table2_id, v_venue_id, v_section_id, v_tenant_id, 'T2', 2, 6, 2),
    (v_table3_id, v_venue_id, v_section_id, v_tenant_id, 'T3', 1, 2, 3);

  -- Booking rules
  INSERT INTO booking_rules (venue_id, tenant_id, slot_duration_mins, buffer_after_mins,
                              min_covers, max_covers, book_from_days, book_until_days,
                              cutoff_before_mins, hold_ttl_secs)
  VALUES (v_venue_id, v_tenant_id, 90, 15, 1, 12, 0, 90, 60, 300);

  -- Deposit rules (£5 per cover)
  INSERT INTO deposit_rules (venue_id, tenant_id, requires_deposit, deposit_type,
                              deposit_amount, currency, refund_hours_before)
  VALUES (v_venue_id, v_tenant_id, true, 'per_cover', 5.00, 'GBP', 48);

  -- ── Weekly schedule: Friday (day_of_week = 5) ───────────────
  INSERT INTO venue_schedule_templates (id, venue_id, tenant_id, day_of_week, is_open, slot_interval_mins)
  VALUES (gen_random_uuid(), v_venue_id, v_tenant_id, 5, true, 15)
  RETURNING id INTO v_fri_tmpl_id;

  -- Friday lunch sitting: 12:00–15:00, default 30 covers
  INSERT INTO venue_sittings (id, template_id, venue_id, tenant_id,
                               opens_at, closes_at, default_max_covers, sort_order)
  VALUES (gen_random_uuid(), v_fri_tmpl_id, v_venue_id, v_tenant_id,
          '12:00', '15:00', 30, 1)
  RETURNING id INTO v_fri_lunch;

  -- Friday dinner sitting: 18:00–23:00, default 40 covers
  INSERT INTO venue_sittings (id, template_id, venue_id, tenant_id,
                               opens_at, closes_at, default_max_covers, sort_order)
  VALUES (gen_random_uuid(), v_fri_tmpl_id, v_venue_id, v_tenant_id,
          '18:00', '23:00', 40, 2)
  RETURNING id INTO v_fri_dinner;

  -- Friday dinner: per-slot cover caps
  -- 18:15 → 40 (default, explicit for clarity)
  -- 18:30 → 30
  -- 18:45 → 20
  -- 19:00 → 0 (blocked — last sitting already seated, hidden from widget)
  INSERT INTO sitting_slot_caps (sitting_id, venue_id, tenant_id, slot_time, max_covers)
  VALUES
    (v_fri_dinner, v_venue_id, v_tenant_id, '18:30', 30),
    (v_fri_dinner, v_venue_id, v_tenant_id, '18:45', 20),
    (v_fri_dinner, v_venue_id, v_tenant_id, '19:00', 0);

  -- ── Closed days: Monday + Tuesday ───────────────────────────
  INSERT INTO venue_schedule_templates (venue_id, tenant_id, day_of_week, is_open, slot_interval_mins)
  VALUES
    (v_venue_id, v_tenant_id, 1, false, 15),  -- Monday
    (v_venue_id, v_tenant_id, 2, false, 15);  -- Tuesday

  -- ── Date override: Christmas Eve 2025 ───────────────────────
  INSERT INTO schedule_date_overrides (id, venue_id, tenant_id, override_date,
                                       is_open, slot_interval_mins, label)
  VALUES (gen_random_uuid(), v_venue_id, v_tenant_id, '2025-12-24',
          true, 30, 'Christmas Eve')
  RETURNING id INTO v_override_id;

  -- Christmas Eve: one sitting only, 12:00–17:00, max 60 covers
  INSERT INTO override_sittings (id, override_id, venue_id, tenant_id,
                                  opens_at, closes_at, default_max_covers, sort_order)
  VALUES (gen_random_uuid(), v_override_id, v_venue_id, v_tenant_id,
          '12:00', '17:00', 60, 1)
  RETURNING id INTO v_ovr_sitting;

  RAISE NOTICE 'Seed complete. tenant_id=%, venue_id=%', v_tenant_id, v_venue_id;
END $$;
