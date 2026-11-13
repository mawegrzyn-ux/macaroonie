// shared/reports/paths.js
//
// Finding a field in the data catalogue (docs/REPORTS.md 5): a path is a
// chain of links ending in a field, a measure or a link:
//
//   'name'                 a field of the report's own subject
//   'check.number'         a field of the check a line belongs to
//   'check.server.name'    two links on
//   'net_sales'            a measure
//   'lines.qty'            a measure of the lines a check has (a "many" link)
//   'venue'                the linked thing itself, by its id (for filters)
//
// One walker for the API (which adds the SQL) and the admin (the field
// list, labels). `catalogue.subjects[key]` has `fields`, `measures` and
// `links`, each an object by key; a link says `to` (a subject) and `many`.

import { BUCKET_LABELS, DATE_BUCKETS, MOMENT_BUCKETS } from './format.js'

export const MAX_HOPS = 4

const lowerFirst = s => (s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

/**
 * { ok, kind: 'field' | 'measure' | 'link', def, subject, hops, many } for a
 * path from a subject, or { ok: false, why } with a sentence saying what
 * isn't there.
 */
export function resolvePath(catalogue, subjectKey, path) {
  const root = catalogue?.subjects?.[subjectKey]
  if (!root) return { ok: false, why: 'There is nothing to report on called "' + subjectKey + '"' }
  const parts = String(path || '').split('.')
  if (!parts[0]) return { ok: false, why: 'A field is missing its name' }
  if (parts.length > MAX_HOPS + 1) return { ok: false, why: '"' + path + '" goes through too many links (' + MAX_HOPS + ' at most)' }
  let subject = root
  const hops = []
  for (let i = 0; i < parts.length - 1; i++) {
    const link = subject.links?.[parts[i]]
    if (!link) return { ok: false, why: subject.label + ' has no link called "' + parts[i] + '"' }
    const next = catalogue.subjects[link.to]
    if (!next) return { ok: false, why: '"' + parts.slice(0, i + 1).join('.') + '" can\'t be reached' }
    hops.push({ key: parts[i], link, from: subject.key, to: next.key })
    subject = next
  }
  const last = parts[parts.length - 1]
  const many = hops.some(h => h.link.many)
  if (subject.fields?.[last]) return { ok: true, kind: 'field', def: subject.fields[last], subject, hops, many, key: last }
  if (subject.measures?.[last]) return { ok: true, kind: 'measure', def: subject.measures[last], subject, hops, many, key: last }
  if (subject.links?.[last]) {
    const link = subject.links[last]
    return { ok: true, kind: 'link', def: link, subject, hops, many: many || !!link.many, key: last }
  }
  return { ok: false, why: subject.label + ' has nothing called "' + last + '"' }
}

/**
 * What a path is called as a column heading. A field of the report's own
 * subject keeps its name; one reached through links takes the last link's
 * name in front ("Server name"), the linked thing's naming field is just
 * the link ("Server", "Section"), and a figure of linked rows names the
 * link after itself ("Taken (payments)").
 */
export function pathLabel(catalogue, subjectKey, path, bucket = null) {
  const r = resolvePath(catalogue, subjectKey, path)
  if (!r.ok) return path
  let label
  if (r.kind === 'link') label = r.def.label
  else if (!r.hops.length) label = r.def.title || r.def.label
  else {
    const via = r.hops[r.hops.length - 1].link.label
    // A figure of the rows a link leads to says whose it is after its name: "Taken (payments)".
    if (r.kind === 'measure') label = r.def.label + ' (' + lowerFirst(via) + ')'
    else if (r.kind === 'field' && r.subject.name === r.key) label = via
    else if (r.def.label.toLowerCase().startsWith(via.toLowerCase())) label = r.def.label
    else label = via + ' ' + lowerFirst(r.def.label)
  }
  if (bucket && bucket !== 'day' && BUCKET_LABELS[bucket]) {
    const name = BUCKET_LABELS[bucket]
    // A subject's own day by week is "Week" ("Trading day" too), and a day
    // that says which ("Day paid") keeps its words: "Week paid". Anything
    // else says both: "Sent (hour)".
    if (r.kind === 'field' && r.key === 'date' && !r.hops.length) {
      const which = /^Day (.+)$/.exec(label)
      return which ? name + ' ' + which[1] : name
    }
    return label + ' (' + name.toLowerCase() + ')'
  }
  return label
}

/** How a field of this type can be grouped: buckets for days and moments, nothing for the rest. */
export function bucketsFor(type) {
  if (type === 'date') return DATE_BUCKETS
  if (type === 'moment') return MOMENT_BUCKETS
  return []
}

/** The type a grouped field comes out as: a weekday or an hour is a number, a week or month a day. */
export function bucketType(type, bucket) {
  if (!bucket || !bucketsFor(type).includes(bucket)) return type
  if (bucket === 'weekday' || bucket === 'hour') return 'number'
  return 'date'
}

/**
 * Every field a person can pick from a subject, as { path, label, type,
 * group } rows: its own fields first, then each linked thing's, one link at
 * a time down to `depth` links ("many" links aren't walked: their rows
 * would repeat this subject's).
 */
export function fieldChoices(catalogue, subjectKey, { depth = 2 } = {}) {
  const out = []
  const seen = new Set()
  const walk = (key, prefix, group, left, trail) => {
    const s = catalogue.subjects[key]
    if (!s) return
    for (const [k, f] of Object.entries(s.fields || {})) {
      const path = prefix + k
      if (seen.has(path)) continue
      seen.add(path)
      out.push({ path, label: pathLabel(catalogue, subjectKey, path), type: f.type, group, field: f })
    }
    if (left <= 0) return
    for (const [k, l] of Object.entries(s.links || {})) {
      if (l.many || trail.includes(l.to)) continue
      walk(l.to, prefix + k + '.', group ? group + ' › ' + l.label : l.label, left - 1, [...trail, l.to])
    }
  }
  walk(subjectKey, '', '', depth, [subjectKey])
  return out
}
