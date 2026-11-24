// shared/registry/rota.js: the Staff & rota area's business objects
// (shared/registry/index.js says what a record holds).

const WEEK = { page: '/rota', with: ['venue', 'week'] }

export const objects = [
  {
    key: 'staff.people', label: 'Staff member', plural: 'Staff', words: ['employee', 'person', 'team member', 'leaver'],
    table: 'cash_staff', subjects: ['staff.people'],
    page: '/staff',
    actions: ['add_staff_member', 'update_staff_member', 'set_staff_leaving'],
  },
  {
    key: 'staff.roles', label: 'Staff role', plural: 'Staff roles', words: ['job role', 'job title'],
    table: 'staff_roles', subjects: ['staff.roles'],
    page: '/staff/roles',
  },
  {
    key: 'staff.time_off', label: 'Time off', plural: 'Time off', words: ['holiday', 'leave', 'days off'],
    table: 'staff_rota_off', subjects: ['staff.time_off'],
    page: '/staff',
    actions: ['add_time_off', 'remove_time_off'],
  },
  {
    key: 'rota.entries', label: 'Rota shift', plural: 'Rota shifts', words: ['rota', 'shift', 'rota entry'],
    table: 'rota_entries', subjects: ['rota.entries', 'rota.days', 'rota.shifts'],
    page: '/rota', open: WEEK,
    actions: ['set_rota', 'copy_rota_week'],
    forms: ['rota_day'],
  },
  {
    key: 'rota.pay_adjustments', label: 'Pay adjustment', plural: 'Pay adjustments', words: ['bonus', 'deduction', 'advance'],
    table: 'rota_pay_adjustments', subjects: ['rota.pay_adjustments'],
    page: '/rota', open: WEEK,
    actions: ['add_pay_adjustment'],
  },
  {
    key: 'rota.pot_weeks', label: 'Tip pot week', plural: 'Tip pot weeks', words: ['tips', 'tip pot', 'tronc', 'gratuities'],
    table: 'tip_pots', subjects: ['rota.pot_weeks', 'rota.tip_pots', 'rota.tip_shares', 'rota.tip_moves'],
    page: '/rota', open: WEEK,
    actions: ['adjust_tips', 'set_tip_pot_amounts'],
  },
]

export const notObjects = {
  'Totals of the rota by week, worked out from its shifts, pay and tips: nothing to change of their own.': ['rota.weeks', 'rota.staff_weeks'],
}
