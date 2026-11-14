// src/reports/starters/safety.js
//
// Starter reports on food safety, checklists and the H&S action log
// (docs/REPORTS.md 20, phase 3). A reading out of range with no corrective
// action written is unresolved, the Overview's H&S tiles' own rule.

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
]
