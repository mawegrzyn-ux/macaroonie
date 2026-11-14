// src/reports/starters/safety.js
//
// Starter reports on food safety, checklists and the H&S action log
// (docs/REPORTS.md 20, phase 3). A reading out of range with no corrective
// action written is unresolved, the Overview's H&S tiles' own rule.
//
// The H&S day starters (phase 3b) read each venue's day as the Overview's
// H&S tiles judge it. Each keeps a figure a role with Food safety logs but no
// Checklists can see, so that role gets the rest left out with notes.

import { starter, m } from './define.js'

const OUT = { field: 'in_range', op: 'is', value: false }

export default [
  starter({
    key: 'safety_fridge_readings_out',
    name: 'Fridge and freezer readings out of range',
    about: 'Every fridge or freezer reading outside its limits, with what was done about it. One with nothing written is still unresolved.',
    period: 'last_month',
    spec: {
      subject: 'safety.fridge_checks',
      kind: 'list',
      rows: ['date', 'check_time', 'venue.name', 'fridge.name', 'temperature', 'unresolved', 'corrective_action', 'recorded_by'],
      filters: [OUT],
      sort: [{ by: 'date', dir: 'desc' }],
    },
  }),

  starter({
    key: 'safety_hold_readings_out',
    name: 'Hot and cold hold readings out of range',
    about: 'Every hot or cold hold reading outside its limits, with what was done about it. One with nothing written is still unresolved.',
    period: 'last_month',
    spec: {
      subject: 'safety.hold_checks',
      kind: 'list',
      rows: ['date', 'check_time', 'venue.name', 'station.name', 'temperature', 'unresolved', 'corrective_action', 'recorded_by'],
      filters: [OUT],
      sort: [{ by: 'date', dir: 'desc' }],
    },
  }),

  starter({
    key: 'safety_cooking_out',
    name: 'Cooking checks out of range',
    about: 'Every cooking or reheating check whose core temperature or time fell short, with what was done about it. One with nothing written is still unresolved.',
    period: 'last_month',
    spec: {
      subject: 'safety.cooking_checks',
      kind: 'list',
      rows: ['date', 'venue.name', 'session.name', 'dish_name', 'core_temp', 'held_for', 'unresolved', 'corrective_action', 'recorded_by'],
      filters: [OUT],
      sort: [{ by: 'date', dir: 'desc' }],
    },
  }),

  starter({
    key: 'safety_deliveries_failed',
    name: 'Delivery checks failed',
    about: 'Every delivery check that failed on packaging, damage, quality or temperature, or was turned away, with what was done about it.',
    period: 'last_month',
    spec: {
      subject: 'safety.delivery_checks',
      kind: 'list',
      rows: ['date', 'venue.name', 'supplier', 'packaging_ok', 'damage_ok', 'quality_ok', 'temp_ok', 'product_temp', 'accepted', 'corrective_action', 'recorded_by'],
      filters: [{ field: 'passed', op: 'is', value: false }],
      sort: [{ by: 'date', dir: 'desc' }],
    },
  }),

  starter({
    key: 'safety_checklists_done',
    name: 'Checklists done',
    about: 'Each checklist: how many times someone started it in the period and how many times every task was ticked. A day, week or month nobody started isn\'t counted here (the Overview\'s H&S tiles show those).',
    period: 'last_month',
    spec: {
      subject: 'safety.checklists',
      rows: ['name'],
      values: m('started', 'done', 'done_rate'),
      sort: [{ by: 'name', dir: 'asc' }],
      drill: { down: ['date', 'venue.name', 'done_by'], rows: ['date', 'venue.name', 'name', 'status', 'done_at', 'done_by'] },
    },
  }),

  starter({
    key: 'safety_open_actions',
    name: 'Open H&S actions by age',
    about: 'Actions on the H&S action log still to do, by how long they have been open, with how many are past their due date.',
    period: false,
    spec: {
      subject: 'safety.actions',
      rows: ['age'],
      values: m('open', 'overdue_count'),
      filters: [{ field: 'done', op: 'is', value: false }],
      drill: { down: ['category.name', 'venue.name', 'priority'], rows: ['logged_at', 'venue.name', 'category.name', 'task', 'priority', 'due', 'assigned_to', 'days_open'] },
      view: { kind: 'bar', x: 'age', y: ['open'] },
    },
  }),

  starter({
    key: 'safety_hs_status_by_day',
    name: 'H&S status by day',
    about: 'Each day at the venues as the Overview\'s H&S tiles judge it: the checklists and fridge, hold and cooking checks due, done and missed, what was left unresolved, and how many venues needed action. What is due is the checks set up now.',
    period: 'last_week',
    spec: {
      subject: 'safety.days',
      rows: ['date'],
      values: m('due_total', 'done_total', 'missed_total', 'done_rate', 'unresolved_total', 'days_action'),
      sort: [{ by: 'date', dir: 'asc' }],
      drill: { down: ['venue.name', 'fs_status'], rows: ['date', 'venue.name', 'status', 'due', 'done', 'missed', 'checklists_missed', 'fs_missed', 'unresolved'] },
      view: { kind: 'bar', x: 'date', y: ['done_total', 'missed_total'], stacked: true },
    },
  }),

  starter({
    key: 'safety_food_safety_by_venue',
    name: 'Food safety checks missed by venue',
    about: 'Each venue\'s fridge, hold and cooking checks due, done and missed in the period, how many days had checks missed and what was left unresolved, counted as the Overview\'s H&S tiles count them.',
    period: 'last_month',
    spec: {
      subject: 'safety.days',
      rows: ['venue.name'],
      values: m('fs_due_total', 'fs_done_total', 'fs_missed_total', 'fs_done_rate', 'days_fs_missed', 'unresolved_total'),
      sort: [{ by: 'fs_missed_total', dir: 'desc' }],
      drill: { down: [{ field: 'date', bucket: 'week' }, 'date'], rows: ['date', 'venue.name', 'fs_status', 'fridge_missed', 'hold_missed', 'cooking_missed', 'unresolved'] },
    },
  }),

  starter({
    key: 'safety_days_needing_action',
    name: 'Food safety days needing action',
    about: 'Every venue day whose food safety needed action: a reading or delivery left unresolved, or none of the fridge, hold and cooking checks due done. What was missed and left unresolved, kind by kind.',
    period: 'last_month',
    spec: {
      subject: 'safety.days',
      kind: 'list',
      rows: ['date', 'venue.name', 'fs_due', 'fridge_missed', 'hold_missed', 'cooking_missed', 'fridge_unresolved', 'hold_unresolved', 'cooking_unresolved', 'deliveries_unresolved'],
      filters: [{ field: 'fs_status', op: 'in', value: ['red'] }],
      sort: [{ by: 'date', dir: 'desc' }],
    },
  }),
]
