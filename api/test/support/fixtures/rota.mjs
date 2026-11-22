// Staff, the rota, pay and tips. Hands on made.staff (cash.mjs pays them).
import { MONDAY } from './parts.mjs'

export const order = 40

export const kinds = { staffId: ['cash_staff'], potId: ['tip_pots'], periodId: ['staff_rota_off'] }

export async function fill(ctx) {
  const { V, mark, ids, made, step, post, put, patch } = ctx
  await step('rota settings', () => patch('/api/rota/settings', { mode: 'day_parts' }))
  const shift = await step('shift', () => post('/api/rota/shifts', { name: mark + ' Lunch', start_time: '11:00', end_time: '15:00', points: 1 }))
  const role = await step('role', () => post('/api/rota/roles', { name: mark + ' Chef', points_multiplier: 1.5 }))
  const staff = await step('staff', () => post(`/api/rota/venues/${V}/staff`, { name: mark + ' Jo Bloggs', role_id: role?.id, pay_type: 'hourly', default_rate: 11.5 }))
  ids.staff = staff?.id
  made.staff = staff
  if (staff && shift) {
    await step('rota entries', () => put(`/api/rota/venues/${V}/weeks/${MONDAY}/entries`, { entries: [{ staff_id: staff.id, work_date: MONDAY, shift_id: shift.id }] }))
    await step('pay adjustment', () => post(`/api/rota/venues/${V}/weeks/${MONDAY}/pay-adjustments`, { staff_id: staff.id, kind: 'extra', amount: 10, note: mark + ' bonus' }))
    await step('off period', () => post(`/api/rota/venues/${V}/staff/${staff.id}/off-periods`, { from_date: '2026-11-02', to_date: '2026-11-08', note: mark + ' holiday' }))
  }
  const staff2 = await step('staff 2', () => post(`/api/rota/venues/${V}/staff`, { name: mark + ' Sam Smith', pay_type: 'fixed', default_rate: 300 }))
  if (staff && shift) await step('shift rate', () => patch(`/api/rota/venues/${V}/staff/${staff.id}`, { shift_rates: [{ shift_id: shift.id, rate: 12 }] }))
  const W = `/api/rota/venues/${V}/weeks/${MONDAY}`
  const pot = await step('tip pot', () => post('/api/rota/pots', { name: mark + ' Floor tips', distribution: 'points' }))
  const line = pot ? await step('pot line', () => post(`/api/rota/pots/${pot.id}/lines`, { name: mark + ' Cash tips', kind: 'amount' })) : null
  if (line) await step('pot line amount', () => put(`${W}/pot-lines`, { amounts: [{ line_id: line.id, amount: 40 }] }))
  if (pot && staff) await step('pot payees', () => put(`${W}/pots/${pot.id}/payees`, { staff_ids: [staff.id] }))
  const manualPot = await step('manual pot', () => post('/api/rota/pots', { name: mark + ' Bar tips', distribution: 'manual' }))
  if (manualPot && staff) await step('manual pot amounts', () => put(`${W}/pots/${manualPot.id}/manual`, { amounts: [{ staff_id: staff.id, amount: 15 }] }))
  if (staff) {
    await step('tip added', () => post(`${W}/tip-moves`, { kind: 'money', action: 'add', lines: [{ to_staff_id: staff.id, amount: 5 }], note: mark + ' great shift' }))
    await step('points tap', () => post(`${W}/points-nudge`, { staff_id: staff.id, direction: 'minus' }))
  }
  ids.staff2 = staff2?.id
}
