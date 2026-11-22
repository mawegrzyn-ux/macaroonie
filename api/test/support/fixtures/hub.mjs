// The venue hub and printing: a network printer, one plugged into the till
// (made.tillDevice from till.mjs), the hub itself, a kitchen ticket design.
// Hands on made.printer (kitchen.mjs puts it in a flow).
import { ok } from '../app.mjs'

export const order = 150

export async function fill(ctx) {
  const { V, mark, made, c, step, post, put } = ctx
  const { tillDevice } = made
  const printer = await step('printer', () => post(`/api/pos/venues/${V}/printers`, { name: mark + ' Kitchen', host: '192.168.1.50', language: 'star' }))
  made.printer = printer
  // Printers (migration 191): one plugged into the till, and a venue hub for the network ones.
  if (tillDevice?.device) {
    await step('device printer', () => post(`/api/pos/venues/${V}/printers`, { name: mark + ' Till printer', kind: 'receipt', connection: 'device', device_id: tillDevice.device.id }))
  }
  await step('venue hub', async () => {
    const shown = await ok(c.post('/pos-api/pairings', { app: 'hub' }), 'hub code')
    return post(`/api/pos/venues/${V}/link`, { code: shown.code, name: mark + ' Hub' })
  })
  // Print designs (migration 190): a kitchen ticket design used at Ware with its own words.
  const printDesign = await step('print design', () => post('/api/pos/print-designs', { kind: 'kitchen', name: mark + ' Tickets' }))
  if (printDesign) {
    await step('print design layout', () => put(`/api/pos/print-designs/${printDesign.id}`, { name: mark + ' Tickets', layout: { blocks: [
      { id: 'tt', type: 'title', opts: { main: 'tent' } }, { id: 'tx', type: 'text', opts: { text: mark + ' thanks' } }, { id: 'it', type: 'items', opts: {} },
    ] } }))
    await step('print design use', () => put('/api/pos/print-design-uses', { venue_id: V, use: 'kitchen', design_id: printDesign.id }))
    await step('print design words', () => put(`/api/pos/print-designs/${printDesign.id}/variations/${V}`, { texts: { tx: { text: mark + ' Ware words' } }, hidden: [] }))
  }
}
