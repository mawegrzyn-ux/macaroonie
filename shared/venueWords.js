// shared/venueWords.js
//
// The venue's own words for speech (Pepper-first step 6c; docs/PEPPER_FIRST.md
// 4.7, reports/AI first back office strategy.md "The phone": menu vocabulary
// is the main failure point in restaurant speech). A venue's fridge and hold
// station names, dish names, staff first names and supplier names, from its
// own data (GET /api/ai/venue-words), used two ways:
//
//   hints        given to the recogniser where it takes them (the Office
//                app's Android recogniser: contextual strings; the browser's
//                Web Speech API takes none)
//   snapToWords  after the recogniser: a near miss of one of the venue's
//                words becomes that word ("walking fridge" -> "Walk-in
//                fridge"). Numbers are never touched (a measured value stays
//                as it was said: digits, number words, minus, point), a word
//                the venue has that was heard right stays ("Fresh Co" never
//                becomes the dish "Fresh Cod"), and short words are only
//                ever matched exactly, so everyday words aren't swallowed.
//
// Plain ESM, no dependencies: the admin and the API both use it.

/** At most this many words go to a recogniser, and come from one venue. */
export const MAX_WORDS = 300
/** A word or phrase longer than this isn't a name: left out. */
export const MAX_WORD_LENGTH = 60
/** Fewer letters than this (spaces and hyphens left out): matched exactly only. */
export const MIN_FUZZY_LETTERS = 7

const NUMBER_WORDS = new Set([
  'zero', 'oh', 'nought', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand',
  'minus', 'point', 'half', 'quarter', 'degree', 'degrees', 'celsius', 'percent',
])

const letters = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The words for one venue: names cleaned, each once (first spelling kept),
 * longest first, at most MAX_WORDS. Groups in the order given win a place
 * first when there are too many.
 */
export function venueWordList(groups) {
  const seen = new Set()
  const out = []
  for (const list of groups) {
    for (const raw of list || []) {
      const w = String(raw ?? '').replace(/\s+/g, ' ').trim()
      if (!w || w.length > MAX_WORD_LENGTH || !/[A-Za-z]/.test(w)) continue
      const key = w.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(w)
      if (out.length >= MAX_WORDS) return out
    }
  }
  return out
}

/** A staff member's first name ("Jo Bloggs" -> "Jo"). */
export const firstNameOf = name => String(name || '').trim().split(/\s+/)[0] || ''

function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** How far off a heard window may be from a word of `n` letters. */
const allowed = n => (n < MIN_FUZZY_LETTERS ? 0 : n < 9 ? 1 : n < 14 ? 2 : 3)

const isNumberish = t => /\d/.test(t) || NUMBER_WORDS.has(t.toLowerCase().replace(/[^a-z]/g, ''))

/**
 * The text with each near miss of a venue word replaced by the word. Returns
 * { text, changes: [{ from, to }] }. Never touches numbers or number words.
 */
export function snapToWords(text, words) {
  const src = String(text ?? '')
  if (!src || !Array.isArray(words) || !words.length) return { text: src, changes: [] }
  // Word tokens (letters, digits, inner hyphens and apostrophes) with where they sit.
  const tokens = []
  const re = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g
  let m
  while ((m = re.exec(src))) tokens.push({ t: m[0], start: m.index, end: m.index + m[0].length, num: isNumberish(m[0]) })
  if (!tokens.length) return { text: src, changes: [] }

  const phrases = words
    .map(w => ({ word: w, key: letters(w), n: (String(w).match(re) || []).length }))
    .filter(p => p.key && p.n)
  const byKey = new Map()
  for (const p of phrases) if (!byKey.has(p.key)) byKey.set(p.key, p.word)
  const locked = new Array(tokens.length).fill(false)
  const windowKey = (i, len) => letters(tokens.slice(i, i + len).map(x => x.t).join(''))
  const hasNumber = (i, len) => tokens.slice(i, i + len).some(x => x.num)
  const maxN = Math.max(...phrases.map(p => p.n)) + 1

  // Heard right: a venue word said as it is stays, and nothing else takes its
  // place. A long one heard with other spaces or hyphens ("walk in fridge")
  // takes the venue's spelling; a short one is left as said ("will" stays a verb).
  const exact = []
  for (let len = maxN; len >= 1; len--) {
    for (let i = 0; i + len <= tokens.length; i++) {
      const key = windowKey(i, len)
      if (!byKey.has(key)) continue
      let free = true
      for (let k = i; k < i + len; k++) if (locked[k]) { free = false; break }
      if (!free) continue
      for (let k = i; k < i + len; k++) locked[k] = true
      const word = byKey.get(key)
      const said = src.slice(tokens[i].start, tokens[i + len - 1].end)
      if (key.length >= MIN_FUZZY_LETTERS && !hasNumber(i, len) && said !== word && said.toLowerCase() !== word.toLowerCase()) exact.push({ i, len, word })
    }
  }

  // Near misses: windows of the word's own length, one more and one fewer.
  const found = []
  for (const p of phrases) {
    // A venue word with a number in it ("Fridge 2") is only ever matched exactly.
    const max = String(p.word).match(re).some(isNumberish) ? 0 : allowed(p.key.length)
    if (!max) continue
    for (const len of [p.n, p.n + 1, p.n - 1]) {
      if (len < 1) continue
      for (let i = 0; i + len <= tokens.length; i++) {
        if (hasNumber(i, len)) continue
        let free = true
        for (let k = i; k < i + len; k++) if (locked[k]) { free = false; break }
        if (!free) continue
        const heard = windowKey(i, len)
        if (heard[0] !== p.key[0]) continue
        const d = distance(heard, p.key, max)
        if (d > max) continue
        found.push({ i, len, word: p.word, d: d / p.key.length, size: p.key.length })
      }
    }
  }
  // The closest first, then the longest; no two replacements share a word.
  found.sort((a, b) => a.d - b.d || b.size - a.size || a.i - b.i)
  const taken = new Array(tokens.length).fill(false)
  const chosen = []
  for (const f of found) {
    let free = true
    for (let k = f.i; k < f.i + f.len; k++) if (taken[k]) { free = false; break }
    if (!free) continue
    for (let k = f.i; k < f.i + f.len; k++) taken[k] = true
    chosen.push(f)
  }
  chosen.push(...exact)
  if (!chosen.length) return { text: src, changes: [] }
  chosen.sort((a, b) => a.i - b.i)
  let out = ''
  let at = 0
  const changes = []
  for (const c of chosen) {
    const start = tokens[c.i].start
    const end = tokens[c.i + c.len - 1].end
    const from = src.slice(start, end)
    out += src.slice(at, start) + c.word
    at = end
    changes.push({ from, to: c.word })
  }
  out += src.slice(at)
  return { text: out, changes }
}
