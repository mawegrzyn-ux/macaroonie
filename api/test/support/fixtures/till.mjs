// The till: tax rates, order types and revenue streams, charges and
// discounts, a till and its card machine, till settings, a floor area, a till
// layout, order flows. Hands on made.orderType and made.tillDevice. Last
// (fillLate), till sales made up and cleared, once the printers, kitchen,
// kiosk and screens are there too.
import { ok } from '../app.mjs'

export const order = 140
// After the menu screens, where the test sales have always been made.
export const lateOrder = 190

export const kinds = { dayId: ['pos_days'] }

export async function fill(ctx) {
  const { V, mark, slug, made, c, step, post, put, patch } = ctx
  const { dish, menuSection } = made
  const tax = await step('tax rate', () => post('/api/tax-rates', { name: mark + ' Zero', rate: 0 }))
  if (tax) await step('tax rate value', () => put(`/api/tax-rates/${tax.id}/values`, { values: { [V]: 5 } }))
  const orderType = await step('order type', () => post('/api/order-types', { name: mark + ' Drive thru' }))
  made.orderType = orderType
  // Charges on the company's list (migration 231): a service charge from 6
  // guests, a packaging fee with the tenant's own tax rate, and a cup deposit
  // for each of a dish and the dishes of a section (the venue's matrix below).
  const chargeSvc = await step('charge', () => post('/api/pos/charges', { name: mark + ' Service', kind: 'percent', value: 10, optional: true, min_covers: 6 }))
  const chargePack = await step('charge with a tax rate', () => post('/api/pos/charges', { name: mark + ' Packaging', kind: 'amount', value: 30, tax_rate_id: tax?.id ?? null }))
  const chargeCup = dish && menuSection
    ? await step('dish charge', () => post('/api/pos/charges', { name: mark + ' Cup deposit', kind: 'amount', value: 25, optional: true, basis: 'dishes', per: 'dish', item_ids: [dish.id], section_ids: [menuSection.id] }))
    : null
  // A discount on the company's list (migration 225).
  const tillDiscount = await step('till discount', () => post('/api/pos/discounts', { name: mark + ' Staff meal', kind: 'percent', value: 50, scope: 'check', needs_manager: true }))

  // Covers that must be had and no courses (migration 231), then which
  // charges its checks of the Drive thru order type get.
  const stream = await step('revenue stream', () => post(`/api/pos/venues/${V}/revenue-streams`, { name: mark + ' Bar', covers: 'must', courses: false }))
  if (stream && orderType && chargeSvc && chargePack) {
    await step('charge rules', () => put(`/api/pos/venues/${V}/charge-rules`, { rules: [chargeSvc, chargePack, chargeCup].filter(Boolean).map(x => ({ charge_id: x.id, revenue_stream_id: stream.id, order_type_id: orderType.id })) }))
  }
  // Devices show a code of their own and are linked by it (migration 184):
  // a till from Store tech (a kitchen screen from the installer: kitchen.mjs).
  const tillDevice = await step('till device', async () => {
    const shown = await ok(c.post('/pos-api/pairings', { app: 'terminal' }), 'device code')
    return post(`/api/pos/venues/${V}/link`, { code: shown.code, name: mark + ' Till 1', settings: { mode: 'table' } })
  })
  made.tillDevice = tillDevice
  // A card machine (migration 193): the test machine, the till's.
  const cardMachine = await step('card machine', () => post(`/api/pos/venues/${V}/card-readers`, { provider: 'test', name: mark + ' Test card machine' }))
  if (cardMachine && tillDevice?.device) {
    await step('till card machine', () => patch(`/api/pos/devices/${tillDevice.device.id}`, { settings: { mode: 'table', card_reader: cardMachine.id } }))
    await step('card machine name', () => patch(`/api/pos/card-readers/${cardMachine.id}`, { name: mark + ' Counter card machine' }))
  }
  await step('till settings', () => patch(`/api/pos/venues/${V}/settings`, { receipt_name: mark + ' Thai House' }))
  await step('floor area', () => post(`/api/pos/venues/${V}/floor-areas`, { name: mark + ' Patio' }))
  // A till layout (migration 228) naming a section, a dish, a discount and a charge of the
  // tenant's, used by Ware's tills and by the till itself; its Dishes zone leaves the dish
  // out and a category's dishes zone under it shows the section, the dish left out too.
  // That zone is shown as a pop-up list (12 Nov 2026), opened by a button of the Buttons zone.
  const tillLayout = await step('till layout', () => post('/api/pos/till-layouts', { name: mark + ' Counter screen', template: 'quick' }))
  if (tillLayout) {
    const zones = tillLayout.layout.zones.map(z => {
      if (z.type === 'categories' && menuSection) return { ...z, sections: [menuSection.id] }
      if (z.type === 'items' && menuSection) return { ...z, h: z.h - 2, hide_item_ids: dish ? [dish.id] : [] }
      if (z.type === 'buttons') {
        return {
          ...z,
          buttons: [
            ...z.buttons,
            ...(dish ? [{ id: 'fx-dish', action: 'item', item_id: dish.id, label: mark + ' Pad Thai' }] : []),
            ...(tillDiscount ? [{ id: 'fx-disc', action: 'discount_preset', preset_id: tillDiscount.id }] : []),
            ...(chargeCup ? [{ id: 'fx-charge', action: 'charge', charge_id: chargeCup.id }] : []),
            ...(menuSection ? [{ id: 'fx-open', action: 'open_popup', popup_id: 'fx-category' }] : []),
          ],
        }
      }
      return z
    })
    const dishes = zones.find(z => z.type === 'items')
    if (menuSection && dishes) {
      zones.push({
        id: 'fx-category', type: 'category', x: dishes.x, y: dishes.y + dishes.h, w: dishes.w, h: 2, section_id: menuSection.id, hide_item_ids: dish ? [dish.id] : [],
        show: 'popup', title: mark + ' Specials', cover: 'screen', view: 'list', rows: 4, close_on_tap: true,
      })
    }
    await step('till layout zones', () => put(`/api/pos/till-layouts/${tillLayout.id}`, { name: mark + ' Counter screen', layout: { ...tillLayout.layout, zones } }))
    await step('venue till layout', () => patch(`/api/pos/venues/${V}/settings`, { till_layout_id: tillLayout.id }))
    if (tillDevice?.device) {
      await step('till own layout', () => patch(`/api/pos/devices/${tillDevice.device.id}`, { settings: { mode: 'table', ...(cardMachine ? { card_reader: cardMachine.id } : {}), till_layout: tillLayout.id } }))
    }
  }
  // Order flows (migrations 235, 236): a prompt at Ware's till when the dish
  // is added on the Bar channel's Drive thru orders, offering the dish; and
  // one that adds the dish (which staff can't take off) and the cup deposit
  // on Drive thru orders, on tills, kiosks and online ordering. Both on, the
  // second first.
  if (dish && menuSection) {
    const askFlow = await step('order flow', () => post('/api/pos/order-flows', { name: mark + ' Add a drink', kind: 'ask' }))
    if (askFlow) {
      await step('order flow saved', () => put(`/api/pos/order-flows/${askFlow.id}`, {
        ...askFlow, name: mark + ' Add a drink', on: true, trigger: 'dish_added',
        venue_ids: [V], till_ids: tillDevice?.device ? [tillDevice.device.id] : null,
        match: { ...askFlow.match, stream_names: [mark + ' Bar'], type_ids: orderType ? [orderType.id] : [], item_ids: [dish.id], section_ids: [menuSection.id] },
        ask: {
          ...askFlow.ask, title: mark + ' Add a drink?', item_ids: [dish.id],
          // Its own look on tills and online ordering (the sweep replays it as the other group).
          look: {
            till: { header: { style: 'band', align: 'center' }, colours: { header: 'primary', cards: '#fef3c7' } },
            online: { dishes: 'cards', header: { style: 'picture', image_url: '/uploads/' + slug + '-drinks.jpg' } },
          },
        },
      }))
    }
    const addFlow = await step('order flow add', () => post('/api/pos/order-flows', { name: mark + ' Drive thru extras', kind: 'add' }))
    if (addFlow) {
      await step('order flow add saved', () => put(`/api/pos/order-flows/${addFlow.id}`, {
        ...addFlow, name: mark + ' Drive thru extras', on: true, apps: ['till', 'kiosk', 'online'],
        match: { ...addFlow.match, type_ids: orderType ? [orderType.id] : [], not_section_ids: [menuSection.id] },
        adds: [{ kind: 'dish', item_id: dish.id, qty: 1, removable: false }, ...(chargeCup ? [{ kind: 'charge', charge_id: chargeCup.id, removable: true }] : [])],
      }))
      if (askFlow) await step('order flows order', () => put('/api/pos/order-flows/order', { ids: [addFlow.id, askFlow.id] }))
    }
  }
}

export async function fillLate(ctx) {
  const { V, mark, step, post } = ctx
  // Till sales made up on the Test data page (migration 245), then cleared,
  // so no test counts them: the sweep sends both again as the other tenant.
  const pastDay = n => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
  await step('till test sales', () => post(`/api/venues/${V}/test-data/till/generate`, { date_from: pastDay(4), date_to: pastDay(3), per_day: 6, seed: mark }))
  await step('till test sales cleared', () => post(`/api/venues/${V}/test-data/till/clear`, { date_from: pastDay(4), date_to: pastDay(3), confirm: true }))
}
