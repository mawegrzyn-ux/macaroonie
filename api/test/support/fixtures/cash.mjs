// Cash Recon: its lists, a day, an expense, a week's wages (made.staff from
// rota.mjs); and the GloriaFood link (kitchen.mjs shows its orders).
import { MONDAY } from './parts.mjs'

export const order = 50

export const kinds = { expenseId: ['cash_expenses'] }

export async function fill(ctx) {
  const { V, mark, made, step, post, put, patch } = ctx
  const { staff } = made
  const C = `/api/venues/${V}/cash-recon`
  const inc = await step('income source', () => post(C + '/config/income-sources', { name: mark + ' Till', type: 'pos', vat_rate: 20, vat_inclusive: true }))
  const chan = await step('payment channel', () => post(C + '/config/payment-channels', { name: mark + ' Cash', type: 'cash' }))
  const scs = await step('sc source', () => post(C + '/config/sc-sources', { name: mark + ' Card tips', type: 'tips', takings_effect: 'subtract' }))
  await step('expense category', () => post(C + '/config/expense-categories', { name: mark + ' Supplies' }))
  await step('cash settings', () => patch(C + '/settings', { allow_bulk_submit: true }))
  if (inc && chan && scs) {
    await step('cash day', () => put(`${C}/daily/${MONDAY}`, {
      notes: mark + ' busy lunch',
      income: [{ source_id: inc.id, gross_amount: 120, vat_amount: 20, net_amount: 100 }],
      takings: [{ channel_id: chan.id, amount: 115 }],
      sc: [{ source_id: scs.id, amount: 5 }],
    }))
  }
  await step('expense', () => post(C + '/expenses', { date: MONDAY, description: mark + ' Ice', amount: 4 }))
  if (staff) {
    await step('wages', () => put(`${C}/wages/${MONDAY}`, { entries: [{ staff_id: staff.id, name: mark + ' Jo', entry_type: 'fixed', total: 100, cash_amount: 0 }] }))
    await step('wage default', () => post(`${C}/wages/${MONDAY}/set-default`, { entries: [{ staff_id: staff.id, entry_type: 'fixed' }] }))
  }
  // GloriaFood (migration 159) and its orders on the kitchen screens (178,
  // kitchen.mjs).
  await step('gloriafood link', () => put(`/api/gloriafood/venues/${V}/link`, { method: 'push', show_on_board: true }))
}
