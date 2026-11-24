// shared/pos/tillSettings.js
//
// What a till does where it has its own setting (Store tech > Tills,
// pos_devices.settings), as pure rules on the till's config: the till app
// re-exports them from pos/src/lib/checkOps.js.
//
//   - counter or table service (settings.mode)
//   - leaving an order with items not sent: ask (the default) or leave

/** A counter till (else table service). */
export const counterTill = config => config?.device?.settings?.mode === 'counter'

/**
 * What leaving a table-service order with items not sent to the kitchen does
 * (Store tech > Tills): 'ask' (the default since migration 295: Stay on the
 * order, Leave without sending, Send and leave) or 'leave'. Anything but
 * 'leave' asks. Counter tills always leave: their orders go to the kitchen
 * as they are paid.
 */
export function leaveUnsent(config) {
  if (counterTill(config)) return 'leave'
  return config?.device?.settings?.leave_unsent === 'leave' ? 'leave' : 'ask'
}
