// src/reports/catalogue/today.js
//
// The Today tasks above the store (Pepper-first step 5, migration 278):
// completion and skips by site, never by person (docs/PEPPER_FIRST.md 13,
// decisions 7 and 8).
//
//   today.tasks         the feed's record (ops_task_days, kept by the notices
//                       sweep every five minutes as the group's owner): each
//                       task per venue and day, whether it went late, whether
//                       it left the list (finished) and whether it was
//                       skipped, with the skip's reason
//   today.task_changes  every change people made to a task (ops_task_log):
//                       assigned, snoozed, skipped (with the reason), done by
//                       hand, and escalations to managers
//
// Who made a change, who a task was given to and who it was skipped by are
// never read here: completion is shown by site. Both need Manage on Venues,
// the level that runs the sites (a task's own module decides who sees it on
// Home; a report spans every area).

import { subject, text, choice, date, moment, yesno, count, ratio } from './define.js'
import { TASK_AREAS } from '../../../../shared/todayTasks.js'

/** Where these subjects come in the catalogue (index.js gathers this folder by it, then by file name). */
export const order = 175

/**
 * This area's tables that no subject reads, and why (decisions.js gathers
 * them): settings (how something is set up) and out ({ reason: [tables] }).
 */
export const decisions = {
  settings: [],
  out: {
    'Working state that changes from minute to minute': [
      // Each task's owner, snooze, skip and done by hand now: the report reads
      // what happened (ops_task_log) and the feed's record (ops_task_days).
      'ops_task_states',
    ],
  },
}

const MODULE = 'venues'
const LEVEL = 'manage'
const FINISHED = '{t}.finished_at IS NOT NULL'
const ON_TIME = '({t}.finished_at IS NOT NULL AND ({t}.late_at IS NULL OR {t}.finished_at <= {t}.late_at))'
const SKIP_REASON = "(SELECT l.reason FROM ops_task_log l WHERE l.tenant_id = {t}.tenant_id AND l.venue_id = {t}.venue_id AND l.task_key = {t}.task_key AND l.day = {t}.day AND l.action = 'skipped' ORDER BY l.at DESC LIMIT 1)"
const ACTIONS = {
  assigned: 'Assigned', unassigned: 'Assignment cleared', snoozed: 'Snoozed', unsnoozed: 'Snooze ended early',
  skipped: 'Skipped', unskipped: 'Skip undone', done: 'Marked done', undone: 'Done undone', escalated: 'Escalated to managers',
}

export const subjects = [
  subject({
    key: 'today.tasks',
    label: 'Today tasks by site',
    one: 'task',
    area: 'shared',
    module: MODULE,
    level: LEVEL,
    about: 'Each task the Today feed showed at a venue on a day, as its notices sweep saw it every five minutes: whether it went late, whether it was finished (it left the list, or was marked done) and whether it was skipped, with the reason. By site, never by person.',
    from: 'ops_task_days',
    id: { sql: "({t}.venue_id::text || '|' || {t}.day::text || '|' || {t}.task_key)" },
    idType: 'text',
    name: 'title',
    venue: 'venue_id',
    date: { sql: '{t}.day', label: 'Day' },
    fields: {
      title: text('title', { label: 'Task' }),
      area: choice('area', TASK_AREAS, { label: 'Area' }),
      kind: text('kind', { label: 'Kind' }),
      compliance: yesno('compliance', { label: 'Compliance', about: 'A food safety check, checklist or H&S action.' }),
      first_seen: moment('first_seen_at', { label: 'First on the list' }),
      went_late: yesno({ sql: '{t}.late_at IS NOT NULL' }, { label: 'Went late' }),
      late_at: moment('late_at', { label: 'Late from' }),
      finished: yesno({ sql: FINISHED }, { label: 'Finished', about: 'It left the list (its record was made) or was marked done.' }),
      finished_at: moment('finished_at', { label: 'Finished at' }),
      on_time: yesno({ sql: ON_TIME }, { label: 'Finished before it went late' }),
      skipped: yesno('skipped', { label: 'Skipped' }),
      skip_reason: text({ sql: SKIP_REASON }, { label: 'Why it was skipped' }),
    },
    measures: {
      tasks: count({ label: 'Tasks' }),
      finished_count: count({ label: 'Finished', where: FINISHED }),
      completion: ratio('finished_count', 'tasks', { type: 'percent', label: 'Completion', about: 'Tasks finished out of every task shown.' }),
      on_time_count: count({ label: 'Finished in time', where: ON_TIME }),
      on_time_rate: ratio('on_time_count', 'tasks', { type: 'percent', label: 'Finished in time', about: 'Tasks finished before they went late, out of every task shown.' }),
      late_count: count({ label: 'Went late', where: '{t}.late_at IS NOT NULL' }),
      skipped_count: count({ label: 'Skipped', where: '{t}.skipped' }),
    },
    list: ['date', 'venue.name', 'title', 'area', 'went_late', 'finished', 'skipped', 'skip_reason'],
    sort: [{ by: 'date', dir: 'desc' }],
    skip: ['due', 'last_seen_at'],
  }),

  subject({
    key: 'today.task_changes',
    label: 'Today task changes',
    one: 'change',
    area: 'shared',
    module: MODULE,
    level: LEVEL,
    about: 'Every change made to a Today task at a venue: assigned, snoozed, skipped (with the reason), marked done, and the tasks escalated to managers after being late too long. By site, never by person.',
    from: 'ops_task_log',
    name: 'title',
    venue: 'venue_id',
    date: { sql: '{t}.day', label: 'Day' },
    fields: {
      at: moment('at', { label: 'When' }),
      title: text('title', { label: 'Task' }),
      area: choice('area', TASK_AREAS, { label: 'Area' }),
      kind: text('kind', { label: 'Kind' }),
      action: choice('action', ACTIONS, { label: 'Change' }),
      reason: text('reason', { label: 'Reason' }),
      until: moment('until_at', { label: 'Snoozed until' }),
    },
    measures: {
      changes: count({ label: 'Changes' }),
      skips: count({ label: 'Skips', where: "{t}.action = 'skipped'" }),
      snoozes: count({ label: 'Snoozes', where: "{t}.action = 'snoozed'" }),
      escalations: count({ label: 'Escalations', where: "{t}.action = 'escalated'" }),
    },
    list: ['at', 'venue.name', 'title', 'action', 'reason'],
    sort: [{ by: 'at', dir: 'desc' }],
    skip: ['task_key', 'owner_id', 'owner_name', 'by_sub', 'by_name'],
  }),
]
