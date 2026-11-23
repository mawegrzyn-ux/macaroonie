// shared/todayTasks.js
//
// The task store's rules (Pepper-first step 5, migration 278), the one copy
// for the API (routes/ops.js, services/opsTasks.js, Pepper's task tools) and
// the admin (the task actions on Home and the phone's Today):
//
//   SNOOZE_PRESETS     the snooze choices: minutes from now, or a set time
//   SKIP_REASONS       the short list of reasons a skip offers (or own words)
//   MANUAL_DONE_KINDS  the tasks the feed can't see finish, which can be
//                      marked done by hand; every other task leaves the feed
//                      by evidence (its record exists)
//   ESCALATE_MINUTES   a task late by more than this is also told to the
//                      venue's managers (the notices sweep)
//   TASK_AREAS         the feed's areas in words (the notices settings, the
//                      report on tasks by site, Home)
//
// A skip always needs a reason (docs/PEPPER_FIRST.md 13, decision 7).

export const SNOOZE_PRESETS = [
  { key: '30m', label: '30 minutes', minutes: 30 },
  { key: '1h', label: '1 hour', minutes: 60 },
  { key: '2h', label: '2 hours', minutes: 120 },
  { key: '4h', label: '4 hours', minutes: 240 },
]
/** The longest a task can be snoozed for, in minutes (a day). */
export const SNOOZE_MAX_MINUTES = 24 * 60

export const SKIP_REASONS = [
  'Closed or not trading today',
  'Equipment out of use or being repaired',
  'Done another way (on paper, another system)',
  'Not needed today',
  'Short-staffed',
]
export const REASON_MAX = 300

export const MANUAL_DONE_KINDS = ['report_alert', 'failed_email', 'screen_offline', 'device_offline']

export const ESCALATE_MINUTES = 120

export const TASK_AREAS = {
  food_safety: 'Food safety checks', checklists: 'Checklists', hs_actions: 'H&S actions',
  purchasing: 'Supplier orders', cash: 'Cash-ups', wages: 'Wages', online_orders: 'Online orders',
  report_alerts: 'Report alerts',
}

/** A skip's reason, tidied: null when it is empty or too long. */
export function cleanReason(text) {
  const r = String(text ?? '').replace(/\s+/g, ' ').trim()
  return r && r.length <= REASON_MAX ? r : null
}

/** "until 15:30" for a snooze that ends today at the venue, else "until Tue 15:30". */
export function snoozeText(untilLocal, today) {
  if (!untilLocal) return ''
  return 'until ' + (untilLocal.date === today ? untilLocal.time : untilLocal.weekday.slice(0, 3) + ' ' + untilLocal.time)
}
