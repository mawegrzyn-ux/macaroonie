// src/ai/tools/localInfo.js
//
// Local information around the venues (migration 240) for Pepper (staff
// assistant and staff MCP). Permissions are the page's:
//
//   local_info          weather, traffic, events and incidents on the days
//                       asked, for one venue or the whole group              local_info, view
//   add_local_event     an event typed in (one venue, or every venue)        local_info, manage
//   run_local_capture   run a venue's captures of one kind now               local_info, manage
//
// Reads and writes go through the admin routes (callApi). Analysis ("how
// does next week look?") is the model reading local_info together with the
// bookings and rota tools; there is no separate analysis endpoint.

import { z } from 'zod'
import { ToolError, callApi, requireStaffPermission } from '../context.js'
import { plural, audited, venueFor, venueToday, VenueText, tenantVenueList } from './util.js'
import { KINDS, KIND_LABELS, SEVERITIES, frequencyText, addDays } from '../../../../shared/localInfo.js'

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD')

function itemView(it, venueNames) {
  return {
    ...(it.venue_id ? { venue: venueNames[it.venue_id] || 'a venue' } : { venue: 'every venue' }),
    kind: KIND_LABELS[it.kind] || it.kind,
    title: it.title,
    ...(it.details ? { details: it.details } : {}),
    day: it.starts_on + (it.ends_on ? ' to ' + it.ends_on : ''),
    ...(it.time_text ? { time: it.time_text } : {}),
    ...(it.severity !== 'info' ? { severity: it.severity } : {}),
    ...(it.place ? { place: it.place } : {}),
    ...(it.url ? { url: it.url } : {}),
    ...(it.source_id ? {} : { typed_in: true }),
  }
}

export const localInfoTools = [
  {
    name: 'local_info',
    section: 'local_info',
    title: 'Local info: weather, traffic, events, incidents',
    description:
      'What’s happening around a venue (or the whole group) on the days asked: the captured weather forecast, ' +
      'road closures and traffic, local events and incidents, plus events staff typed in — from the Local info page ' +
      '(/local-info), where captures are set up. Days default to today up to two weeks ahead; ask for past days for a ' +
      'retrospective. Use it with the bookings and rota tools to weigh a day up (a big event + a thin rota, rain on a ' +
      'busy Saturday).',
    input: z.object({
      venue: VenueText.optional().describe('Leave out for every venue of the group'),
      from: DAY.optional(),
      to: DAY.optional(),
      kind: z.enum(KINDS).optional().describe('One kind only; leave out for all of them'),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'local_info', 'view')
      const venue = input.venue ? await venueFor(ctx, input.venue) : null
      const today = venue ? venueToday(venue) : new Date().toISOString().slice(0, 10)
      const from = input.from || today
      const to = input.to || addDays(from, 14)
      const q = ['from=' + from, 'to=' + to]
      if (venue) q.push('venue_id=' + venue.id)
      if (input.kind) q.push('kinds=' + input.kind)
      const out = await callApi(ctx, 'GET', '/api/local-info/items?' + q.join('&'))
      const venues = await tenantVenueList(ctx)
      const venueNames = Object.fromEntries(venues.map(v => [v.id, v.name]))
      const sources = venue ? (await callApi(ctx, 'GET', '/api/local-info/venues/' + venue.id + '/sources')).sources : null
      return {
        ...(venue ? { venue: venue.name } : { venues: 'the whole group' }),
        days: from + ' to ' + to,
        ...(out.items.length ? { items: out.items.map(it => itemView(it, venueNames)) }
          : { items: 'nothing held for those days' }),
        ...(sources && !sources.length ? {
          note: 'This venue has no captures set up yet: only typed-in events can show. Captures are set up on the Local info page (/local-info).',
        } : {}),
        ...(sources?.length ? {
          captures: sources.map(s => KIND_LABELS[s.kind] + ' (' + frequencyText(s).toLowerCase() + (s.enabled ? '' : ', off') + ')'),
        } : {}),
      }
    },
  },

  {
    name: 'add_local_event',
    section: 'local_info',
    title: 'Add a local event',
    description:
      'Puts an event on the Local info calendar: a festival, market, match, road closure or anything else staff should ' +
      'plan around. One venue, or the whole group (leave the venue out). Dates are YYYY-MM-DD; a multi-day event takes ' +
      'ends_on. severity "warning" for something that will materially affect trade, "notice" for worth knowing, else "info".',
    input: z.object({
      venue: VenueText.optional().describe('Leave out for an event at every venue'),
      kind: z.enum(KINDS).default('events'),
      title: z.string().trim().min(1).max(200),
      details: z.string().trim().max(1000).optional(),
      place: z.string().trim().max(200).optional(),
      starts_on: DAY,
      ends_on: DAY.optional(),
      time_text: z.string().trim().max(40).optional().describe('The time in words, e.g. "19:00" or "all day"'),
      severity: z.enum(SEVERITIES).default('info'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'local_info', 'manage')
      const venue = input.venue ? await venueFor(ctx, input.venue) : null
      return {
        title: 'Add "' + input.title + '" to Local info?',
        lines: [
          (venue ? 'At ' + venue.name : 'At every venue') + ', ' + input.starts_on
            + (input.ends_on ? ' to ' + input.ends_on : '') + (input.time_text ? ', ' + input.time_text : '') + '.',
          ...(input.details ? [input.details] : []),
        ],
        confirmLabel: 'Add it',
        pin: { venue: venue ? venue.id : undefined },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'local_info', 'manage')
      const venue = input.venue ? await venueFor(ctx, input.venue) : null
      return audited(ctx, 'add_local_event', { venue: venue?.name ?? 'every venue', title: input.title, starts_on: input.starts_on }, async () => {
        await callApi(ctx, 'POST', '/api/local-info/items', { body: {
          venue_id: venue ? venue.id : null, kind: input.kind, title: input.title,
          details: input.details ?? null, place: input.place ?? null,
          starts_on: input.starts_on, ends_on: input.ends_on ?? null,
          time_text: input.time_text ?? null, severity: input.severity,
        } })
        return { added: input.title, on: input.starts_on + (input.ends_on ? ' to ' + input.ends_on : ''),
          at: venue?.name ?? 'every venue', message: 'On the Local info calendar.' }
      })
    },
  },

  {
    name: 'run_local_capture',
    section: 'local_info',
    title: 'Run a local info capture now',
    description:
      'Runs a venue’s Local info captures of one kind (weather, traffic, events or incidents) now, outside their ' +
      'schedule — a fresh forecast or search on demand. The capture runs in the background: read local_info again a ' +
      'minute later for what it found. Captures themselves are set up on the Local info page.',
    input: z.object({
      venue: VenueText,
      kind: z.enum(KINDS),
      source_ids: z.array(z.string().uuid()).optional().describe('Leave out: the card pins them'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'local_info', 'manage')
      const venue = await venueFor(ctx, input.venue)
      const { sources } = await callApi(ctx, 'GET', '/api/local-info/venues/' + venue.id + '/sources')
      const mine = sources.filter(s => s.kind === input.kind)
      if (!mine.length) {
        throw new ToolError(venue.name + ' has no ' + KIND_LABELS[input.kind].toLowerCase()
          + ' capture set up. Add one on the Local info page (/local-info).', 404)
      }
      return {
        title: 'Run the ' + KIND_LABELS[input.kind].toLowerCase() + ' capture for ' + venue.name + ' now?',
        lines: [plural(mine.length, 'capture') + ': ' + mine.map(s => '"' + s.place + '"' + (s.site ? ' on ' + s.site : '')).join('; ') + '.'],
        confirmLabel: 'Run it',
        pin: { venue: venue.id, source_ids: mine.map(s => s.id) },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'local_info', 'manage')
      const venue = await venueFor(ctx, input.venue)
      const { sources } = await callApi(ctx, 'GET', '/api/local-info/venues/' + venue.id + '/sources')
      const wanted = input.source_ids?.length ? sources.filter(s => input.source_ids.includes(s.id))
        : sources.filter(s => s.kind === input.kind)
      if (!wanted.length) throw new ToolError('That capture is gone. The Local info page has the list.', 404)
      return audited(ctx, 'run_local_capture', { venue: venue.name, kind: input.kind }, async () => {
        const started = [], busy = []
        for (const s of wanted) {
          try {
            await callApi(ctx, 'POST', '/api/local-info/sources/' + s.id + '/run')
            started.push(s.place)
          } catch (err) {
            if (err?.status === 409) busy.push(s.place)
            else throw err
          }
        }
        return {
          ...(started.length ? { started: started } : {}),
          ...(busy.length ? { already_running: busy } : {}),
          message: 'Running in the background — read local_info again in a minute for what it found.',
        }
      })
    },
  },
]
