// src/ai/tools/localInfo.js
//
// Local information around the venues (migration 240) for Pepper (staff
// assistant and staff MCP). Permissions are the page's:
//
//   local_info          weather, traffic, events and incidents on the days
//                       asked, for one venue or the whole group              local_info, view
//   add_local_event     an event typed in (one venue, or every venue)        local_info, manage
//   run_local_capture   run a venue's captures of one kind now               local_info, manage
//   delete_local_info   delete entries in bulk from today on, by criteria    local_info, manage
//
// Reads and writes go through the admin routes (callApi). Analysis ("how
// does next week look?") is the model reading local_info together with the
// bookings and rota tools; there is no separate analysis endpoint.

import { z } from 'zod'
import { ToolError, callApi, requireStaffPermission } from '../context.js'
import { plural, audited, venueFor, venueToday, VenueText, tenantVenueList, pickByName } from './util.js'
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
    // Staff's own flags on what a capture found (migration 248).
    ...(it.feedback && (it.feedback.relevant || it.feedback.not_relevant)
      ? { staff_flags: {
        relevant: it.feedback.relevant, not_relevant: it.feedback.not_relevant,
        // Why, in the words staff left with their flags (migration 252).
        ...(it.feedback.notes?.length ? {
          notes: it.feedback.notes.slice(0, 5).map(n => (n.relevant ? 'Relevant: ' : 'Not relevant: ') + n.note + (n.by ? ' (' + n.by + ')' : '')),
        } : {}),
      } } : {}),
    // The same event found under other names, put into this entry (migration 249).
    ...(it.also?.length ? {
      also_reported_as: it.also.slice(0, 5).map(a => ({
        title: a.title, day: a.starts_on + (a.ends_on ? ' to ' + a.ends_on : ''), ...(a.url ? { url: a.url } : {}),
      })),
    } : {}),
  }
}

/** A capture in a line, with what Pepper learned from its flags (migration 248). */
function captureView(s) {
  const learned = s.learn_auto !== false && s.learned && (s.learned.look_for?.length || s.learned.leave_out?.length)
    ? ' · learned from flags: ' + [
      s.learned.look_for?.length ? 'look for ' + s.learned.look_for.join('; ') : null,
      s.learned.leave_out?.length ? 'leave out ' + s.learned.leave_out.join('; ') : null,
    ].filter(Boolean).join(', ')
    : ''
  return KIND_LABELS[s.kind] + ' (' + frequencyText(s).toLowerCase() + (s.enabled ? '' : ', off') + ')' + learned
    + (s.merge_error ? ' · couldn\'t put the same events together after its last run: ' + s.merge_error : '')
}

/** A capture in words, as the Captures list shows it (for picking one by name). */
const captureName = (s, venueName) => KIND_LABELS[s.kind] + ': ' + s.place
  + (s.site ? ' on ' + s.site : '') + (s.query ? ' (' + s.query + ')' : '') + (venueName ? ' at ' + venueName : '')

/** The capture named (or pinned by id), among one venue's captures or every venue's. */
async function captureFor(ctx, venue, input) {
  const venues = venue ? [venue] : await tenantVenueList(ctx)
  const all = []
  for (const v of venues) {
    const { sources } = await callApi(ctx, 'GET', '/api/local-info/venues/' + v.id + '/sources')
    for (const s of sources) all.push({ ...s, venue_name: v.name })
  }
  if (input.source_id) {
    const pinned = all.find(s => s.id === input.source_id)
    if (!pinned) throw new ToolError('That capture is gone. The Local info page has the list.', 404)
    return pinned
  }
  return pickByName(all, input.capture, s => captureName(s, venue ? null : s.venue_name), 'capture',
    'There are no captures set up: they are set up on the Local info page (/local-info).')
}

/** What delete_local_info sends, worked out the same way for the card and the run. */
async function deletePlan(ctx, input) {
  await requireStaffPermission(ctx, 'local_info', 'manage')
  const venue = input.venue ? await venueFor(ctx, input.venue) : null
  if (venue && input.group_wide) throw new ToolError('Pick one venue or the whole group, not both.', 422)
  const source = input.source_id || input.capture ? await captureFor(ctx, venue, input) : null
  return {
    venue, source,
    body: {
      ...(input.from ? { from: input.from } : {}),
      until: input.until ?? null,
      venue_id: venue ? venue.id : null,
      ...(input.group_wide ? { group_wide: true } : {}),
      source_id: source ? source.id : null,
      origin: input.origin || 'any',
      ...(input.kinds?.length ? { kinds: input.kinds } : {}),
      ...(input.severities?.length ? { severities: input.severities } : {}),
      ...(input.words ? { words: input.words } : {}),
    },
  }
}

/** Which entries a plan covers, in words. */
function deleteScope(plan, input, out) {
  const where = plan.source ? 'What the capture ' + captureName(plan.source, plan.venue ? null : plan.source.venue_name) + ' found'
    : plan.venue ? 'Entries for ' + plan.venue.name + ' (not the whole group\'s)'
    : input.group_wide ? 'Entries for the whole group'
    : 'Entries at every venue and for the whole group'
  const which = [
    input.origin === 'typed' ? 'typed in by staff' : input.origin === 'captured' ? 'found by captures' : null,
    input.kinds?.length ? 'of kind ' + input.kinds.map(k => KIND_LABELS[k].toLowerCase()).join(' or ') : null,
    input.severities?.length ? 'marked ' + input.severities.join(' or ') : null,
    input.words ? 'mentioning "' + input.words + '"' : null,
  ].filter(Boolean)
  return where + (which.length ? ', ' + which.join(', ') : '') + ', starting ' + out.from
    + (out.until ? ' to ' + out.until : ' or later') + '.'
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
          captures: sources.map(captureView),
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

  {
    name: 'delete_local_info',
    section: 'local_info',
    title: 'Delete local info in bulk',
    description:
      'Deletes entries from the Local info calendar from today on (never past days) that match everything given: one ' +
      'venue’s own entries or only the whole group’s (leave both out for all of them), what one capture found, typed-in ' +
      'events or captured findings only, kinds, severities, words in the title, details or place, and the days (from: ' +
      'leave out for today; until: leave out for no end). An entry counts by the day it starts. A finding someone hid ' +
      'is kept (it stops its capture adding it again), and one people flagged as relevant or not is hidden instead, so ' +
      'Pepper keeps learning from the flags. The card says how many and shows some; a later run of a capture can find ' +
      'some of them again.',
    input: z.object({
      venue: VenueText.optional().describe('One venue’s own entries; leave out for every venue'),
      group_wide: z.boolean().optional().describe('true: only entries for the whole group, not one venue'),
      capture: z.string().trim().max(200).optional()
        .describe('What one capture found: its kind, place, site or words as on the Captures list'),
      origin: z.enum(['any', 'typed', 'captured']).default('any')
        .describe('typed: events staff typed in; captured: what captures found'),
      kinds: z.array(z.enum(KINDS)).max(KINDS.length).optional(),
      severities: z.array(z.enum(SEVERITIES)).max(SEVERITIES.length).optional(),
      words: z.string().trim().max(100).optional().describe('Text in the title, details or place'),
      from: DAY.optional().describe('First day; leave out for today'),
      until: DAY.optional().describe('Last day; leave out for no end'),
      source_id: z.string().uuid().optional().describe('Leave out: the card pins it'),
    }),
    confirm: true,
    async describe(ctx, input) {
      const plan = await deletePlan(ctx, input)
      const out = await callApi(ctx, 'POST', '/api/local-info/items/delete', { body: { ...plan.body, dry_run: true } })
      const n = out.deleted + out.hidden
      if (!n) {
        throw new ToolError('Nothing on the calendar matches that, starting ' + out.from + (out.until ? ' to ' + out.until : ' or later')
          + (out.kept ? ' (only ' + plural(out.kept, 'finding') + ' someone hid, which ' + (out.kept === 1 ? 'stays as it is' : 'stay as they are') + ')' : '') + '.', 404)
      }
      const venues = await tenantVenueList(ctx)
      const names = Object.fromEntries(venues.map(v => [v.id, v.name]))
      const example = it => it.starts_on + ' ' + it.title + ' (' + (it.venue_id ? names[it.venue_id] || 'a venue' : 'every venue')
        + (it.action === 'hide' ? ', hidden instead' : '') + ')'
      return {
        title: 'Delete ' + plural(n, 'local info entry', 'local info entries') + '?',
        lines: [
          deleteScope(plan, input, out),
          ...(out.deleted ? [plural(out.deleted, 'entry', 'entries') + ' will be deleted.'] : []),
          ...(out.hidden ? [plural(out.hidden, 'finding') + ' people flagged will be hidden instead, so Pepper keeps learning from the flags.'] : []),
          ...(out.kept ? [plural(out.kept, 'finding') + ' someone hid ' + (out.kept === 1 ? 'stays as it is.' : 'stay as they are.')] : []),
          ...(out.handed_over ? [plural(out.handed_over, 'entry', 'entries') + (out.handed_over === 1 ? ' was' : ' were')
            + ' also found by another capture: ' + (out.handed_over === 1 ? 'that report stays' : 'those reports stay')
            + ' on the calendar instead.'] : []),
          (n > out.examples.length ? 'The first ' + out.examples.length + ': ' : '') + out.examples.map(example).join('; ') + '.',
          ...(out.examples.some(it => it.captured) ? ['A later run of a capture can find some of them again.'] : []),
        ],
        confirmLabel: 'Delete them',
        pin: { from: out.from, venue: plan.venue ? plan.venue.id : undefined, source_id: plan.source ? plan.source.id : undefined },
      }
    },
    async run(ctx, input) {
      const plan = await deletePlan(ctx, input)
      return audited(ctx, 'delete_local_info', {
        venue: plan.venue?.name ?? (input.group_wide ? 'the whole group' : 'every venue'),
        ...(plan.source ? { capture: captureName(plan.source) } : {}),
        from: input.from ?? 'today', until: input.until ?? null,
      }, async () => {
        const out = await callApi(ctx, 'POST', '/api/local-info/items/delete', { body: { ...plan.body, dry_run: false } })
        const days = out.from + (out.until ? ' to ' + out.until : ' on')
        if (!out.deleted && !out.hidden) {
          return { deleted: 0, days, message: 'Nothing on the calendar matched, so nothing changed.' }
        }
        return {
          deleted: out.deleted, ...(out.hidden ? { hidden_instead: out.hidden } : {}), ...(out.kept ? { kept_hidden: out.kept } : {}),
          days, message: 'Off the Local info calendar.' + (out.hidden ? ' Flagged findings were hidden, so Pepper keeps learning from them.' : ''),
        }
      })
    },
  },
]
