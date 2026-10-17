// src/ai/helpIndex.js
//
// Pepper's help answers (how_do_i, tools/general.js): a search over the Help
// page's own text, so "how do I set up tip pots?" gets the steps as written
// for staff and a link to them. The text is read from the Help page's source
// (admin/src/pages/Help.jsx, checked out next to the API on every server),
// cut into passages at each H2 and H3, turned into plain text, and ranked
// with BM25 (passage headings count three times). No database, no
// embeddings: the guide is small, and it changes with each deploy, which
// rebuilds the index (it is built on first use and again when the file
// changes).
//
//   searchHelp(question, { limit })  [{ section, heading, text, link, score }]
//   helpPassages()                   every passage (tests)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { helpSlug } from '../../../shared/help.js'

const HELP_FILE = process.env.HELP_SOURCE_FILE ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../admin/src/pages/Help.jsx')

const STOP = new Set(('a an and are as at be but by can do does for from how i if in into is it its me my of on ' +
  'or our so that the their then there this to up we what when where which who why will with you your ' +
  'get set use make see want need way').split(' '))

const ENTITIES = { '&apos;': "'", '&quot;': '"', '&amp;': '&', '&gt;': '>', '&lt;': '<', '&nbsp;': ' ', '&rarr;': '→', '&larr;': '←', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…' }
const decode = s => s.replace(/&[a-z]+;/g, e => ENTITIES[e] ?? ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

// A JS string literal in the source ('...' or "..."), unescaped.
const STRING = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g
const unescape = s => s.replace(/\\(.)/g, '$1')

/** A table's rows as lines of text: "Templates: Edit the subject ...". */
function tableText(src) {
  const rows = []
  const rowsAt = src.indexOf('rows={[')
  if (rowsAt === -1) return ''
  // Each row is [ 'cell', 'cell', ... ] inside rows={[ ... ]}.
  const body = src.slice(rowsAt + 7)
  for (const m of body.matchAll(/\[((?:\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,?)+)\s*\]/g)) {
    const cells = [...m[1].matchAll(STRING)].map(x => unescape(x[1] ?? x[2]))
    if (cells.length) rows.push(cells[0] + ': ' + cells.slice(1).join(' — '))
  }
  return rows.join('\n')
}

/** A passage's JSX source as plain text. */
export function jsxText(src) {
  let s = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  // Tables: their rows' text in place of the component.
  s = s.replace(/<DataTable[\s\S]*?\/>/g, t => '\u0001' + tableText(t).replace(/\n/g, '\u0001') + '\u0001')
  s = s.replace(/\{\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*\}/g, (_, q, t) => unescape(t))
  // Line breaks in JSX text join lines with a space; paragraphs, list
  // items and table rows are what start a new line.
  s = s.replace(/[ \t]*\n[ \t]*/g, ' ')
  s = s.replace(/<li[^>]*>/g, '\n- ').replace(/<\/(P|p|li|H3|H2|div|InfoBox|ol|ul)>/g, '\n').replace(/\u0001/g, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/[{}]/g, ' ')
  s = decode(s)
  return s.split('\n').map(l => l.replace(/\s+/g, ' ').replace(/ ([.,;:!?)])/g, '$1').trim()).filter(Boolean).join('\n')
}

function tokens(text) {
  return String(text).toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/)
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}

let cache = null   // { mtimeMs, passages, df, avgLen }

function build() {
  let stat
  try { stat = fs.statSync(HELP_FILE) } catch { return null }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache
  const src = fs.readFileSync(HELP_FILE, 'utf8')
  const passages = []
  const slugCount = new Map()
  for (const sec of src.matchAll(/<section id="([^"]+)" data-help="">([\s\S]*?)<\/section>/g)) {
    const [, sectionId, body] = sec
    const h2 = jsxText((body.match(/<H2>([\s\S]*?)<\/H2>/) || [])[1] || sectionId)
    // Split at each H3: the part before the first one belongs to the H2.
    const parts = body.split(/(?=<H3[^>]*>)/)
    for (const part of parts) {
      const h3m = part.match(/^<H3[^>]*>([\s\S]*?)<\/H3>/)
      const heading = h3m ? jsxText(h3m[1]) : h2
      const text = jsxText(h3m ? part.slice(h3m[0].length) : part.replace(/<H2>[\s\S]*?<\/H2>/, ''))
      if (!text) continue
      const slug = h3m ? helpSlug(heading) : null
      if (slug) slugCount.set(slug, (slugCount.get(slug) || 0) + 1)
      passages.push({ sectionId, section: h2, heading, slug, text })
    }
  }
  const df = new Map()
  let total = 0
  for (const p of passages) {
    p.terms = new Map()
    const add = (t, w) => p.terms.set(t, (p.terms.get(t) || 0) + w)
    for (const t of tokens(p.text)) add(t, 1)
    for (const t of tokens(p.heading + ' ' + p.section)) add(t, 3)
    p.len = [...p.terms.values()].reduce((a, b) => a + b, 0)
    total += p.len
    for (const t of p.terms.keys()) df.set(t, (df.get(t) || 0) + 1)
    // Link to the subsection when its heading is unique on the page, else its section.
    p.link = '/help#' + (p.slug && slugCount.get(p.slug) === 1 ? p.slug : p.sectionId)
  }
  cache = { mtimeMs: stat.mtimeMs, passages, df, avgLen: total / Math.max(1, passages.length) }
  return cache
}

export function helpPassages() {
  return build()?.passages || []
}

/** The help passages that best answer a question, best first. */
export function searchHelp(question, { limit = 3, maxChars = 1800 } = {}) {
  const idx = build()
  if (!idx) return null
  const q = [...new Set(tokens(question))]
  if (!q.length) return []
  // The Pepper section tells how to do each job by chat; for a question
  // about the app itself the page's own section should come first.
  const aboutPepper = /\b(pepper|chat|ai|assistant|connector|token|mcp|claude)\b/i.test(question)
  const N = idx.passages.length, k1 = 1.2, b = 0.75
  const scored = idx.passages.map(p => {
    let score = 0
    for (const t of q) {
      const tf = p.terms.get(t)
      if (!tf) continue
      const idf = Math.log(1 + (N - idx.df.get(t) + 0.5) / (idx.df.get(t) + 0.5))
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * p.len / idx.avgLen))
    }
    if (p.sectionId === 'ai-assistant' && !aboutPepper) score *= 0.6
    return { p, score }
  }).filter(x => x.score > 0).sort((a, b2) => b2.score - a.score)
  return scored.slice(0, limit).map(({ p, score }) => ({
    section: p.section,
    heading: p.heading,
    text: p.text.length > maxChars ? p.text.slice(0, maxChars).replace(/\s+\S*$/, '') + ' …' : p.text,
    link: p.link,
    score: Math.round(score * 100) / 100,
  }))
}
