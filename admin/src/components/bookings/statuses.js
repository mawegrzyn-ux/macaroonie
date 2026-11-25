// src/components/bookings/statuses.js
//
// Which booking statuses staff can set by hand, and which of them a venue's
// booking rules offer: the one rule the booking drawer, the Bookings list and
// the phone pages share. pending_payment is set by a deposit, never by hand.
// The API (PATCH /bookings/:id/status) takes any of them.

export const SELECTABLE_STATUSES = [
  'unconfirmed', 'confirmed', 'reconfirmed', 'arrived',
  'seated', 'checked_out', 'no_show', 'cancelled',
]

/**
 * The statuses to offer for a booking now at `current`, by the venue's
 * rules (GET /venues/:id/rules): Not confirmed, Re-confirmed and Arrived
 * only when the venue uses them, or when the booking already has it.
 */
export function statusChoices(rules, current) {
  return SELECTABLE_STATUSES.filter(s => {
    if (s === 'unconfirmed') return (rules?.enable_unconfirmed_flow ?? false) || current === 'unconfirmed'
    if (s === 'reconfirmed') return (rules?.enable_reconfirmed_status ?? false) || current === 'reconfirmed'
    if (s === 'arrived')     return (rules?.enable_arrived_status ?? true) || current === 'arrived'
    return true
  })
}

/** Gone from the day's service: hidden from the lists unless asked for. */
export const INACTIVE_STATUSES = new Set(['cancelled', 'no_show', 'checked_out'])
