// Kiosks: a kiosk design with a look of its own for the tenant's option group
// (made.vg from menus.mjs) and the done screen of its order type
// (made.orderType from till.mjs).
export const order = 170

export async function fill(ctx) {
  const { mark, made, step, post, put } = ctx
  const { vg, orderType } = made
  const kioskDesign = await step('kiosk design', () => post('/api/pos/kiosk-designs', { name: mark + ' Kiosk' }))
  // A look of its own for the tenant's option group (options.group_looks).
  if (kioskDesign && vg) {
    await step('kiosk design group look', () => put(`/api/pos/kiosk-designs/${kioskDesign.id}`, {
      name: mark + ' Kiosk', settings: {
        options: { group_looks: [{ group_id: vg.id, tiles: 'hexagon', entrance: 'deal' }] },
        // The order done screen of the tenant's own order type (done.types, migration 209's change).
        ...(orderType ? { done: { receipt_qr: true, types: [{ order_type_id: orderType.id, main: 'name', lines: ['number'], message: mark + ' collect at the window' }] } } : {}),
      },
    }))
  }
}
