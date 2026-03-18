// src/middleware/error.js

import { ZodError } from 'zod'

export function errorHandler(err, req, reply) {
  req.log.error({ err }, 'Unhandled error')

  // Zod validation errors
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error:  'Validation error',
      issues: err.flatten().fieldErrors,
    })
  }

  // PostgreSQL unique violation (e.g. double-booking hold)
  if (err.code === '23505') {
    return reply.code(409).send({ error: 'Conflict — resource already exists' })
  }

  // PostgreSQL lock not available (FOR UPDATE NOWAIT)
  if (err.code === '55P03') {
    return reply.code(409).send({ error: 'Slot conflict — please try again' })
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return reply.code(409).send({ error: 'Referenced resource not found' })
  }

  // Known application errors thrown as { statusCode, message }
  if (err.statusCode) {
    return reply.code(err.statusCode).send({ error: err.message })
  }

  return reply.code(500).send({ error: 'Internal server error' })
}

/** Throw a clean HTTP error from anywhere in the app */
export function httpError(statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}
