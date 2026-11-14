// src/reports/catalogue/staff.js
//
// Staff and rota in the report catalogue (docs/REPORTS.md 20, phase 3b).
// Pay, tips and hours are worked out for every run by the Rota page's own
// rules (services/rotaWeeks.js and services/rotaCalc.js, through
// reports/work/rota.js): each person's week, each venue's week, each tip
// pot's week and each person's share of it, and each person's day on the
// rota. Pay belongs to a week, never a day: the Rota page works it out for
// the whole week (a fixed weekly pay belongs to no one day).
//
// The rows read the Staff page and Rota setup as they are now, as the Rota
// page does: a rate, a role's points multiplier or a shift's hours changed
// since change past weeks too.
//
// Who sees what, as on the Rota page: hours with Rota, pay with Rota pay,
// points and tips with Rota tips, the wage list beside the rota with Cash
// reconciliation, and the Staff page's people, roles and pay details with
// Staff. Rota setup (shifts, tip pots) is the Staff module's page.

import { subject, text, number, money, yesno, choice, date, moment, sum, count, countDistinct, ratio, one, many } from './define.js'
import { WEEK_TABLES, DAY_TABLES } from '../work/rota.js'
import { PAY_METHODS } from '../../../../shared/payMethod.js'

const ROTA = 'rota', PAY = 'rota_pay', TIPS = 'rota_tips', CASH = 'cash_recon', STAFF = 'staff'

const pounds = (src, opts = {}) => money(src, { unit: 'pounds', ...opts })
const total = (src, opts = {}) => sum(src, { type: 'money', unit: 'pounds', ...opts })
const hours = (src, opts = {}) => number(src, { adds: true, decimals: 2, ...opts })
const hoursTotal = (src, opts = {}) => sum(src, { decimals: 2, ...opts })

const PAY_TYPES = { hourly: 'Hourly', fixed: 'Fixed' }
const PAY_BASES = { week: 'A week', day: 'A day', shift: 'A shift' }
const PAY_METHOD_LABELS = Object.fromEntries(PAY_METHODS.map(m => [m.value, m.label]))
const STATUSES = { on: 'Working', sick: 'Sick', pto: 'Paid time off', uto: 'Unpaid time off', abs: 'Absent' }
const DISTRIBUTIONS = { points: 'By points', manual: 'Manual', house: 'Kept by house' }
const PAYOUT_METHODS = { cash: 'Cash', bank: 'Bank transfer' }
const PAYOUT_TO = { shares: 'Each person\'s share', people: 'Specific people' }
const KINDS = { extra: 'Extra pay', deduction: 'Deduction', advance: 'Cash advance', advance_repay: 'Advance repaid' }

// Hours of a rota day from its minutes.
const minutesAsHours = (...cols) => ({ sql: '((' + cols.map(c => '{t}.' + c).join(' + ') + ') / 60.0)' })
const TIME_OFF_MINUTES = ['sick_minutes', 'pto_minutes', 'uto_minutes', 'abs_minutes']

export default [
  // ── Worked out for each run ──────────────────────────────────

  subject({
    key: 'rota.staff_weeks',
    label: 'Rota weeks by person',
    one: 'person\'s week',
    area: 'staff',
    module: ROTA,
    about: 'Each person\'s week (Monday to Sunday) at a venue, worked out as the Rota page works it out: hours on the rota and time off, pay with its adjustments, tip points and tips, and what the week\'s Cash Recon wage list says for them. A person with nothing that week isn\'t a row; someone on the wage list the rota has nothing for is.',
    from: { work: 'rota_staff_weeks', tables: WEEK_TABLES },
    idType: 'text',
    name: 'name',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Week starting' },
    fields: {
      name: text('name', { label: 'Name' }),
      role: text('role_name', { label: 'Role' }),
      entry_count: number('entry_count', { label: 'Entries on the rota', adds: true }),
      days_worked: number('days_worked', { label: 'Days worked', adds: true }),
      paid_days: number('paid_days', { label: 'Days paid', adds: true, about: 'Days worked and days of paid time off.' }),
      hours: hours('hours', { label: 'Hours worked' }),
      paid_hours: hours('paid_hours', { label: 'Hours paid', about: 'Hours worked and hours of paid time off.' }),
      sick_hours: hours('sick_hours', { label: 'Hours off sick' }),
      pto_hours: hours('pto_hours', { label: 'Hours of paid time off' }),
      uto_hours: hours('uto_hours', { label: 'Hours of unpaid time off' }),
      abs_hours: hours('abs_hours', { label: 'Hours absent' }),
      // Pay (Rota pay)
      pay_type: choice('pay_type', PAY_TYPES, { label: 'Paid by the hour or fixed', needs: PAY }),
      pay_basis: choice('pay_basis', PAY_BASES, { label: 'Fixed pay per', needs: PAY, empty: 'Paid by the hour' }),
      computed_pay: pounds('computed_pay', { label: 'Pay from the rota', needs: PAY, about: 'What the hours, shifts or days on the rota come to at the person\'s rates.' }),
      pay_override: pounds('pay_override', { label: 'Pay typed in', adds: false, needs: PAY, about: 'The week\'s pay typed over what the rota works out, if any.' }),
      base_pay: pounds('base_pay', { label: 'Base pay', needs: PAY, about: 'The pay typed in, else what the rota works out.' }),
      extra_pay: pounds('extra_pay', { label: 'Extra pay', needs: PAY }),
      deductions: pounds('deductions', { label: 'Deductions', needs: PAY }),
      advance: pounds('advance', { label: 'Cash advances', needs: PAY }),
      advance_repay: pounds('advance_repay', { label: 'Advances repaid', needs: PAY }),
      carried_owed: pounds('carried_owed', { label: 'Owed from the week before', needs: PAY, about: 'What the week before\'s wage list left unpaid after part of it was paid.' }),
      pay: pounds('pay', { label: 'Pay', needs: PAY, about: 'Base pay with extra pay, deductions, advances, repayments and what the week before left unpaid. Never below nothing.' }),
      pay_shortfall: pounds('pay_shortfall', { label: 'Deductions over pay', needs: PAY, about: 'What deductions and repayments came to beyond the pay.' }),
      pay_method: choice('pay_method', PAY_METHOD_LABELS, { label: 'Paid by', needs: PAY }),
      bank_pay: pounds('bank_pay', { label: 'Pay by bank', needs: PAY }),
      cash_pay: pounds('cash_pay', { label: 'Pay in cash', needs: PAY }),
      // Tips (Rota tips)
      base_points: number('base_points', { label: 'Points earned', adds: true, decimals: 2, needs: TIPS, about: 'Shift points for the shifts worked, times the role\'s multiplier.' }),
      points_adjustment: number('points_adjustment', { label: 'Points moved', adds: true, decimals: 2, needs: TIPS }),
      points_nudge: number('points_nudge', { label: 'Points tapped', adds: true, decimals: 2, needs: TIPS, about: 'Half points tapped on or off on the Rota page.' }),
      points: number('points', { label: 'Points', adds: true, decimals: 2, needs: TIPS }),
      tip_share_from_pots: pounds('tip_share_from_pots', { label: 'Tips from the pots', needs: TIPS }),
      tip_adjustment: pounds('tip_adjustment', { label: 'Tips moved or adjusted', needs: TIPS }),
      tip_unallocated: pounds('tip_unallocated', { label: 'Tips tapped', needs: TIPS, about: 'Tips tapped on from or off to the week\'s unallocated tips.' }),
      tip_share: pounds('tip_share', { label: 'Tips', needs: TIPS, about: 'Tips from the pots, moved or adjusted and tapped. Never below nothing.' }),
      tip_cash: pounds('tip_cash', { label: 'Tips in cash', needs: TIPS, about: 'Tips to hand over in cash, a person paying a pot on to others included (a minus is handed on).' }),
      tip_bank: pounds('tip_bank', { label: 'Tips by bank', needs: TIPS }),
      // The week's Cash Recon wage list (Cash reconciliation)
      on_wage_list: yesno('on_wage_list', { label: 'On the wage list', needs: CASH }),
      wage: pounds('wage', { label: 'Wage (wage list)', needs: CASH, about: 'The person\'s wage on the week\'s Cash Recon wage list.' }),
      wage_bank: pounds('wage_bank', { label: 'Paid by bank (wage list)', needs: CASH }),
      wage_cash: pounds('wage_cash', { label: 'Paid in cash (wage list)', needs: CASH }),
      wage_unpaid: pounds('wage_unpaid', { label: 'Still to pay (wage list)', needs: CASH, about: 'What the wage list has still to pay: what isn\'t paid by bank is due in cash.' }),
    },
    measures: {
      weeks: count({ label: 'Person weeks', about: 'Each person\'s week counts once.' }),
      people: countDistinct('staff_id', { label: 'People' }),
      entries_total: sum('entry_count', { label: 'Entries on the rota' }),
      days_worked_total: sum('days_worked', { label: 'Days worked' }),
      paid_days_total: sum('paid_days', { label: 'Days paid' }),
      hours_total: hoursTotal('hours', { label: 'Hours worked' }),
      paid_hours_total: hoursTotal('paid_hours', { label: 'Hours paid' }),
      sick_hours_total: hoursTotal('sick_hours', { label: 'Hours off sick' }),
      pto_hours_total: hoursTotal('pto_hours', { label: 'Hours of paid time off' }),
      uto_hours_total: hoursTotal('uto_hours', { label: 'Hours of unpaid time off' }),
      abs_hours_total: hoursTotal('abs_hours', { label: 'Hours absent' }),
      time_off_hours: hoursTotal({ sql: '({t}.sick_hours + {t}.pto_hours + {t}.uto_hours + {t}.abs_hours)' }, { label: 'Hours of time off', about: 'Sick, paid and unpaid time off and absence.' }),
      pay_total: total('pay', { label: 'Pay', needs: PAY }),
      base_pay_total: total('base_pay', { label: 'Base pay', needs: PAY }),
      computed_pay_total: total('computed_pay', { label: 'Pay from the rota', needs: PAY }),
      extra_pay_total: total('extra_pay', { label: 'Extra pay', needs: PAY }),
      deductions_total: total('deductions', { label: 'Deductions', needs: PAY }),
      advance_total: total('advance', { label: 'Cash advances', needs: PAY }),
      advance_repay_total: total('advance_repay', { label: 'Advances repaid', needs: PAY }),
      carried_owed_total: total('carried_owed', { label: 'Owed from the week before', needs: PAY }),
      bank_pay_total: total('bank_pay', { label: 'Pay by bank', needs: PAY }),
      cash_pay_total: total('cash_pay', { label: 'Pay in cash', needs: PAY }),
      pay_per_hour: ratio('pay_total', 'paid_hours_total', { type: 'money', label: 'Pay per hour paid', needs: PAY, about: 'Pay divided by the hours paid.' }),
      points_total: sum('points', { label: 'Points', decimals: 2, needs: TIPS }),
      tip_share_total: total('tip_share', { label: 'Tips', needs: TIPS }),
      tips_from_pots_total: total('tip_share_from_pots', { label: 'Tips from the pots', needs: TIPS }),
      tip_cash_total: total('tip_cash', { label: 'Tips in cash', needs: TIPS }),
      tip_bank_total: total('tip_bank', { label: 'Tips by bank', needs: TIPS }),
      on_wage_list_count: count({ label: 'On the wage list', where: '{t}.on_wage_list', needs: CASH }),
      wage_total: total('wage', { label: 'Wages (wage list)', needs: CASH }),
      wage_bank_total: total('wage_bank', { label: 'Paid by bank (wage list)', needs: CASH }),
      wage_cash_total: total('wage_cash', { label: 'Paid in cash (wage list)', needs: CASH }),
      wage_unpaid_total: total('wage_unpaid', { label: 'Still to pay (wage list)', needs: CASH }),
    },
    links: {
      person: one('staff.people', 'staff_id', { label: 'Person' }),
    },
    list: ['date', 'venue.name', 'name', 'hours', 'paid_hours', 'pay', 'tip_share'],
    sort: [{ by: 'date', dir: 'desc' }, { by: 'name', dir: 'asc' }],
  }),

  subject({
    key: 'rota.weeks',
    label: 'Rota weeks',
    one: 'rota week',
    area: 'staff',
    module: ROTA,
    about: 'Each venue\'s week (Monday to Sunday) on the rota, with the Rota page\'s totals: hours, pay, and what went into the tip pots and how it was shared. A week with nothing on the rota and no tips isn\'t a row.',
    from: { work: 'rota_weeks', tables: WEEK_TABLES },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Week starting' },
    fields: {
      people: number('people', { label: 'People on the rota', adds: true }),
      entry_count: number('entry_count', { label: 'Entries on the rota', adds: true }),
      hours: hours('hours', { label: 'Hours worked' }),
      paid_hours: hours('paid_hours', { label: 'Hours paid' }),
      sick_hours: hours('sick_hours', { label: 'Hours off sick' }),
      pto_hours: hours('pto_hours', { label: 'Hours of paid time off' }),
      uto_hours: hours('uto_hours', { label: 'Hours of unpaid time off' }),
      abs_hours: hours('abs_hours', { label: 'Hours absent' }),
      pay: pounds('pay', { label: 'Pay', needs: PAY }),
      pay_bank: pounds('pay_bank', { label: 'Pay by bank', needs: PAY }),
      pay_cash: pounds('pay_cash', { label: 'Pay in cash', needs: PAY }),
      pay_shortfall: pounds('pay_shortfall', { label: 'Deductions over pay', needs: PAY }),
      points: number('points', { label: 'Points', adds: true, decimals: 2, needs: TIPS }),
      tips_gross: pounds('tips_gross', { label: 'Into the pots', needs: TIPS, about: 'What went into the tip pots before anything was taken off.' }),
      surcharges: pounds('surcharges', { label: 'Taken off the pots', needs: TIPS, about: 'What the pots\' surcharges took off (card fees, say).' }),
      tips_in: pounds('tips_in', { label: 'Tips to share', needs: TIPS }),
      tips_shared: pounds('tips_shared', { label: 'Tips shared', needs: TIPS, about: 'Every person\'s tips added up.' }),
      kept_by_house: pounds('kept_by_house', { label: 'Kept by the house', needs: TIPS }),
      tips_added: pounds('tips_added', { label: 'Tips added', needs: TIPS }),
      tips_taken_out: pounds('tips_taken_out', { label: 'Tips taken out', needs: TIPS }),
      tips_carried_in: pounds('tips_carried_in', { label: 'Carried in from earlier weeks', adds: false, needs: TIPS, about: 'Unallocated tips earlier weeks left. Each week carries the one before, so they don\'t add up across weeks.' }),
      tips_unallocated: pounds('tips_unallocated', { label: 'Unallocated tips', adds: false, needs: TIPS }),
      points_unallocated: number('points_unallocated', { label: 'Spare points', decimals: 2, needs: TIPS }),
      tips_unallocated_points: pounds('tips_unallocated_points', { label: 'What the spare points were worth', adds: false, needs: TIPS }),
      tips_carry_out: pounds('tips_carry_out', { label: 'Carried to the next week', adds: false, needs: TIPS }),
      tips_cash: pounds('tips_cash', { label: 'Tips in cash', needs: TIPS }),
      tips_bank: pounds('tips_bank', { label: 'Tips by bank', needs: TIPS }),
      tips_handed_on: pounds('tips_handed_on', { label: 'Handed on by people', needs: TIPS, about: 'What people paid a whole pot pass on to the others.' }),
      tip_settled_in: choice('tip_settled_in', { cash: 'Cash', bank: 'Bank transfer' }, { label: 'Differences settled in', needs: TIPS }),
    },
    measures: {
      weeks: count({ label: 'Weeks' }),
      people_total: sum('people', { label: 'People on the rota', about: 'Added up week by week: someone on two weeks counts twice.' }),
      hours_total: hoursTotal('hours', { label: 'Hours worked' }),
      paid_hours_total: hoursTotal('paid_hours', { label: 'Hours paid' }),
      time_off_hours: hoursTotal({ sql: '({t}.sick_hours + {t}.pto_hours + {t}.uto_hours + {t}.abs_hours)' }, { label: 'Hours of time off' }),
      pay_total: total('pay', { label: 'Pay', needs: PAY }),
      pay_bank_total: total('pay_bank', { label: 'Pay by bank', needs: PAY }),
      pay_cash_total: total('pay_cash', { label: 'Pay in cash', needs: PAY }),
      tips_gross_total: total('tips_gross', { label: 'Into the pots', needs: TIPS }),
      surcharges_total: total('surcharges', { label: 'Taken off the pots', needs: TIPS }),
      tips_in_total: total('tips_in', { label: 'Tips to share', needs: TIPS }),
      tips_shared_total: total('tips_shared', { label: 'Tips shared', needs: TIPS }),
      kept_by_house_total: total('kept_by_house', { label: 'Kept by the house', needs: TIPS }),
      tips_cash_total: total('tips_cash', { label: 'Tips in cash', needs: TIPS }),
      tips_bank_total: total('tips_bank', { label: 'Tips by bank', needs: TIPS }),
    },
    list: ['date', 'venue.name', 'people', 'hours', 'pay', 'tips_in', 'tips_shared'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'rota.days',
    label: 'Rota days by person',
    one: 'person\'s day',
    area: 'staff',
    module: ROTA,
    about: 'Each person\'s day on the rota at a venue: the hours their entries add up to, worked and off, counted as the Rota page counts a week. Pay isn\'t split into days: it belongs to the week.',
    from: { work: 'rota_days', tables: DAY_TABLES },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Day' },
    fields: {
      week_start: date('week_start', { label: 'Week starting' }),
      entry_count: number('entry_count', { label: 'Entries on the rota', adds: true }),
      kind: choice('kind', STATUSES, { label: 'Working or off', about: 'Working when any of the day was worked, else the time off with the most hours.' }),
      worked: yesno('worked', { label: 'Worked' }),
      paid: yesno('paid', { label: 'Paid', about: 'Worked, or paid time off.' }),
      hours: hours(minutesAsHours('on_minutes'), { label: 'Hours worked' }),
      paid_hours: hours(minutesAsHours('on_minutes', 'pto_minutes'), { label: 'Hours paid' }),
      sick_hours: hours(minutesAsHours('sick_minutes'), { label: 'Hours off sick' }),
      pto_hours: hours(minutesAsHours('pto_minutes'), { label: 'Hours of paid time off' }),
      uto_hours: hours(minutesAsHours('uto_minutes'), { label: 'Hours of unpaid time off' }),
      abs_hours: hours(minutesAsHours('abs_minutes'), { label: 'Hours absent' }),
      time_off_hours: hours(minutesAsHours(...TIME_OFF_MINUTES), { label: 'Hours of time off', about: 'Sick, paid and unpaid time off and absence.' }),
    },
    measures: {
      days: count({ label: 'Days on the rota', about: 'Each person\'s day counts once.' }),
      days_worked: count({ label: 'Days worked', where: '{t}.worked' }),
      days_paid: count({ label: 'Days paid', where: '{t}.paid' }),
      sick_days: count({ label: 'Days off sick', where: '{t}.sick_minutes > 0', about: 'Days with any time off sick.' }),
      pto_days: count({ label: 'Days of paid time off', where: '{t}.pto_minutes > 0' }),
      uto_days: count({ label: 'Days of unpaid time off', where: '{t}.uto_minutes > 0' }),
      abs_days: count({ label: 'Days absent', where: '{t}.abs_minutes > 0' }),
      people: countDistinct('staff_id', { label: 'People' }),
      hours_total: hoursTotal(minutesAsHours('on_minutes'), { label: 'Hours worked' }),
      paid_hours_total: hoursTotal(minutesAsHours('on_minutes', 'pto_minutes'), { label: 'Hours paid' }),
      sick_hours_total: hoursTotal(minutesAsHours('sick_minutes'), { label: 'Hours off sick' }),
      pto_hours_total: hoursTotal(minutesAsHours('pto_minutes'), { label: 'Hours of paid time off' }),
      uto_hours_total: hoursTotal(minutesAsHours('uto_minutes'), { label: 'Hours of unpaid time off' }),
      abs_hours_total: hoursTotal(minutesAsHours('abs_minutes'), { label: 'Hours absent' }),
      time_off_hours_total: hoursTotal(minutesAsHours(...TIME_OFF_MINUTES), { label: 'Hours of time off' }),
    },
    links: {
      person: one('staff.people', 'staff_id', { label: 'Person' }),
    },
    list: ['date', 'venue.name', 'person.name', 'kind', 'hours', 'time_off_hours'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'rota.pot_weeks',
    label: 'Tip pot weeks',
    one: 'tip pot\'s week',
    area: 'staff',
    module: TIPS,
    about: 'Each tip pot\'s week at a venue, as the Rota page\'s tips table has it: what went in from service charges and other amounts, what its surcharges took off, and how it was shared. A pot with nothing in it that week isn\'t a row.',
    from: { work: 'rota_pot_weeks', tables: WEEK_TABLES },
    idType: 'text',
    name: 'name',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Week starting' },
    fields: {
      name: text('name', { label: 'Pot' }),
      distribution: choice('distribution', DISTRIBUTIONS, { label: 'Shared' }),
      sources: pounds('sources', { label: 'From service charges', about: 'The week\'s Cash Recon service charges and tips from the sources that feed the pot.' }),
      lines: pounds('lines', { label: 'Other amounts', about: 'Amounts and percentages typed into the pot for the week.' }),
      gross: pounds('gross', { label: 'Into the pot' }),
      surcharge: pounds('surcharge', { label: 'Taken off' }),
      total: pounds('total', { label: 'To share' }),
      distributed: pounds('distributed', { label: 'Shared' }),
      unallocated: pounds('unallocated', { label: 'Left for spare points' }),
      kept_by_house: pounds('kept_by_house', { label: 'Kept by the house' }),
      difference: pounds('difference', { label: 'Shared beyond what was in it', about: 'What was shared out less what there was to share (rounding, or amounts typed by hand).' }),
      payout_method: choice('payout_method', PAYOUT_METHODS, { label: 'Paid in' }),
      payout_to: choice('payout_to', PAYOUT_TO, { label: 'Paid to' }),
      paid_to_people: pounds('paid_to_people', { label: 'Paid to specific people' }),
    },
    measures: {
      pot_weeks: count({ label: 'Pot weeks' }),
      gross_total: total('gross', { label: 'Into the pots' }),
      sources_total: total('sources', { label: 'From service charges' }),
      lines_total: total('lines', { label: 'Other amounts' }),
      surcharge_total: total('surcharge', { label: 'Taken off' }),
      to_share_total: total('total', { label: 'To share' }),
      distributed_total: total('distributed', { label: 'Shared' }),
      unallocated_total: total('unallocated', { label: 'Left for spare points' }),
      kept_by_house_total: total('kept_by_house', { label: 'Kept by the house' }),
    },
    links: {
      pot: one('rota.tip_pots', 'pot_id', { label: 'Tip pot' }),
    },
    list: ['date', 'venue.name', 'name', 'gross', 'surcharge', 'total', 'distributed'],
    sort: [{ by: 'date', dir: 'desc' }, { by: 'name', dir: 'asc' }],
  }),

  subject({
    key: 'rota.tip_shares',
    label: 'Tip shares',
    one: 'tip share',
    area: 'staff',
    module: TIPS,
    about: 'Each person\'s share of each tip pot in a week, before tips moved, adjusted or tapped (those are on Rota weeks by person).',
    from: { work: 'rota_tip_shares', tables: WEEK_TABLES },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.date', label: 'Week starting' },
    fields: {
      share: pounds('share', { label: 'Share' }),
    },
    measures: {
      shares: count({ label: 'Shares' }),
      share_total: total('share', { label: 'Tips from the pots' }),
      people: countDistinct('staff_id', { label: 'People' }),
    },
    links: {
      person: one('staff.people', 'staff_id', { label: 'Person' }),
      pot: one('rota.tip_pots', 'pot_id', { label: 'Tip pot' }),
    },
    list: ['date', 'venue.name', 'person.name', 'pot.name', 'share'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  // ── What was typed ────────────────────────────────────────────

  subject({
    key: 'rota.entries',
    label: 'Rota entries',
    one: 'rota entry',
    area: 'staff',
    module: ROTA,
    about: 'Each entry on the rota: a shift or a period of time on a day, worked or off. Its hours are on Rota days by person.',
    from: 'rota_entries',
    venue: 'venue_id',
    date: { sql: '{t}.work_date', label: 'Day' },
    fields: {
      status: choice('status', STATUSES, { label: 'Working or off' }),
      // An entry is a shift (its times are the shift's) or a period typed in.
      starts: text({ sql: "to_char(COALESCE({t}.start_time, {shift}.start_time), 'HH24:MI')" }, { label: 'Starts' }),
      ends: text({ sql: "to_char(COALESCE({t}.end_time, {shift}.end_time), 'HH24:MI')" }, { label: 'Ends' }),
      added_at: moment('created_at', { label: 'Added at' }),
    },
    measures: {
      entries: count({ label: 'Entries' }),
      shifts_worked: count({ label: 'Entries worked', where: "{t}.status = 'on'" }),
      people: countDistinct('staff_id', { label: 'People' }),
    },
    links: {
      person: one('staff.people', 'staff_id', { label: 'Person' }),
      shift: one('rota.shifts', 'shift_id', { label: 'Shift' }),
    },
    list: ['date', 'venue.name', 'person.name', 'shift.name', 'starts', 'ends', 'status'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'rota.pay_adjustments',
    label: 'Pay adjustments',
    one: 'pay adjustment',
    area: 'staff',
    module: PAY,
    about: 'Each extra pay, deduction, cash advance and advance repaid added on the Rota page, on the week it belongs to.',
    from: 'rota_pay_adjustments',
    venue: 'venue_id',
    date: { sql: '{t}.week_start', label: 'Week starting' },
    fields: {
      kind: choice('kind', KINDS, { label: 'Kind' }),
      amount: pounds('amount', { label: 'Amount', adds: false, about: 'Extra pay and advances add to pay, deductions and repayments take off it: amounts of different kinds don\'t add up.' }),
      note: text('note', { label: 'Note' }),
      added_by: text('created_by', { label: 'Added by' }),
      added_at: moment('created_at', { label: 'Added at' }),
      changed_at: moment('updated_at', { label: 'Changed at' }),
    },
    measures: {
      adjustments: count({ label: 'Adjustments' }),
      extra_total: total('amount', { label: 'Extra pay', where: "{t}.kind = 'extra'" }),
      deductions_total: total('amount', { label: 'Deductions', where: "{t}.kind = 'deduction'" }),
      advances_total: total('amount', { label: 'Cash advances', where: "{t}.kind = 'advance'" }),
      repaid_total: total('amount', { label: 'Advances repaid', where: "{t}.kind = 'advance_repay'" }),
      net_total: total({ sql: "(CASE WHEN {t}.kind IN ('extra', 'advance') THEN {t}.amount ELSE -{t}.amount END)" }, { label: 'Added to pay', about: 'Extra pay and advances less deductions and repayments.' }),
    },
    links: {
      person: one('staff.people', 'staff_id', { label: 'Person' }),
    },
    list: ['date', 'venue.name', 'person.name', 'kind', 'amount', 'note'],
    sort: [{ by: 'date', dir: 'desc' }],
    // The advance a repayment repays: the two are always a pair on the Rota page.
    skip: ['source_id'],
  }),

  subject({
    key: 'rota.tip_moves',
    label: 'Tip moves',
    one: 'tip move',
    area: 'staff',
    module: TIPS,
    about: 'Each person given points or tips moved from someone else, added or taken out on the Rota page, on the week it belongs to: one row for each person a move gave to.',
    from: {
      sql: `(SELECT (l.move_id::text || ':' || l.to_staff_id::text) AS id, l.tenant_id, m.venue_id, m.week_start,
                    m.kind, m.action, m.from_staff_id, l.to_staff_id, l.amount,
                    m.note, m.created_by, m.created_at
               FROM rota_tip_move_lines l
               JOIN rota_tip_moves m ON m.id = l.move_id AND m.tenant_id = l.tenant_id)`,
      tables: ['rota_tip_move_lines', 'rota_tip_moves'],
    },
    idType: 'text',
    venue: 'venue_id',
    date: { sql: '{t}.week_start', label: 'Week starting' },
    fields: {
      kind: choice('kind', { points: 'Points', money: 'Tips' }, { label: 'Points or tips' }),
      action: choice('action', { move: 'Moved', add: 'Added', remove: 'Taken out' }, { label: 'What was done' }),
      points: number({ sql: "(CASE WHEN {t}.kind = 'points' THEN {t}.amount END)" }, { label: 'Points', adds: true, decimals: 2 }),
      tips: pounds({ sql: "(CASE WHEN {t}.kind = 'money' THEN {t}.amount END)" }, { label: 'Tips' }),
      note: text('note', { label: 'Reason' }),
      added_by: text('created_by', { label: 'Added by' }),
      added_at: moment('created_at', { label: 'Added at' }),
    },
    measures: {
      moves: count({ label: 'Moves' }),
      points_total: sum({ sql: "(CASE WHEN {t}.kind = 'points' THEN {t}.amount END)" }, { label: 'Points', decimals: 2 }),
      tips_total: total({ sql: "(CASE WHEN {t}.kind = 'money' THEN {t}.amount END)" }, { label: 'Tips' }),
    },
    links: {
      person: one('staff.people', 'to_staff_id', { label: 'Person' }),
      moved_from: one('staff.people', 'from_staff_id', { label: 'Moved from' }),
    },
    list: ['date', 'venue.name', 'person.name', 'action', 'moved_from.name', 'points', 'tips', 'note'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  // ── What reports group by ─────────────────────────────────────

  subject({
    key: 'staff.people',
    label: 'Staff',
    one: 'member of staff',
    area: 'staff',
    module: STAFF,
    about: 'Each member of staff on the Staff page: their venue, role, how they are paid, and their last working day if they have left.',
    from: 'cash_staff',
    name: 'name',
    venue: 'venue_id',
    fields: {
      name: text('name', { label: 'Name' }),
      pay_type: choice('pay_type', PAY_TYPES, { label: 'Paid by the hour or fixed', needs: STAFF }),
      pay_basis: choice({ sql: "(CASE WHEN {t}.pay_type = 'hourly' THEN NULL ELSE {t}.pay_basis END)" }, PAY_BASES, { label: 'Fixed pay per', needs: STAFF, empty: 'Paid by the hour' }),
      rate: pounds('default_rate', { label: 'Rate', adds: false, needs: STAFF, about: 'An hour\'s pay, or the fixed pay for a week, day or shift (some shifts can have their own).' }),
      pay_method: choice('pay_method', PAY_METHOD_LABELS, { label: 'Paid by', needs: STAFF }),
      bank_amount: pounds('bank_amount', { label: 'Paid by bank each week', adds: false, needs: STAFF, about: 'For people paid part by bank: the part paid by bank.' }),
      active: yesno('is_active', { label: 'Active' }),
      left_on: date('left_on', { label: 'Last working day' }),
      left_note: text('left_note', { label: 'About their leaving', needs: STAFF }),
      added_at: moment('created_at', { label: 'Added at' }),
    },
    measures: {
      people: count({ label: 'Staff' }),
      active_people: count({ label: 'Active staff', where: '{t}.is_active' }),
      leavers: count({ label: 'Leavers', where: '{t}.left_on IS NOT NULL' }),
    },
    links: {
      role: one('staff.roles', 'role_id', { label: 'Role' }),
      time_off: many('staff.time_off', 'staff_id', { label: 'Time off the rota' }),
      entries: many('rota.entries', 'staff_id', { label: 'Rota entries' }),
      adjustments: many('rota.pay_adjustments', 'staff_id', { label: 'Pay adjustments' }),
    },
    list: ['name', 'venue.name', 'role.name', 'active', 'left_on'],
    sort: [{ by: 'name', dir: 'asc' }],
    // The till role (Store tech's till roles come with the till's setup) and the PIN.
    skip: ['sort_order', 'pos_pin_hash', 'pos_role_id'],
  }),

  subject({
    key: 'staff.roles',
    label: 'Staff roles',
    one: 'staff role',
    area: 'staff',
    module: STAFF,
    about: 'The roles on the Staff roles page, shared by every venue, with the multiplier each gives a person\'s tip points.',
    from: 'staff_roles',
    name: 'name',
    fields: {
      name: text('name', { label: 'Name' }),
      points_multiplier: number('points_multiplier', { label: 'Points multiplier', decimals: 2 }),
      active: yesno('is_active', { label: 'Switched on' }),
    },
    measures: {
      roles: count({ label: 'Roles' }),
    },
    links: {
      people: many('staff.people', 'role_id', { label: 'Staff' }),
    },
    list: ['name', 'points_multiplier', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'created_at'],
  }),

  subject({
    key: 'staff.time_off',
    label: 'Time off the rota',
    one: 'time off the rota',
    area: 'staff',
    module: STAFF,
    about: 'Each period someone is off the rota (the Staff page\'s Off the rota): from its first day to its last.',
    from: 'staff_rota_off',
    venue: { sql: '{person}.venue_id' },
    date: { sql: '{t}.from_date', label: 'From' },
    fields: {
      to_date: date('to_date', { label: 'Until' }),
      days: number({ sql: '({t}.to_date - {t}.from_date + 1)' }, { label: 'Days', adds: true }),
      note: text('note', { label: 'Note' }),
      added_by: text('created_by', { label: 'Added by' }),
      added_at: moment('created_at', { label: 'Added at' }),
    },
    measures: {
      periods: count({ label: 'Periods' }),
      days_total: sum({ sql: '({t}.to_date - {t}.from_date + 1)' }, { label: 'Days' }),
    },
    links: {
      person: one('staff.people', 'staff_id', { label: 'Person' }),
    },
    list: ['date', 'to_date', 'person.name', 'venue.name', 'days', 'note'],
    sort: [{ by: 'date', dir: 'desc' }],
  }),

  subject({
    key: 'rota.shifts',
    label: 'Shifts',
    one: 'shift',
    area: 'staff',
    module: ROTA,
    about: 'The shifts in Rota setup, shared by every venue: their times and the tip points they give.',
    from: 'rota_shifts',
    name: 'name',
    fields: {
      name: text('name', { label: 'Name' }),
      starts: text({ sql: "to_char({t}.start_time, 'HH24:MI')" }, { label: 'Starts' }),
      ends: text({ sql: "to_char({t}.end_time, 'HH24:MI')" }, { label: 'Ends' }),
      points: number('points', { label: 'Tip points', decimals: 2 }),
      active: yesno('is_active', { label: 'Switched on' }),
    },
    measures: {
      shifts: count({ label: 'Shifts' }),
    },
    links: {
      entries: many('rota.entries', 'shift_id', { label: 'Rota entries' }),
    },
    list: ['name', 'starts', 'ends', 'points', 'active'],
    sort: [{ by: 'starts', dir: 'asc' }],
    skip: ['sort_order', 'created_at'],
  }),

  subject({
    key: 'rota.tip_pots',
    label: 'Tip pots',
    one: 'tip pot',
    area: 'staff',
    module: STAFF,
    about: 'The tip pots in Rota setup, shared by every venue: how each is shared and how it is paid.',
    from: 'tip_pots',
    name: 'name',
    fields: {
      name: text('name', { label: 'Name' }),
      distribution: choice('distribution', DISTRIBUTIONS, { label: 'Shared' }),
      payout_method: choice('payout_method', PAYOUT_METHODS, { label: 'Paid in' }),
      payout_to: choice('payout_to', PAYOUT_TO, { label: 'Paid to' }),
      active: yesno('is_active', { label: 'Switched on' }),
    },
    measures: {
      pots: count({ label: 'Tip pots' }),
    },
    links: {
      sc_sources: many('cash.sc_sources', 'tip_pot_id', { label: 'Service charge sources' }),
    },
    list: ['name', 'distribution', 'payout_method', 'payout_to', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['surcharges', 'sort_order', 'created_at', 'updated_at'],
  }),
]
