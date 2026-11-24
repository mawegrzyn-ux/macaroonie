// shared/registry/cash.js: the Cash Recon area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'cash.days', label: 'Cash day', plural: 'Cash days', words: ['cash-up', 'cash up', 'daily report', 'takings', 'variance'],
    table: 'cash_daily_reports',
    subjects: ['cash.days', 'cash.income', 'cash.takings', 'cash.service_charges', 'cash.reports'],
    page: '/cash-recon', open: { page: '/cash-recon', with: ['venue', 'date'] },
    actions: ['record_cash_day', 'submit_cash_day', 'fill_cash_from_till'],
    forms: ['cash_up'],
  },
  {
    key: 'cash.weeks', label: 'Cash week', plural: 'Cash weeks', words: ['weekly cash-up'],
    table: 'cash_daily_reports', subjects: ['cash.weeks'],
    page: '/cash-recon', open: { page: '/cash-recon', with: ['venue', 'week', 'tab'] },
    actions: ['submit_cash_week'],
  },
  {
    key: 'cash.expenses', label: 'Expense', plural: 'Expenses', words: ['petty cash', 'receipt', 'spend'],
    table: 'cash_expenses', subjects: ['cash.expenses', 'cash.expense_categories'],
    page: '/cash-recon', open: { page: '/cash-recon', with: ['venue', 'date'] },
    actions: ['add_expense'],
    forms: ['expense'],
  },
  {
    key: 'cash.wages', label: 'Wage entry', plural: 'Wages', words: ['wages', 'pay run', 'wage'],
    table: 'cash_wage_entries', subjects: ['cash.wages', 'cash.wage_lists'],
    page: '/cash-recon', open: { page: '/cash-recon', with: ['venue', 'week', 'tab'] },
    actions: ['fill_wages_from_rota', 'mark_wages_paid'],
    forms: ['wages'],
  },
  {
    // Sales from other tills (sales import phase 4): another till's receipts,
    // reported beside our till's checks by the "every till" subjects.
    key: 'sales.checks', label: 'Receipt from another till', plural: 'Receipts from other tills',
    words: ['loyverse receipt', 'loyverse sale', 'every till', 'all tills', 'imported sales'],
    table: 'ext_checks', subjects: ['sales.checks', 'sales.dishes', 'sales.tenders'],
    page: '/integrations',
    actions: [],
    forms: [],
  },
]

export const notObjects = {
  'How Cash Recon is set up (its income, payment channel and service charge lists): settings, not things done.':
    ['cash.income_sources', 'cash.payment_channels', 'cash.sc_sources'],
}
