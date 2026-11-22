// Kitchen screens: a screen linked from the installer, boxes (a station, the
// printer from hub.mjs, a Splitter, a Sleeper), kitchen flows (the till from
// till.mjs as a "sent from" filter, one shared by every location), and the
// GloriaFood orders on the screens (the link: cash.mjs).
import { ok } from '../app.mjs'

export const order = 160

export async function fill(ctx) {
  const { V, mark, ids, made, c, step, post, put, patch, get } = ctx
  const { dish, printer, tillDevice, orderType } = made
  await step('linked kitchen screen', async () => {
    const shown = await ok(c.post('/pos-api/pairings', { app: 'kds', device: { width: 1280, height: 800 } }), 'device code')
    await ok(c.post('/api/installer/lookup', { code: shown.code }), 'installer lookup')
    return post(`/api/pos/venues/${V}/link`, { code: shown.code, name: mark + ' Pass screen' })
  })
  const station = await step('kitchen station', () => post(`/api/pos/venues/${V}/kds-stations`, { name: mark + ' Wok', kind: 'prep' }))
  // A kitchen printer in the flow (migration 191).
  const printerBox = printer ? await step('kitchen printer box', () => post(`/api/pos/venues/${V}/kds-stations`, { name: mark + ' Ticket printer', kind: 'printer', settings: { printer_id: printer.id } })) : null
  // A Splitter (kind balance, migration 183) whose pieces name one of the tenant's dishes.
  if (dish) await step('balance box', () => post(`/api/pos/venues/${V}/kds-stations`, { name: mark + ' Wings', kind: 'balance', settings: { pieces: [{ kind: 'dish', id: dish.id, label: dish.name, qty: 8 }] } }))
  // A Sleeper (migration 200): holds dishes for its minutes.
  await step('sleeper', () => post(`/api/pos/venues/${V}/kds-stations`, { name: mark + ' Delivery wait', kind: 'sleeper', settings: { delay_mins: 10 } }))
  // Kitchen flows (migration 177): the first comes with the setup page; a
  // second copied from it, renamed, put first and in use.
  const tillSetup = station ? await step('till setup', () => get(`/api/pos/venues/${V}/setup`)) : null
  const mainFlow = tillSetup?.kds_flows?.[0]
  if (station && mainFlow) {
    await step('kitchen flow', () => put(`/api/pos/kds-flows/${mainFlow.id}`, {
      links: [{ from: null, to: station.id, targets: [] }, ...(printerBox ? [{ from: null, to: printerBox.id, targets: [] }] : [])],
      layout: { start: { x: 28, y: 28 }, [station.id]: { x: 378, y: 28 } },
    }))
    const busy = await step('second kitchen flow', () => post(`/api/pos/venues/${V}/kds-flows`, { name: mark + ' Busy', copy_from: mainFlow.id }))
    if (busy) {
      await step('rename kitchen flow', () => patch(`/api/pos/kds-flows/${busy.id}`, { name: mark + ' Busy night' }))
      await step('kitchen flows order', () => put(`/api/pos/venues/${V}/kds-flows/order`, { ids: [busy.id, mainFlow.id] }))
      await step('kitchen flow in use', () => put(`/api/pos/venues/${V}/kds-flows/active`, { flow_id: busy.id }))
      // A "sent from" filter (migration 192) on the flow not in use: this
      // venue's till, by id; and the printer gets every dish but the till's
      // (an Except link, migration 204).
      if (tillDevice?.device) {
        await step('kitchen flow sent from', () => put(`/api/pos/kds-flows/${mainFlow.id}`, {
          links: [
            { from: null, to: station.id, targets: [{ kind: 'device', id: tillDevice.device.id }] },
            ...(printerBox ? [{ from: null, to: printerBox.id, targets: [{ kind: 'device', id: tillDevice.device.id }], exclude: true }] : []),
          ],
          layout: { start: { x: 28, y: 28 }, [station.id]: { x: 378, y: 28 } },
        }))
      }
    }
    // A flow shared by every location (migration 192): boxes by name, a dish
    // filter and a till by name. Hertford's setup page first, so it has a
    // flow of its own before any shared one exists.
    if (ids.venue2) await step('hertford till setup', () => get(`/api/pos/venues/${ids.venue2}/setup`))
    const sharedFlow = await step('shared kitchen flow', () => post(`/api/pos/venues/${V}/kds-flows`, { name: mark + ' Every site', shared: true }))
    if (sharedFlow) {
      const wokBox = crypto.randomUUID()
      const passBox = crypto.randomUUID()
      await step('shared kitchen flow links', () => put(`/api/pos/kds-flows/${sharedFlow.id}`, {
        boxes: [{ id: wokBox, name: station.name, kind: 'prep' }, { id: passBox, name: mark + ' Pass', kind: 'expo' }],
        links: [
          { from: null, to: wokBox, targets: [...(dish ? [{ kind: 'item', id: dish.id }] : []), { kind: 'device', name: mark + ' Till 1' }] },
          { from: wokBox, to: passBox, targets: [{ kind: 'device', name: mark + ' Bar till' }], exclude: true },
        ],
        layout: { start: { x: 28, y: 28 }, [wokBox]: { x: 378, y: 28 } },
      }))
    }
  }
  // GloriaFood's orders on the kitchen screens (migration 178).
  if (orderType) {
    await step('gloriafood kitchen settings', () => patch(`/api/pos/venues/${V}/settings`, {
      kds_gloriafood: true, kds_gloriafood_lead_mins: 25, kds_gloriafood_types: { pickup: orderType.id, delivery: null },
    }))
  }
}
