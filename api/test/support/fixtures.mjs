// A tenant's data in every area, made through the API as its owner (so the
// rows are what the pages would make). The cross-tenant sweep calls every
// route with these ids as another tenant. Each step that fails is listed in
// the result instead of stopping the rest; the sweep reports them.
//
// Each area's steps are in fixtures/<area>.mjs (the areas of
// docs/claude/areas), which exports:
//   order          when its fill() runs: areas run by order (spaced by 10, so a
//                  new area slots in), ties by file name
//   fill(ctx)      its steps (fixtures/parts.mjs says what ctx holds); what a
//                  later area needs goes in ctx.made, the ids callers read in ctx.ids
//   lateOrder, fillLate(ctx)   optional: a second part that runs later, for
//                  steps that must come after another area's
//   kinds          optional: the tenant sweep's id kinds for its tables, each
//                  named route parameter mapped to the tables its ids come
//                  from (gathered into KINDS below)
// Every .mjs file in the folder but parts.mjs (the shared helpers) is an area.
import fs from 'node:fs'
import { newContext } from './fixtures/parts.mjs'

export const MARK = 'Zqx'   // in names and notes, so a leak is easy to spot

const DIR = new URL('./fixtures/', import.meta.url)
const HELPERS = new Set(['parts.mjs'])

const AREAS = await Promise.all(fs.readdirSync(DIR)
  .filter(f => f.endsWith('.mjs') && !HELPERS.has(f))
  .sort()
  .map(async f => {
    const m = await import(new URL(f, DIR))
    const name = f.slice(0, -'.mjs'.length)
    if (typeof m.order !== 'number' || typeof m.fill !== 'function') throw new Error(`fixtures/${f} must export order (a number) and fill(ctx)`)
    if (m.fillLate && typeof m.lateOrder !== 'number') throw new Error(`fixtures/${f} exports fillLate without lateOrder`)
    return { name, ...m }
  }))

const byOrder = (a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/** Every area's parts, in the order they run. */
export const PARTS = AREAS.flatMap(a => [
  { name: a.name, order: a.order, fill: a.fill },
  ...(a.fillLate ? [{ name: a.name + ' (late)', order: a.lateOrder, fill: a.fillLate }] : []),
]).sort(byOrder)

/** The tenant sweep's id kinds: each named id parameter in a route and the
 *  tables its ids come from, gathered from the areas in their order. */
export const KINDS = {}
for (const a of [...AREAS].sort(byOrder)) {
  for (const [param, tables] of Object.entries(a.kinds || {})) (KINDS[param] ||= []).push(...tables)
}

export async function fillTenant(sub, tenantId, { mark = MARK, slug = 'zqx', loyalty: withLoyalty = true, reports: withReports = true } = {}) {
  const ctx = newContext(sub, tenantId, { mark, slug, loyalty: withLoyalty, reports: withReports })
  for (const part of PARTS) {
    await part.fill(ctx)
    // Without the first venue (core.mjs) nothing else is made.
    if (!ctx.V) break
  }
  return { ids: ctx.ids, failed: ctx.failed, writes: ctx.writes }
}
