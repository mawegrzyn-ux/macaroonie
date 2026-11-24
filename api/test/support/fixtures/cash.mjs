// Cash Recon: its lists, a day, an expense, a week's wages (made.staff from
// rota.mjs); the GloriaFood link (kitchen.mjs shows its orders); and a
// Loyverse connection synced from a stand-in Loyverse (sales import,
// migrations 288 to 290: every ext_* table gets rows).
import { MONDAY } from './parts.mjs'
import { env } from '../../../src/config/env.js'
import { sharedFakeLoyverse, TOKEN } from '../fake-loyverse.mjs'
import { timing } from '../../../src/services/connectors/loyverse.js'
import { syncConnection } from '../../../src/services/salesImportSvc.js'

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

  // Sales from other tills: a connection, a venue linked to its store, and a
  // sync (master data, receipts, the history import) from the stand-in.
  const fake = await sharedFakeLoyverse()
  env.LOYVERSE_API_URL = fake.url
  timing.paceMs = 0; timing.backoffMs = 1
  const conn = await step('loyverse connection', () => post('/api/loyverse/connections', { name: mark + ' Loyverse', access_token: TOKEN }))
  if (conn) {
    await step('loyverse store link', () => put(`/api/loyverse/venues/${V}/link`, { connection_id: conn.id, store_id: 'st1', day_starts_at: '04:00' }))
    await step('sales sync', async () => {
      const r = await syncConnection(ctx.tenantId, conn.id)
      if (r.error || r.skipped) throw new Error(r.error || r.skipped)
    })
    ctx.ids.posConnection = conn.id
  }
}
