// shared/rules.js: rules made from a sentence (Pepper-first step 8B2;
// "a rule built from a sentence using the same actions" in reports/AI first
// back office strategy.md). The one implementation of what a rule is (rule
// 12): the API checks and fires rules with it, Pepper's make_rule and the
// Settings list describe them with it.
//
// A rule = a trigger (something the app already does: a reading logged, a
// supplier order placed, a task late, a review recorded) + conditions on that
// event + one action: a Pepper change tool (the registry's actions) with its
// input written as a template. It runs as a system action, as the person who
// confirmed it, at most `per_day` times a day.
//
// Only actions a group may let run unattended: reversible tools (decision 4's
// "Done, with Undo" list), never money, pay, prices, allergens, deletions or
// anything about a person (the never-list, which no reversible tool is on:
// api/test/pepper-tools-registry.test.mjs), and of those only the ones that
// make sense with nobody there (RULE_ACTIONS): never a reading or a count
// (only a person measures), never a menu or an order.
//
//   TRIGGERS          { key: { label, conditions: { name: { type, label } }, fields } }
//                     fields: what the event says, usable as {name} in the action's text
//   RULE_ACTIONS      { tool: { label, venue, fields: { name: { label, max, choices? } } } }
//                     venue: how the event's venue reaches the tool ('venue_id' | 'venue')
//   NEVER_WORDS       the never-list, in words (refusals)
//   MAX_PER_DAY       the most a rule may fire in a day (DEFAULT_PER_DAY)
//   ruleProblem(rule) what is wrong with a rule's shape, or null (the API also
//                     checks the tool's class and the person's access)
//   matches(rule, event)   do the conditions hold for this event
//   fillInput(rule, event) the action's input for this event (templates filled,
//                     the venue added)
//   ruleLines(rule, { venueName })  the rule in words, for a card and the list

import { TASK_AREAS } from './todayTasks.js'

export const TRIGGERS = {
  fridge_reading: {
    label: 'A fridge or freezer reading is logged',
    conditions: {
      above:        { type: 'number', label: 'Reads above (°C)' },
      below:        { type: 'number', label: 'Reads below (°C)' },
      out_of_range: { type: 'yesno', label: 'Out of its range' },
      equipment:    { type: 'text', label: 'Fridge or freezer name has' },
    },
    fields: ['venue', 'equipment', 'temperature', 'date'],
  },
  supplier_order: {
    label: 'A supplier order is placed',
    conditions: {
      over:     { type: 'number', label: 'Total over (£)' },
      supplier: { type: 'text', label: 'Supplier name has' },
    },
    fields: ['venue', 'supplier', 'number', 'total', 'delivery_date'],
  },
  task_late: {
    label: 'A task on Today is late',
    conditions: {
      area:  { type: 'choice', label: 'Kind of task', choices: TASK_AREAS },
      title: { type: 'text', label: 'Task name has' },
    },
    fields: ['venue', 'task', 'due', 'area'],
  },
  review_low: {
    label: 'A review is recorded',
    conditions: {
      stars_at_most: { type: 'number', label: 'Stars at most' },
      platform:      { type: 'text', label: 'Site' },
    },
    fields: ['venue', 'stars', 'platform', 'reviewer'],
  },
}
export const TRIGGER_KEYS = Object.keys(TRIGGERS)

export const RULE_ACTIONS = {
  add_hs_action: {
    label: 'Add an H&S action',
    venue: 'venue_id',
    fields: {
      task:        { label: 'Task', max: 300, required: true },
      details:     { label: 'Details', max: 1000 },
      priority:    { label: 'Priority', choices: ['low', 'medium', 'high', 'critical'] },
      assigned_to: { label: 'For', max: 200 },
    },
  },
  send_notice: {
    label: 'Send a notice to people\'s phones',
    venue: 'venue',
    fields: {
      to:    { label: 'To', max: 100, required: true },
      title: { label: 'Title', max: 100, required: true },
      text:  { label: 'Text', max: 300 },
    },
  },
}
export const RULE_ACTION_KEYS = Object.keys(RULE_ACTIONS)

export const NEVER_WORDS = 'money, pay, prices, allergens, deletions or anything about a person'
export const MAX_PER_DAY = 20
export const DEFAULT_PER_DAY = 5
const PLACEHOLDER = /\{([a-z_]+)\}/g

/** What is wrong with a rule's shape (trigger, conditions, action, input), or null. */
export function ruleProblem(rule) {
  if (!rule || typeof rule !== 'object') return 'No rule'
  const name = String(rule.name ?? '').trim()
  if (!name || name.length > 80) return 'A rule needs a short name'
  const t = TRIGGERS[rule.trigger]
  if (!t) return 'A rule starts from one of: ' + Object.values(TRIGGERS).map(x => x.label.replace(/^./, c => c.toLowerCase())).join('; ')
  const cond = rule.conditions || {}
  for (const [k, v] of Object.entries(cond)) {
    const c = t.conditions[k]
    if (!c) return '"' + k + '" isn\'t something to check when ' + t.label.replace(/^./, c => c.toLowerCase())
    if (c.type === 'number' && !Number.isFinite(v)) return c.label + ' is a number'
    if (c.type === 'yesno' && typeof v !== 'boolean') return c.label + ' is yes or no'
    if (c.type === 'text' && (typeof v !== 'string' || !v.trim() || v.length > 80)) return c.label + ' is a few words'
    if (c.type === 'choice' && !c.choices[v]) return c.label + ' is one of: ' + Object.values(c.choices).join(', ')
  }
  const a = RULE_ACTIONS[rule.action_tool]
  if (!a) {
    return 'A rule can only ' + Object.values(RULE_ACTIONS).map(x => x.label.replace(/^./, c => c.toLowerCase())).join(' or ') +
      ': never ' + NEVER_WORDS + '.'
  }
  const input = rule.action_input || {}
  for (const [k, v] of Object.entries(input)) {
    const f = a.fields[k]
    if (!f) return a.label + ' has no "' + k + '"'
    if (typeof v !== 'string' || v.length > (f.max || 100)) return a.label + ': ' + f.label + ' is text of up to ' + (f.max || 100) + ' characters'
    if (f.choices && !f.choices.includes(v)) return a.label + ': ' + f.label + ' is one of ' + f.choices.join(', ')
    for (const [, p] of v.matchAll(PLACEHOLDER)) {
      if (!t.fields.includes(p)) return a.label + ': {' + p + '} isn\'t known when ' + t.label.replace(/^./, c => c.toLowerCase()) + ' (use ' + t.fields.map(x => '{' + x + '}').join(', ') + ')'
    }
  }
  for (const [k, f] of Object.entries(a.fields)) {
    if (f.required && !String(input[k] ?? '').trim()) return a.label + ' needs its ' + f.label.replace(/^./, c => c.toLowerCase())
  }
  const perDay = rule.per_day ?? DEFAULT_PER_DAY
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > MAX_PER_DAY) return 'A rule runs 1 to ' + MAX_PER_DAY + ' times a day'
  return null
}

const lower = v => String(v ?? '').toLowerCase()

/** Do the rule's conditions (and its venue, when it has one) hold for this event? */
export function matches(rule, event) {
  if (!rule || !event || rule.trigger !== event.trigger) return false
  if (rule.venue_id && rule.venue_id !== event.venue_id) return false
  const c = rule.conditions || {}
  switch (rule.trigger) {
    case 'fridge_reading':
      if (c.above != null && !(event.temperature > c.above)) return false
      if (c.below != null && !(event.temperature < c.below)) return false
      if (c.out_of_range != null && c.out_of_range !== !event.in_range) return false
      if (c.equipment && !lower(event.equipment).includes(lower(c.equipment))) return false
      return true
    case 'supplier_order':
      if (c.over != null && !(event.total > c.over)) return false
      if (c.supplier && !lower(event.supplier).includes(lower(c.supplier))) return false
      return true
    case 'task_late':
      if (c.area && event.area_key !== c.area) return false
      if (c.title && !lower(event.task).includes(lower(c.title))) return false
      return true
    case 'review_low':
      if (c.stars_at_most != null && !(event.stars != null && event.stars <= c.stars_at_most)) return false
      if (c.platform && !lower(event.platform).includes(lower(c.platform))) return false
      return true
    default:
      return false
  }
}

/** The action's input for this event: {field} filled from the event, the event's venue added. */
export function fillInput(rule, event) {
  const a = RULE_ACTIONS[rule.action_tool]
  const out = {}
  for (const [k, v] of Object.entries(rule.action_input || {})) {
    const f = a.fields[k]
    out[k] = String(v).replace(PLACEHOLDER, (_, p) => (event[p] == null ? '' : String(event[p]))).slice(0, f?.max || 100)
  }
  if (a.venue === 'venue_id') out.venue_id = event.venue_id
  else if (a.venue === 'venue') out.venue = event.venue_id
  return out
}

const num = v => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100))

/** The rule in words: [when, if..., then, at most]. */
export function ruleLines(rule, { venueName = null } = {}) {
  const t = TRIGGERS[rule.trigger]
  const a = RULE_ACTIONS[rule.action_tool]
  const c = rule.conditions || {}
  const ifs = Object.entries(c).map(([k, v]) => {
    const d = t?.conditions[k]
    if (!d) return k
    if (d.type === 'yesno') return d.label.replace(/^./, c => c.toLowerCase()) + ': ' + (v ? 'yes' : 'no')
    if (d.type === 'choice') return d.label.replace(/^./, c => c.toLowerCase()) + ': ' + (d.choices[v] || v)
    return d.label.replace(/^./, c => c.toLowerCase()) + ' ' + (d.type === 'number' ? num(v) : '"' + v + '"')
  })
  const what = Object.entries(rule.action_input || {}).map(([k, v]) => (a?.fields[k]?.label || k) + ': ' + v)
  return [
    'When ' + (t ? t.label.replace(/^./, c => c.toLowerCase()) : rule.trigger) + (venueName ? ' at ' + venueName : rule.venue_id ? '' : ' at any venue'),
    ...ifs.map(x => 'If ' + x),
    'Then: ' + (a ? a.label.replace(/^./, c => c.toLowerCase()) : rule.action_tool) + (what.length ? ' (' + what.join('; ') + ')' : ''),
    'At most ' + (rule.per_day ?? DEFAULT_PER_DAY) + ' times a day',
  ]
}
