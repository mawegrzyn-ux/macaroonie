// shared/pos/pin.js
//
// Staff PINs. The API stores a hash (cash_staff.pos_pin_hash); the till
// receives the hashes with its config so people can sign in with the
// internet down. Both sides hash the same way here (WebCrypto PBKDF2,
// available in browsers and Node 22).
//
// Every PIN in a venue is hashed with the venue's salt (pos_settings.pin_salt),
// so a typed PIN finds its person without a name being picked first, and two
// people can't share a PIN. A 4-6 digit PIN can't resist someone holding the
// hashes and trying them all; the hashes only go to the venue's own paired
// tills, and the hash makes that slower, not impossible.

export const PIN_ITERATIONS = 60000
export const PIN_PATTERN = /^[0-9]{4,6}$/

const enc = new TextEncoder()
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

export async function hashPin(pin, salt) {
  if (!PIN_PATTERN.test(String(pin))) throw new Error('A PIN is 4 to 6 digits')
  // Browsers only offer WebCrypto on https:// (and localhost).
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Open the till at https:// to sign in')
  const key = await subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(String(salt)), iterations: PIN_ITERATIONS }, key, 256)
  return 'p1$' + hex(bits)
}

/** PINs too easy to guess. */
export function weakPin(pin) {
  const p = String(pin)
  if (/^(\d)\1+$/.test(p)) return 'All the same digit'
  const up = '0123456789', down = '9876543210'
  if (up.includes(p) || down.includes(p)) return 'Digits in a row'
  return null
}
