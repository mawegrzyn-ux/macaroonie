// src/middleware/error.js

import { ZodError } from 'zod'

export function errorHandler(err, req, reply) {
  const { status, body } = errorResponse(err)
  // Refusals and bad input are expected: one line at warn. Only what becomes
  // a 500 is logged as an error, with the stack.
  if (status >= 500) req.log.error({ err }, 'Unhandled error')
  else req.log.warn({ status, error: body.error, code: typeof err.code === 'string' ? err.code : undefined }, 'Request refused')
  return reply.code(status).send(body)
}

/** The status and JSON body an error becomes (also sent as a chat stream's
 *  error event, src/ai/sse.js). */
export function errorResponse(err) {
  // Zod validation errors
  if (err instanceof ZodError) {
    return { status: 400, body: { error: 'Validation error', issues: err.flatten().fieldErrors } }
  }

  // PostgreSQL unique violation (e.g. double-booking hold)
  if (err.code === '23505') return { status: 409, body: { error: 'Conflict — resource already exists' } }

  // PostgreSQL exclusion constraint (overlapping hold occupancy)
  if (err.code === '23P01') return { status: 409, body: { error: 'Slot conflict — table already occupied' } }

  // PostgreSQL lock not available (FOR UPDATE NOWAIT)
  if (err.code === '55P03') return { status: 409, body: { error: 'Slot conflict — please try again' } }

  // PostgreSQL foreign key violation
  if (err.code === '23503') return { status: 409, body: { error: 'Referenced resource not found' } }

  // PostgreSQL invalid text for a type: a malformed id (in the address or
  // the body) is a record that doesn't exist; anything else is bad input.
  if (err.code === '22P02') {
    return /uuid/i.test(err.message || '')
      ? { status: 404, body: { error: 'Not found' } }
      : { status: 400, body: { error: 'Invalid value' } }
  }

  // Known application errors thrown as { statusCode, message }
  // (`code` / `errors` pass through when set, e.g. web ordering's
  // 'slot_unavailable' and per-line basket errors.)
  if (err.statusCode) {
    const body = { error: err.message }
    if (typeof err.code === 'string') body.code = err.code
    if (Array.isArray(err.errors)) body.errors = err.errors
    if (err.extra) Object.assign(body, err.extra)
    return { status: err.statusCode, body }
  }

  return { status: 500, body: { error: 'Internal server error' } }
}

/** Throw a clean HTTP error from anywhere in the app. `extra` ({ code, ...ids })
 *  goes into the body beside `error`: `code` and plain ids only, never data. */
export function httpError(statusCode, message, extra) {
  const err = new Error(message)
  err.statusCode = statusCode
  if (extra) {
    const { code, ...rest } = extra
    if (code) err.code = code
    if (Object.keys(rest).length) err.extra = rest
  }
  return err
}
