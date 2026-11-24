// src/services/connectors/common.js
//
// What every connector shares (docs/SALES_IMPORT.md 3.1): the error a
// connector throws, and the webhook address's token, kept only as its
// sha256 and checked in constant time. The sync (services/salesImportSvc.js)
// uses these whatever the system.

import { createHash, timingSafeEqual } from 'node:crypto'

export class ConnectorError extends Error {
  constructor(message, { tokenProblem = false, rateLimited = false, status = null } = {}) {
    super(message)
    this.status = 422
    this.tokenProblem = tokenProblem
    this.rateLimited = rateLimited
    this.upstreamStatus = status
  }
}

export const hashToken = token => createHash('sha256').update(String(token)).digest('hex')

/** The address's token against the stored sha256, in constant time. */
export function tokenMatches(token, storedHash) {
  if (!token || !storedHash) return false
  const a = Buffer.from(hashToken(token), 'hex')
  const b = Buffer.from(String(storedHash), 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Two strings compared in constant time (false when their lengths differ). */
export function sameSecret(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y)
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))
