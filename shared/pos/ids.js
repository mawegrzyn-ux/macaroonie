// shared/pos/ids.js
//
// Ids made on the device (terminal, hub or cloud): ULIDs, 26 characters,
// time-ordered, so events and checks can be created offline without asking
// anyone for an id. Uses crypto.getRandomValues (browsers and Node 22).

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32

function randomBytes(n) {
  const bytes = new Uint8Array(n)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

let lastTime = -1
let lastRandom = null

/** A new ULID. Ids made in the same millisecond still sort in creation order. */
export function ulid(now = Date.now()) {
  let random
  if (now === lastTime && lastRandom) {
    random = Uint8Array.from(lastRandom)
    for (let i = random.length - 1; i >= 0; i--) {
      if (random[i] < 255) { random[i]++; break }
      random[i] = 0
    }
  } else {
    random = randomBytes(10)
  }
  lastTime = now
  lastRandom = random

  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  // 80 random bits as 16 base32 characters.
  let bits = 0, value = 0, out = ''
  for (const b of random) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  return time + out.slice(0, 16)
}

export const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

export function isId(v) {
  return typeof v === 'string' && ID_PATTERN.test(v)
}
