// src/services/vault.js
//
// Stored integration keys, sealed (migration 179): AES-256-GCM with a master
// key from the environment (SECRETS_KEY: 32 bytes, base64 or hex), so a
// leaked database dump or backup doesn't hand over every tenant's
// integrations and the platform's AI key. The deploy adds SECRETS_KEY to
// api/.env when it is missing (scripts/ensure-secrets-key.sh); without it
// the API refuses to start in production. Losing it makes the stored keys
// unreadable: they have to be typed in again.
//
//   seal(text)    'v1:' + base64(iv | tag | ciphertext), a fresh iv each time
//   unseal(v)     the text back; a value without the prefix is one stored
//                 before sealing and is returned as it is, until
//                 sealStoredSecrets() (run at API start) seals it
//   SEALED        every column that holds a sealed key
//
// Sealed columns: platform_secrets.value (the Anthropic key, the kiosk
// preview signing key),
// loyverse_connections.access_token, gloriafood_venue_links.poll_key,
// venue_email_settings.provider_api_key / provider_secret / smtp_pass,
// pos_card_accounts.secret (card machine provider keys, migration 193),
// pos_receipts.email_to (a guest's address waiting for a counter order to be
// paid, migration 210; cleared once the receipt is sent).
// Hints (last 4 characters) are kept beside them in plain text for display.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { systemSql } from '../config/db.js'

const PREFIX = 'v1:'

export const SEALED = [
  { table: 'platform_secrets',      column: 'value',            key: 'name' },
  { table: 'loyverse_connections',  column: 'access_token',     key: 'id' },
  { table: 'gloriafood_venue_links', column: 'poll_key',        key: 'id' },
  { table: 'venue_email_settings',  column: 'provider_api_key', key: 'id' },
  { table: 'venue_email_settings',  column: 'provider_secret',  key: 'id' },
  { table: 'venue_email_settings',  column: 'smtp_pass',        key: 'id' },
  { table: 'pos_card_accounts',     column: 'secret',           key: 'id' },
  { table: 'pos_receipts',          column: 'email_to',         key: 'id' },
]

/** The master key from SECRETS_KEY (base64 or hex of 32 bytes), or null when unset. */
export function keyFromEnv(raw = process.env.SECRETS_KEY) {
  if (!raw) return null
  const text = String(raw).trim()
  const buf = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64')
  if (buf.length !== 32) throw new Error('SECRETS_KEY must be 32 bytes, base64 or hex (openssl rand -base64 32)')
  return buf
}

let master = null
function masterKey() {
  if (master) return master
  const k = keyFromEnv()
  if (k) return (master = k)
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SECRETS_KEY is not set: stored integration keys can\'t be sealed or read')
  }
  // Development and tests: a fixed key, so every process agrees. Never used
  // in production (above).
  return (master = createHash('sha256').update('macaroonie-development-secrets-key').digest())
}

/** Checked at start: production must have a valid SECRETS_KEY. Throws otherwise. */
export function checkVault() {
  masterKey()
}

export const isSealed = v => typeof v === 'string' && v.startsWith(PREFIX)

export function seal(text) {
  if (text == null || text === '') return text ?? null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

export function unseal(value) {
  if (!isSealed(value)) return value ?? null
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64')
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('A stored key could not be read (was SECRETS_KEY changed?). Type the key in again where it was set up.')
  }
}

/**
 * Seal every stored key that isn't sealed yet (keys saved before migration
 * 179). Runs at API start in system mode; each row is updated only if it
 * still holds the plain value, so several processes doing it at once is
 * harmless. Returns how many were sealed.
 */
export async function sealStoredSecrets() {
  let n = 0
  for (const { table, column, key } of SEALED) {
    const rows = await systemSql`
      SELECT ${systemSql(key)} AS k, ${systemSql(column)} AS v FROM ${systemSql(table)}
       WHERE ${systemSql(column)} IS NOT NULL AND ${systemSql(column)} <> '' AND ${systemSql(column)} NOT LIKE ${PREFIX + '%'}`
    for (const r of rows) {
      const done = await systemSql`
        UPDATE ${systemSql(table)} SET ${systemSql(column)} = ${seal(r.v)}
         WHERE ${systemSql(key)} = ${r.k} AND ${systemSql(column)} = ${r.v}`
      n += done.count
    }
  }
  return n
}
