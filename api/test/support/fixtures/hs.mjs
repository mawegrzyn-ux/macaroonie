// Food safety, checklists, the H&S action log, H&S test data.
import { MONDAY } from './parts.mjs'

export const order = 60

export async function fill(ctx) {
  const { V, mark, step, post } = ctx
  await step('equipment', () => post('/api/food-safety/equipment', { venue_id: V, name: mark + ' Walk-in', equipment_type: 'fridge', min_temp_c: 0, max_temp_c: 5 }))
  await step('capture time', () => post('/api/food-safety/capture-times', { venue_id: V, label: 'Morning', time_of_day: '09:00' }))
  await step('hold station', () => post('/api/food-safety/hold-stations', { venue_id: V, name: mark + ' Pass', hold_type: 'hot_hold' }))
  await step('hold time', () => post('/api/food-safety/hold-capture-times', { venue_id: V, label: 'Lunch', time_of_day: '12:30' }))
  await step('cooking session', () => post('/api/food-safety/cooking-sessions', { venue_id: V, label: 'Lunch', time_of_day: '12:00' }))
  await step('cooking item', () => post('/api/food-safety/cooking-items', { venue_id: V, name: mark + ' Chicken', category: 'Meat' }))
  await step('delivery', () => post('/api/food-safety/deliveries', { venue_id: V, delivery_date: MONDAY, vendor_name: mark + ' Fresh Co', items: [{ name: mark + ' veg' }], notes: mark + ' fine' }))
  const tpl = await step('checklist', () => post('/api/checklists/templates', { venue_id: V, name: mark + ' Opening', frequency: 'daily' }))
  if (tpl) await step('checklist item', () => post(`/api/checklists/templates/${tpl.id}/items`, { label: mark + ' Lights on' }))
  const cat = await step('action category', () => post('/api/hs-action-log/categories', { name: mark + ' Repairs' }))
  await step('action entry', () => post('/api/hs-action-log/entries', { venue_id: V, category_id: cat?.id, task: mark + ' Fix the door', priority: 'medium' }))
  await step('H&S test data', () => post(`/api/venues/${V}/test-data/hs/generate`, { date_from: '2026-10-12', date_to: '2026-10-14', kinds: ['temps', 'holds', 'cooking', 'orders', 'deliveries', 'checklists'] }))
}
