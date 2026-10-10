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

// The change / cancel rules live in services/guestBookingSvc.js, shared
// with the AI booking tools.

const ModifyBody = z.object({
  date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
  covers: z.coerce.number().int().min(1).max(50).optional(),
})

async function renderManage(reply, { booking, token, flash, error }) {
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

    await cancelBooking(booking)

    reply.redirect(`/manage/${req.params.token}?flash=cancelled`)
  })
}
