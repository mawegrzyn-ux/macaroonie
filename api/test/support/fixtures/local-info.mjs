// Local info (migration 240): captures, a typed-in event, findings, a flag,
// merged findings and a bulk delete's dry run.
import { sql } from '../app.mjs'

export const order = 100

export async function fill(ctx) {
  const { V, mark, tenantId, ids, step, post, put } = ctx
  // A capture (disabled, so no sweep ever calls Open-Meteo from another test
  // file) and a typed-in event.
  const liSource = await step('local info source', () => post(`/api/local-info/venues/${V}/sources`, { kind: 'weather', place: mark + ' Ware', enabled: false }))
  await step('local info event', () => post('/api/local-info/items', { venue_id: V, title: mark + ' street fair', starts_on: '2027-01-15', severity: 'notice' }))
  // What a capture found (written here: findings only come from runs) and a
  // flag on it with a note saying why (migrations 248, 252), so the sweep
  // tries the flag as the other tenant.
  const found = liSource?.source && await step('local info finding', async () => (await sql`
    INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, external_key)
    VALUES (${tenantId}, ${V}, ${liSource.source.id}, 'weather', ${mark + ' sunny spell'}, '2027-01-16', 'info', 'weather:2027-01-16')
    RETURNING id`)[0])
  if (found) {
    ids.localInfoItem = found.id
    await step('local info flag', () => put('/api/local-info/items/' + found.id + '/feedback', { relevant: true, note: mark + ' beer garden weather' }))
  }
  // A bulk delete's dry run (14 Nov 2026: from today on, nothing written), so
  // the sweep sends it again with another group's capture and venue.
  if (liSource?.source) {
    await step('local info bulk delete check', () => post('/api/local-info/items/delete', { source_id: liSource.source.id, venue_id: V, dry_run: true }))
  }
  // The same event found three times and put into one entry (migration 249:
  // written here, merging only happens after a run), then one report taken
  // out again (Not the same), so the sweep tries that as the other tenant.
  const liEvents = await step('local info events capture', () => post(`/api/local-info/venues/${V}/sources`, { kind: 'events', place: mark + ' Ware', enabled: false, learn_auto: false }))
  const merged = liEvents?.source && await step('local info merged findings', async () => {
    const S = liEvents.source.id
    const [e] = await sql`
      INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, external_key, merge_checked_at)
      VALUES (${tenantId}, ${V}, ${S}, 'events', ${mark + ' carnival'}, '2027-01-17', 'notice', 'events:carnival', now())
      RETURNING id`
    const copies = await sql`
      INSERT INTO local_info_items (tenant_id, venue_id, source_id, kind, title, starts_on, severity, external_key, merge_checked_at, merged_into)
      VALUES (${tenantId}, ${V}, ${S}, 'events', ${mark + ' carnival parade'}, '2027-01-17', 'info', 'events:parade', now(), ${e.id}),
             (${tenantId}, ${V}, ${S}, 'events', ${mark + ' carnival day'}, '2027-01-17', 'info', 'events:day', now(), ${e.id})
      RETURNING id`
    return copies.map(r => r.id)
  })
  if (merged) await step('local info not the same', () => post('/api/local-info/items/' + merged[1] + '/separate'))
}
