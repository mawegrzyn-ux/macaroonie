// shared/pos/tillSettings.js
//
// What a till does where it has its own setting (Store tech > Tills,
// pos_devices.settings), and what it follows otherwise, as pure rules on the
// till's config: the till app (pos/src/lib/checkOps.js re-exports these) and
// the admin's till window (its "As the stream: ..." hints) read the same rule.
//
//   - counter or table service (settings.mode)
//   - leaving an order with items not sent: ask (the default) or leave
//   - the receipt when a check is paid, and how a new order's order type,
//     name and tent number are asked: the till's own choice, else the
//     revenue stream's (pos_revenue_streams.receipt_mode / order_prompt,
//     migration 296; they were venue settings before)

export const RECEIPT_MODE_KEYS = ['ask', 'always', 'never']
export const ORDER_PROMPT_KEYS = ['one', 'two']

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

/** A revenue stream's receipt when a check is paid: 'ask' (default) | 'always' | 'never'. */
export const streamReceiptMode = stream => (RECEIPT_MODE_KEYS.includes(stream?.receipt_mode) ? stream.receipt_mode : 'ask')

/** A revenue stream's order prompt: 'one' (one screen, default) | 'two' (two steps). */
export const streamOrderPrompt = stream => (stream?.order_prompt === 'two' ? 'two' : 'one')

/**
 * The stream a till setting follows: the check's (streamId), else the till's
 * own stream, else the first, as a new check picks it.
 */
export function tillStream(config, streamId = null) {
  const list = config?.revenue_streams || []
  return list.find(s => s.id === streamId)
    || list.find(s => s.id === config?.device?.settings?.revenue_stream_id)
    || list[0] || null
}

/**
 * What happens to the receipt when a check is paid: the till's own choice
 * (Store tech > Tills), else the check's revenue stream's.
 */
export function receiptModeOf(config, streamId = null) {
  const own = config?.device?.settings?.receipt_mode
  if (RECEIPT_MODE_KEYS.includes(own)) return own
  return streamReceiptMode(tillStream(config, streamId))
}

/**
 * How the till asks for a new order's order type, name and tent number
 * (pos/src/components/OrderPrompt.jsx): the till's own choice, else the
 * revenue stream's (the check's, or the one a new order starts in).
 */
export function orderPromptOf(config, streamId = null) {
  const own = config?.device?.settings?.order_prompt
  if (ORDER_PROMPT_KEYS.includes(own)) return own
  return streamOrderPrompt(tillStream(config, streamId))
}
