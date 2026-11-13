// src/reports/catalogue/decisions.js
//
// Every table in the database has a decision (docs/REPORTS.md 5.6):
//
//   in the catalogue   a subject reads it. Not listed here: it is worked out
//                      from the catalogue itself (each subject's tables)
//   planned            will be reported on in a later phase: its area, and
//                      whether its rows are things that happen (counted and
//                      added up) or things to group by (names, people, places)
//   settings           how something is set up: a few named fields will be
//                      offered beside the subject they belong to, the rest
//                      left out
//   left out           never reported on, with the reason
//
// api/test/reports-catalogue.test.mjs compares this with the database: a
// table with no decision, with two, or a name here that is no longer a table
// fails it. A new table needs one line here (or a subject in the catalogue).

/** Reported on later. { area: { happen: [...], group: [...] } }, all in phase 3 unless `phase` says otherwise. */
export const PLANNED = {
  till: {
    happen: [
      'pos_card_payments', 'pos_print_jobs', 'pos_event_rejections',
      // An activity list (who did what, when, on which till, who approved it):
      // never an event's contents, and never the source of a figure.
      'pos_events',
      // Counts only: the address a receipt is waiting for is sealed and left out.
      'pos_receipts',
    ],
    group: ['pos_roles', 'pos_discounts', 'pos_charges', 'pos_printers', 'pos_card_readers', 'floor_areas', 'tax_rates', 'tax_rate_values'],
  },
  kitchen: {
    happen: ['kds_log', 'kds_orders'],
    group: ['kds_stations', 'kds_flows'],
  },
  kiosks: {
    // The summary columns of a visit; its recorded touches stay out.
    happen: ['kiosk_sessions'],
    group: ['kiosk_designs'],
  },
  online: {
    happen: ['order_events', 'ordering_item_availability'],
    group: ['promotions'],
  },
  bookings: {
    happen: ['email_log', 'notification_log'],
    group: ['table_combinations'],
  },
  guests: {
    happen: ['reviews'],
    group: [],
  },
  menus: {
    happen: ['menu_releases'],
    group: ['menu_variant_groups', 'menu_variant_options', 'menu_dietary_tags', 'menu_item_dietary', 'menu_item_variant_groups', 'menu_item_variant_prices', 'menu_item_variants'],
  },
  cash: {
    happen: ['cash_daily_reports', 'cash_income_entries', 'cash_takings_entries', 'cash_sc_entries', 'cash_expenses', 'cash_wage_reports', 'cash_wage_entries'],
    group: ['cash_income_sources', 'cash_payment_channels', 'cash_sc_sources', 'cash_expense_categories'],
  },
  staff: {
    happen: ['rota_entries', 'rota_pay_adjustments', 'rota_tip_moves', 'rota_tip_move_lines', 'rota_week_staff', 'rota_week_pot_lines', 'rota_week_pot_manual', 'staff_rota_off'],
    group: ['staff_roles', 'rota_shifts', 'tip_pots', 'tip_pot_lines', 'staff_shift_rates'],
  },
  purchasing: {
    happen: ['purchase_orders', 'purchase_order_lines', 'purchase_invoices', 'supply_orders', 'supply_order_lines', 'inv_price_history'],
    group: ['suppliers', 'supplier_venues', 'inv_items', 'inv_categories', 'inv_quotes', 'inv_quote_venue_prices', 'inv_preferred', 'order_lists', 'order_list_items', 'order_list_pars', 'order_list_venues'],
  },
  safety: {
    happen: ['fs_temp_logs', 'fs_hold_checks', 'fs_cooking_checks', 'fs_delivery_checks', 'checklist_instances', 'checklist_instance_items', 'hs_action_log'],
    group: ['fs_equipment', 'fs_hold_stations', 'fs_cooking_sessions', 'fs_cooking_items', 'checklist_templates', 'checklist_template_items', 'hs_action_categories'],
  },
  loyalty: {
    happen: ['loyalty_ledger', 'loyalty_redemptions', 'loyalty_member_rewards'],
    group: ['loyalty_members', 'loyalty_programmes', 'loyalty_rewards', 'loyalty_stamp_cards'],
  },
  screens: {
    happen: [],
    group: ['screens', 'screen_designs', 'screen_playlists', 'screen_walls'],
  },
  website: {
    happen: [],
    group: ['website_pages', 'media_items', 'media_categories'],
  },
  local: {
    happen: ['local_info_items'],
    group: ['local_info_sources'],
  },
  pepper: {
    // Counts and dates only: never what was said.
    happen: ['ai_usage', 'ai_usage_people', 'ai_actions', 'ai_conversations'],
    group: [],
  },
  group: {
    // The group's own openings, issues and requests.
    happen: ['store_openings', 'issue_log', 'feature_requests'],
    group: ['users', 'tenant_roles'],
  },
  reports: {
    // Who ran which report, and when (with schedules and past runs).
    phase: 4,
    happen: ['report_runs'],
    group: [],
  },
}

/** How something is set up: a few named fields offered later, the rest left out. */
export const SETTINGS = [
  // Till
  'pos_settings', 'pos_charge_rules', 'pos_stream_order_types', 'pos_till_layouts', 'pos_order_flows',
  'pos_card_accounts', // its name and provider only
  'print_designs', 'print_design_uses',
  // Online ordering and its links
  'ordering_settings', 'deliveroo_settings', 'deliveroo_item_links', 'loyverse_venue_links',
  // Bookings
  'booking_rules', 'deposit_rules', 'venue_schedule_templates', 'venue_sittings', 'sitting_slot_caps',
  'schedule_date_overrides', 'override_sittings', 'override_slot_caps', 'schedule_exceptions',
  'exception_day_templates', 'exception_sittings', 'exception_sitting_slot_caps', 'disallowed_table_pairs',
  'email_templates',
  // Menus
  'menu_times', 'menu_translations',
  // Cash and rota
  'cash_venue_settings', 'cash_wage_defaults', 'rota_settings', 'rota_week_pot_payees',
  // Purchasing, food safety
  'purchasing_settings', 'fs_capture_times', 'fs_hold_capture_times', 'fs_cooking_settings',
  // Website
  'tenant_site', 'website_config', 'website_opening_hours', 'website_menu_documents', 'website_allergen_info', 'website_gallery_images',
  // Pepper, the group
  'ai_settings', 'tenant_modules',
  'tenants', // the group's own name
]

/** Never reported on. { reason: [tables] } */
export const LEFT_OUT = {
  'Secrets and keys': [
    'platform_secrets', 'loyverse_connections', 'venue_email_settings', 'loyalty_wallet_settings', 'staging_access',
  ],
  'Tokens, codes and sessions': [
    'pos_pairings', 'screen_pairings', 'menu_preview_links', 'loyalty_codes', 'loyalty_sessions', 'loyalty_wallet_devices',
    'ai_access_tokens', 'ai_oauth_clients', 'ai_oauth_grants', 'ai_booking_codes', 'ai_booking_grants',
  ],
  'Conversations and files': [
    'ai_messages', 'ai_attachments', 'ai_pending_actions',
  ],
  'Layouts and designs with nothing to count': [
    'print_design_variations', 'menu_print_designs', 'menu_callouts', 'menu_allergen_notice', 'screen_playlist_items',
    'nav_items', 'dashboard_tiles', 'hs_dashboards', 'hs_dashboard_widgets',
    // The reports themselves and who starred them.
    'reports', 'report_stars',
  ],
  'Working state that changes from minute to minute': [
    'pos_venue_state', 'kds_flow_edges', 'kds_balance_turns', 'booking_holds', 'table_occupancy', 'review_scrape_jobs',
  ],
  'Reached only through the row they belong to': [
    'table_combination_members', 'feature_request_upvotes',
  ],
  'Shared across groups': [
    'loyalty_identities',
  ],
  'The platform\'s own, the same for every group': [
    'platform_admins', 'platform_interest', 'platform_settings', 'backlog_items', 'schema_migrations', 'changelog_entries',
  ],
}

/** The tables a catalogue's subjects read. Map(table -> [subject keys]). */
export function catalogueTables(catalogue) {
  const out = new Map()
  for (const s of Object.values(catalogue.subjects)) {
    for (const t of s.from.tables) {
      if (!out.has(t)) out.set(t, [])
      out.get(t).push(s.key)
    }
  }
  return out
}

/**
 * Every decision as one list: [{ table, kind: 'subject' | 'planned' |
 * 'settings' | 'out', ... }], a table once for each place it is named (the
 * test fails on a table named twice).
 */
export function tableDecisions(catalogue) {
  const out = []
  for (const [table, subjects] of catalogueTables(catalogue)) out.push({ table, kind: 'subject', subjects })
  for (const [area, a] of Object.entries(PLANNED)) {
    for (const table of a.happen) out.push({ table, kind: 'planned', area, rows: 'happen', phase: a.phase || 3 })
    for (const table of a.group) out.push({ table, kind: 'planned', area, rows: 'group', phase: a.phase || 3 })
  }
  for (const table of SETTINGS) out.push({ table, kind: 'settings' })
  for (const [reason, tables] of Object.entries(LEFT_OUT)) for (const table of tables) out.push({ table, kind: 'out', reason })
  return out
}

/**
 * The decisions against the tables a database has: { missing (tables with
 * no decision), twice (decided more than once), gone (named here, not a
 * table any more), counts }.
 */
export function checkDecisions(catalogue, tables) {
  const list = tableDecisions(catalogue)
  const seen = new Map()
  for (const d of list) seen.set(d.table, (seen.get(d.table) || 0) + 1)
  const have = new Set(tables)
  const counts = { subject: 0, planned: 0, settings: 0, out: 0 }
  for (const d of list) counts[d.kind]++
  return {
    missing: tables.filter(t => !seen.has(t)).sort(),
    twice: [...seen].filter(([, n]) => n > 1).map(([t]) => t).sort(),
    gone: [...seen.keys()].filter(t => !have.has(t)).sort(),
    counts,
  }
}
