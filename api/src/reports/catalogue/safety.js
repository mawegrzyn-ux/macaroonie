// src/reports/catalogue/safety.js
//
// Food safety and health & safety in the report catalogue: fridge and
// freezer readings, hot and cold hold checks, cooking checks, delivery
// checks, checklists done and their tasks, and the H&S action log, with
// the fridges, stations, sessions and checklists they belong to.
//
// A reading is out of range when it was logged outside its limits
// (is_within_range false); it is put right when someone wrote what was done
// (a corrective action). A delivery passes when every check was ticked and it
// was accepted. Each kind of check has its own module, as on its page. Test
// readings the H&S test data made are read like real ones.

import { subject, text, number, yesno, choice, date, moment, duration, avg, min, max, count, ratio, one, many } from './define.js'

const OUT = '{t}.is_within_range = false'
// The Overview tiles' rule (services/hsStatus.js): any corrective action written counts.
const NO_ACTION = "COALESCE({t}.corrective_action, '') = ''"
const UNRESOLVED = '(' + OUT + ' AND ' + NO_ACTION + ')'
const PASSED = '({t}.packaging_ok AND {t}.damage_ok AND {t}.quality_ok AND {t}.temp_ok AND {t}.accepted)'
const HHMM = sql => "to_char(" + sql + ", 'HH24:MI')"
const TODAY = '(now() AT TIME ZONE {tz})::date'
const DAYS_OPEN = '(COALESCE(({t}.completed_at AT TIME ZONE {tz})::date, ' + TODAY + ') - {t}.logged_date)'
const KINDS = { fridge: 'Fridge', freezer: 'Freezer', hot_hold: 'Hot hold', cold_hold: 'Cold hold', other: 'Other' }

/** The usual fields of a temperature reading: when, who, what was done. */
const readingFields = () => ({
  recorded_at: moment('recorded_at', { label: 'Taken at' }),
  recorded_by: text('recorded_by', { label: 'Taken by' }),
  in_range: yesno('is_within_range', { label: 'In range' }),
  unresolved: yesno({ sql: UNRESOLVED }, { label: 'Out of range, nothing done' }),
  corrective_action: text('corrective_action', { label: 'What was done' }),
  notes: text('notes'),
})

/** The usual figures of temperature readings. */
const readingMeasures = col => ({
  readings: count({ label: 'Readings' }),
  out_of_range: count({ label: 'Out of range', where: OUT, about: 'Readings logged outside their limits.' }),
  unresolved_count: count({ label: 'Out of range, nothing done', where: UNRESOLVED, about: 'Readings out of range with no corrective action written.' }),
  in_range_rate: ratio('in_range_count', 'readings', { type: 'percent', label: 'In range', about: 'Readings in range out of every reading.' }),
  in_range_count: count({ label: 'Readings in range', where: '{t}.is_within_range', about: 'Readings logged inside their limits.' }),
  average_temp: avg(col, { label: 'Average °C', decimals: 1 }),
  lowest_temp: min(col, { label: 'Lowest °C', decimals: 1 }),
  highest_temp: max(col, { label: 'Highest °C', decimals: 1 }),
})

/** A check time's label (fs_capture_times / fs_hold_capture_times are settings, not subjects). */
const checkTime = table => text({ sql: '(SELECT c.label FROM ' + table + ' c WHERE c.id = {t}.capture_time_id AND c.tenant_id = {t}.tenant_id)' }, { label: 'Check time' })

export default [
  subject({
    key: 'safety.fridges',
    label: 'Fridges and freezers',
    one: 'fridge or freezer',
    area: 'safety',
    module: 'food_safety',
    about: 'The fridges and freezers whose temperatures are checked, with their limits.',
    from: 'fs_equipment',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      kind: choice('equipment_type', KINDS, { label: 'Kind' }),
      target: number('target_temp_c', { label: 'Target °C', decimals: 1 }),
      lowest: number('min_temp_c', { label: 'Lowest allowed °C', decimals: 1 }),
      highest: number('max_temp_c', { label: 'Highest allowed °C', decimals: 1 }),
      location: text('location', { label: 'Where it is' }),
      notes: text('notes'),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { fridges: count({ label: 'Fridges and freezers', where: '{t}.is_active', about: 'Those in use.' }) },
    links: { readings: many('safety.fridge_checks', 'equipment_id', { label: 'Readings' }) },
    list: ['name', 'venue.name', 'kind', 'lowest', 'highest', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'safety.fridge_checks',
    label: 'Fridge and freezer checks',
    one: 'reading',
    area: 'safety',
    module: 'food_safety',
    about: 'Every fridge and freezer temperature logged, on the day it was for. Out of range: outside the unit\'s limits.',
    from: 'fs_temp_logs',
    venue: 'venue_id',
    date: { sql: '{t}.log_date', label: 'Day' },
    fields: {
      temperature: number('temperature_c', { label: 'Temperature °C', decimals: 1 }),
      check_time: checkTime('fs_capture_times'),
      ...readingFields(),
    },
    measures: readingMeasures('temperature_c'),
    links: { fridge: one('safety.fridges', 'equipment_id', { label: 'Fridge or freezer' }) },
    list: ['date', 'recorded_at', 'venue.name', 'fridge.name', 'check_time', 'temperature', 'in_range', 'corrective_action'],
    sort: [{ by: 'recorded_at', dir: 'desc' }],
    skip: ['is_generated', 'created_at'],
  }),

  subject({
    key: 'safety.hold_stations',
    label: 'Hold stations',
    one: 'hold station',
    area: 'safety',
    module: 'food_safety',
    about: 'Where food is kept hot or cold for service, with their limits.',
    from: 'fs_hold_stations',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      kind: choice('hold_type', { hot_hold: 'Hot hold', cold_hold: 'Cold hold' }, { label: 'Kind' }),
      target: number('target_temp_c', { label: 'Target °C', decimals: 1 }),
      lowest: number('min_temp_c', { label: 'Lowest allowed °C', decimals: 1 }),
      highest: number('max_temp_c', { label: 'Highest allowed °C', decimals: 1 }),
      location: text('location', { label: 'Where it is' }),
      notes: text('notes'),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { stations: count({ label: 'Hold stations', where: '{t}.is_active', about: 'Those in use.' }) },
    links: { readings: many('safety.hold_checks', 'station_id', { label: 'Readings' }) },
    list: ['name', 'venue.name', 'kind', 'lowest', 'highest', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'safety.hold_checks',
    label: 'Hold checks',
    one: 'reading',
    area: 'safety',
    module: 'food_safety',
    about: 'Every hot and cold hold temperature logged, on the day it was for.',
    from: 'fs_hold_checks',
    venue: 'venue_id',
    date: { sql: '{t}.check_date', label: 'Day' },
    fields: {
      temperature: number('temperature_c', { label: 'Temperature °C', decimals: 1 }),
      check_time: checkTime('fs_hold_capture_times'),
      ...readingFields(),
    },
    measures: readingMeasures('temperature_c'),
    links: { station: one('safety.hold_stations', 'station_id', { label: 'Hold station' }) },
    list: ['date', 'recorded_at', 'venue.name', 'station.name', 'check_time', 'temperature', 'in_range', 'corrective_action'],
    sort: [{ by: 'recorded_at', dir: 'desc' }],
    skip: ['is_generated', 'created_at'],
  }),

  subject({
    key: 'safety.cooking_sessions',
    label: 'Cooking check sessions',
    one: 'session',
    area: 'safety',
    module: 'food_safety',
    about: 'The times of day dishes have their cooking temperature checked, and how many to check.',
    from: 'fs_cooking_sessions',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('label'),
      time: text({ sql: HHMM('{t}.time_of_day') }, { label: 'Time' }),
      required: number('required_items_count', { label: 'Dishes to check', decimals: 0 }),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { sessions: count({ label: 'Sessions', where: '{t}.is_active', about: 'Those in use.' }) },
    links: { checks: many('safety.cooking_checks', 'session_id', { label: 'Cooking checks' }) },
    list: ['name', 'venue.name', 'time', 'required', 'active'],
    sort: [{ by: 'time', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'safety.cooking_items',
    label: 'Cooking check dishes',
    one: 'dish',
    area: 'safety',
    module: 'food_safety',
    about: 'The venue\'s own list of dishes for cooking checks (beside the dishes on its menus).',
    from: 'fs_cooking_items',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      category: text('category', { label: 'Tab' }),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { dishes: count({ label: 'Dishes', where: '{t}.is_active', about: 'Those in use.' }) },
    links: { checks: many('safety.cooking_checks', 'cooking_item_id', { label: 'Cooking checks' }) },
    list: ['name', 'category', 'venue.name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'safety.cooking_checks',
    label: 'Cooking checks',
    one: 'cooking check',
    area: 'safety',
    module: 'food_safety',
    about: 'Every core temperature taken of a cooked or reheated dish, on the day it was for.',
    from: 'fs_cooking_checks',
    name: 'dish_name',
    venue: 'venue_id',
    date: { sql: '{t}.check_date', label: 'Day' },
    fields: {
      dish_name: text('dish_name', { label: 'Dish' }),
      core_temp: number('core_temp_c', { label: 'Core temperature °C', decimals: 1 }),
      held_for: duration('hold_seconds', { label: 'Held for' }),
      ...readingFields(),
    },
    measures: readingMeasures('core_temp_c'),
    links: {
      session: one('safety.cooking_sessions', 'session_id', { label: 'Session' }),
      dish: one('menu.dishes', 'menu_item_id', { label: 'Menu dish' }),
      own_dish: one('safety.cooking_items', 'cooking_item_id', { label: 'Dish from the venue\'s own list' }),
    },
    list: ['date', 'recorded_at', 'venue.name', 'session.name', 'dish_name', 'core_temp', 'in_range', 'corrective_action'],
    sort: [{ by: 'recorded_at', dir: 'desc' }],
    skip: ['is_generated', 'created_at'],
  }),

  subject({
    key: 'safety.delivery_checks',
    label: 'Delivery checks',
    one: 'delivery check',
    area: 'safety',
    module: 'food_safety',
    about: 'Every delivery checked on arrival: packaging, damage, quality and temperature, and whether it was accepted.',
    from: 'fs_delivery_checks',
    name: 'supplier',
    venue: 'venue_id',
    date: { sql: '{t}.delivery_date', label: 'Day' },
    fields: {
      supplier: text('vendor_name', { label: 'Supplier' }),
      packaging_ok: yesno('packaging_ok', { label: 'Packaging all right' }),
      damage_ok: yesno('damage_ok', { label: 'Nothing damaged' }),
      quality_ok: yesno('quality_ok', { label: 'Quality all right' }),
      temp_ok: yesno('temp_ok', { label: 'Temperature all right' }),
      product_temp: number('product_temp_c', { label: 'Product temperature °C', decimals: 1 }),
      accepted: yesno('accepted', { label: 'Accepted' }),
      passed: yesno({ sql: PASSED }, { label: 'Passed every check' }),
      unresolved: yesno({ sql: '(NOT ' + PASSED + ' AND ' + NO_ACTION + ')' }, { label: 'Failed, nothing done' }),
      corrective_action: text('corrective_action', { label: 'What was done' }),
      notes: text('notes'),
      recorded_at: moment('recorded_at', { label: 'Checked at' }),
      recorded_by: text('recorded_by', { label: 'Checked by' }),
    },
    measures: {
      deliveries: count({ label: 'Deliveries checked' }),
      failed: count({ label: 'Failed a check', where: 'NOT ' + PASSED, about: 'Deliveries with a check not ticked, or not accepted.' }),
      rejected: count({ label: 'Not accepted', where: 'NOT {t}.accepted', about: 'Deliveries turned away.' }),
      unresolved_count: count({ label: 'Failed, nothing done', where: '(NOT ' + PASSED + ' AND ' + NO_ACTION + ')', about: 'Deliveries that failed a check with no corrective action written.' }),
      passed_count: count({ label: 'Passed every check', where: PASSED, about: 'Deliveries with every check ticked and accepted.' }),
      pass_rate: ratio('passed_count', 'deliveries', { type: 'percent', label: 'Passed', about: 'Deliveries that passed every check out of every delivery checked.' }),
    },
    links: {
      order: one('purchasing.orders', 'purchase_order_id', { label: 'Supplier order', needs: 'purchasing' }),
    },
    list: ['date', 'venue.name', 'supplier', 'product_temp', 'passed', 'accepted', 'corrective_action'],
    sort: [{ by: 'recorded_at', dir: 'desc' }],
    // What came, as typed: the supplier order's lines say it item by item.
    skip: ['items', 'is_generated', 'created_at'],
  }),

  subject({
    key: 'safety.checklist_templates',
    label: 'Checklists',
    one: 'checklist',
    area: 'safety',
    module: 'checklists',
    about: 'The checklists set up for each venue, and how often each is due.',
    from: 'checklist_templates',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name'),
      department: text('department'),
      frequency: choice('frequency', { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }, { label: 'Due' }),
      due_weekday: choice({ sql: '({t}.due_day_of_week)::text' }, { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' }, { label: 'Due on (weekly)' }),
      due_day: number('due_day_of_month', { label: 'Due on day (monthly)', decimals: 0 }),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { checklists: count({ label: 'Checklists', where: '{t}.is_active', about: 'Checklists in use.' }) },
    links: {
      tasks: many('safety.checklist_tasks', 'template_id', { label: 'Tasks' }),
      done: many('safety.checklists', 'template_id', { label: 'Times done' }),
    },
    list: ['name', 'venue.name', 'department', 'frequency', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'safety.checklist_tasks',
    label: 'Checklist tasks',
    one: 'task',
    area: 'safety',
    module: 'checklists',
    about: 'The tasks on each checklist.',
    from: 'checklist_template_items',
    name: 'task',
    venue: { sql: '{checklist}.venue_id' },
    fields: {
      task: text('label'),
      description: text('description'),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { tasks: count({ label: 'Tasks', where: '{t}.is_active', about: 'Tasks in use.' }) },
    links: {
      checklist: one('safety.checklist_templates', 'template_id', { label: 'Checklist' }),
      ticks: many('safety.checklist_ticks', 'template_item_id', { label: 'Each time it was due' }),
    },
    list: ['checklist.name', 'task', 'active'],
    sort: [{ by: 'task', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'safety.checklists',
    label: 'Checklists done',
    one: 'checklist',
    area: 'safety',
    module: 'checklists',
    about: 'Each checklist someone started, on the first day of the period it was for (the day, the week\'s Monday or the month\'s 1st). Done: every task ticked.',
    from: 'checklist_instances',
    name: 'name',
    venue: 'venue_id',
    date: { sql: '{t}.period_start', label: 'Period starting' },
    fields: {
      name: text({ sql: '{checklist}.name' }, { label: 'Checklist' }),
      status: choice('status', { in_progress: 'Started', completed: 'Done' }),
      done_at: moment('completed_at', { label: 'Done at' }),
      done_by: text('completed_by', { label: 'Done by' }),
      notes: text('notes'),
      started_at: moment('created_at', { label: 'Started at' }),
      changed_at: moment('updated_at', { label: 'Last ticked at' }),
    },
    measures: {
      started: count({ label: 'Started' }),
      done: count({ label: 'Done', where: "{t}.status = 'completed'", about: 'Checklists with every task ticked.' }),
      done_rate: ratio('done', 'started', { type: 'percent', label: 'Finished', about: 'Checklists done out of those started.' }),
    },
    links: {
      checklist: one('safety.checklist_templates', 'template_id', { label: 'Checklist set up' }),
      ticks: many('safety.checklist_ticks', 'instance_id', { label: 'Tasks' }),
    },
    list: ['date', 'venue.name', 'name', 'status', 'done_by', 'done_at'],
    sort: [{ by: 'date', dir: 'desc' }],
    skip: ['is_generated'],
  }),

  subject({
    key: 'safety.checklist_ticks',
    label: 'Checklist tasks done',
    one: 'task',
    area: 'safety',
    module: 'checklists',
    about: 'Each task on each checklist started, ticked or not, on the first day of its checklist\'s period.',
    from: 'checklist_instance_items',
    name: 'task',
    venue: { sql: '{done}.venue_id' },
    date: { sql: '{done}.period_start', label: 'Period starting' },
    fields: {
      task: text({ sql: '{task_row}.label' }, { label: 'Task' }),
      ticked: yesno('is_checked', { label: 'Ticked' }),
      notes: text('notes'),
    },
    measures: {
      tasks: count({ label: 'Tasks' }),
      ticked_count: count({ label: 'Ticked', where: '{t}.is_checked' }),
      not_ticked: count({ label: 'Not ticked', where: 'NOT {t}.is_checked' }),
      tick_rate: ratio('ticked_count', 'tasks', { type: 'percent', label: 'Ticked', about: 'Tasks ticked out of the tasks on checklists started.' }),
    },
    links: {
      done: one('safety.checklists', 'instance_id', { label: 'Checklist done' }),
      task_row: one('safety.checklist_tasks', 'template_item_id', { label: 'Task set up' }),
    },
    list: ['date', 'done.name', 'task', 'ticked', 'notes'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'safety.action_categories',
    label: 'H&S action categories',
    one: 'category',
    area: 'safety',
    module: 'hs_action_log',
    about: 'The categories H&S actions are filed under (Repairs, Records, Training, Cleaning).',
    from: 'hs_action_categories',
    name: 'name',
    fields: {
      name: text('name'),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { categories: count({ label: 'Categories', where: '{t}.is_active', about: 'Those in use.' }) },
    links: { actions: many('safety.actions', 'category_id', { label: 'Actions' }) },
    list: ['name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'safety.actions',
    label: 'H&S actions',
    one: 'action',
    area: 'safety',
    module: 'hs_action_log',
    about: 'Every repair, record, training or cleaning job on the H&S action log, on the day it was logged, open until ticked off.',
    from: 'hs_action_log',
    name: 'task',
    venue: 'venue_id',
    date: { sql: '{t}.logged_date', label: 'Day logged' },
    fields: {
      task: text('task'),
      details: text('details'),
      assigned_to: text('assigned_to', { label: 'Assigned to' }),
      due: date('due_date', { label: 'Due' }),
      priority: choice('priority', { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }),
      done: yesno('is_completed', { label: 'Done' }),
      overdue: yesno({ sql: '(NOT {t}.is_completed AND {t}.due_date < ' + TODAY + ')' }, { label: 'Overdue' }),
      days_open: number({ sql: DAYS_OPEN }, { label: 'Days open', decimals: 0 }),
      age: choice({ sql: "(CASE WHEN " + DAYS_OPEN + " <= 7 THEN 'week' WHEN " + DAYS_OPEN + " <= 30 THEN 'month' WHEN " + DAYS_OPEN + " <= 90 THEN 'quarter' ELSE 'older' END)" },
        { week: 'A week or less', month: '8 to 30 days', quarter: '31 to 90 days', older: 'Over 90 days' }, { label: 'How long open' }),
      done_at: moment('completed_at', { label: 'Done at' }),
      done_by: text('completed_by', { label: 'Done by' }),
      has_photo: yesno({ sql: '({t}.attachment_media_id IS NOT NULL)' }, { label: 'Has a photo' }),
      notes: text('notes'),
      logged_by: text('created_by', { label: 'Logged by' }),
      logged_at: moment('created_at', { label: 'Logged at' }),
    },
    measures: {
      actions: count({ label: 'Actions' }),
      open: count({ label: 'Open', where: 'NOT {t}.is_completed', about: 'Actions not ticked off yet.' }),
      overdue_count: count({ label: 'Overdue', where: 'NOT {t}.is_completed AND {t}.due_date < ' + TODAY, about: 'Open actions past their due day.' }),
      done_count: count({ label: 'Done', where: '{t}.is_completed' }),
      average_days: avg({ sql: DAYS_OPEN }, { label: 'Average days to finish', decimals: 1, where: '{t}.is_completed', about: 'How many days actions that were ticked off were open, on average.' }),
    },
    links: {
      category: one('safety.action_categories', 'category_id', { label: 'Category' }),
    },
    list: ['date', 'venue.name', 'task', 'category.name', 'priority', 'due', 'done', 'assigned_to'],
    sort: [{ by: 'date', dir: 'desc' }],
    skip: ['updated_at'],
  }),
]
