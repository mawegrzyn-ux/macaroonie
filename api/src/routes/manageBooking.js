// src/routes/manageBooking.js
//
// Public guest-facing booking management.
//
// No auth — the manage_token UUID IS the authentication.
// Registered at /manage in app.js.
//
//   GET  /manage/:token        → SSR page showing booking details
//   POST /manage/:token/modify → reschedule (date, time, covers)
//   POST /manage/:token/cancel → cancel the booking

import { z }                from 'zod'
import { env }              from '../config/env.js'
import { httpError }        from '../middleware/error.js'
import {
  loadBookingByToken, canModify, canCancel, venueLocalParts,
  rescheduleBooking, cancelBooking,
} from '../services/guestBookingSvc.js'
import { bookingDeposit, refundRule, money } from '../services/depositSvc.js'

// The change / cancel rules live in services/guestBookingSvc.js, shared
// with the AI booking tools.

const ModifyBody = z.object({
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  covers: z.coerce.number().int().min(1).max(50).optional(),
})

/** What the manage page says about the booking's deposit, or null. */
async function depositView(booking) {
  const p = await bookingDeposit(booking.t_tenant_id, booking.id)
  if (!p) return null
  const paid = Math.round(Number(p.amount) * 100)
  const refunded = Math.round(Number(p.refunded_amount || 0) * 100)
  const rule = refundRule(p, booking.starts_at)
  let untilText = null
  if (rule.until) {
    untilText = new Intl.DateTimeFormat('en-GB', {
      timeZone: booking.venue_timezone || 'Europe/London', weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(rule.until)
  }
  return {
    paid: money(paid, p.currency),
    refunded: refunded ? money(refunded, p.currency) : null,
    fully_refunded: refunded >= paid,
    non_refundable: p.refund_hours_before == null,
    refundable_now: rule.refundable && refunded < paid,
    until: untilText,
  }
}

async function renderManage(reply, { booking, token, flash, error, depositFlash }) {
  const startDate = new Date(booking.starts_at)
  const endDate   = booking.ends_at ? new Date(booking.ends_at) : null
  const local     = await venueLocalParts(booking.starts_at, booking.venue_timezone)
  return reply.view('manage/index.eta', {
    booking,
    startDate,
    endDate,
    localDate: local.local_date,
    localTime: local.local_time,
    canModify: canModify(booking),
    canCancel: canCancel(booking),
    token,
    rootDomain: env.PUBLIC_ROOT_DOMAIN,
    flash:     flash || null,
    error:     error || null,
    deposit:   await depositView(booking).catch(() => null),
    depositFlash: depositFlash || null,
  })
}

export default async function manageBookingRoutes(app) {

  app.get('/:token', async (req, reply) => {
    const booking = await loadBookingByToken(req.params.token)
    if (!booking) return reply.code(404).view('site/not-found.eta', {
      message: 'Booking not found or link has expired.',
      rootDomain: env.PUBLIC_ROOT_DOMAIN,
    })
    return renderManage(reply, {
      booking,
      token: req.params.token,
      flash: req.query.flash || null,
      depositFlash: ['refunded', 'kept', 'error'].includes(req.query.deposit) ? req.query.deposit : null,
    })
  })

  app.post('/:token/modify', async (req, reply) => {
    const booking = await loadBookingByToken(req.params.token)
    if (!booking) throw httpError(404, 'Booking not found')
    if (!canModify(booking)) throw httpError(403, 'This booking cannot be modified')

    const fail = (message) => renderManage(reply.code(422), {
      booking, token: req.params.token, error: message,
    })

    let body
    try {
      body = ModifyBody.parse(req.body || {})
    } catch {
      return fail('Please check the date, time, and number of guests.')
    }

    if (!body.date && !body.time && !body.covers) {
      return fail('Nothing to change')
    }

    try {
      await rescheduleBooking(booking, body)
    } catch (err) {
      if (err.statusCode && err.statusCode < 500) {
        return fail(err.message)
      }
      throw err
    }

    reply.redirect(`/manage/${req.params.token}?flash=modified`)
  })

  app.post('/:token/cancel', async (req, reply) => {
    const booking = await loadBookingByToken(req.params.token)
    if (!booking) throw httpError(404, 'Booking not found')
    if (!canCancel(booking)) {
      return renderManage(reply.code(403), {
        booking, token: req.params.token,
        error: 'This booking can no longer be cancelled',
      })
    }

    const row = await cancelBooking(booking)
    const d = row?.deposit
    const tag = !d ? '' : d.refunded_pence ? '&deposit=refunded' : d.kept_pence ? '&deposit=kept' : d.error ? '&deposit=error' : ''

    reply.redirect(`/manage/${req.params.token}?flash=cancelled${tag}`)
  })
}
