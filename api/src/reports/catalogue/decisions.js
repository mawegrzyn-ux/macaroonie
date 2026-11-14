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
  // The lists a check's discounts and charges come from (what each gave is in till.discounts and till.charges),
  // and a tax rate's own % at a location or for an order type
  'pos_discounts', 'pos_charges', 'tax_rate_values',
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
  // Purchasing: what each venue orders and how; a price at one venue
  'purchasing_settings', 'supplier_venues', 'inv_quote_venue_prices', 'inv_preferred',
  'order_lists', 'order_list_items', 'order_list_pars', 'order_list_venues',
  // Food safety
  'fs_capture_times', 'fs_hold_capture_times', 'fs_cooking_settings',
  // Kitchen flows, the loyalty programme
  'kds_flows', 'loyalty_programmes',
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
    'pos_pairings', 'screen_pairings', 'menu_preview_links', 'report_print_links', 'loyalty_codes', 'loyalty_sessions', 'loyalty_wallet_devices',
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
  'Filled in until placed, then copied onto the purchase order lines reports read': [
    'supply_order_lines',
  ],
  'Reached only through the row they belong to': [
    'table_combination_members', 'feature_request_upvotes',
  ],
  'No longer written (booking emails are in email_log, reported as bookings.emails)': [
    'notification_log',
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
