// src/ai/tools/locations.js
//
// Opening a new location from Pepper (staff chat and staff MCP), the same
// steps as the New location page (routes/storeOpenings.js, migration 186):
//
//   plan_new_location        start: a description in, the scope and first
//                            questions out (a draft; nothing is created)     venues manage + Pepper
//   answer_location_questions  answers in, the next questions or the brief  venues manage + Pepper
//   change_location_plan     the person's own choices (each area's way, name,
//                            date, address, the location to copy from) and/or
//                            a change for Pepper to make                      venues manage (+ Pepper for a change)
//   location_openings        the openings, or one in full                   venues view
//   create_location          creates the location from the plan (a card)     venues manage
//
// The steps run their own model call (the plan is Pepper's structured
// answer, checked by the server), so these tools only pass words through and
// trim what comes back. Each opening is also on /new-location/<id>.

import { z } from 'zod'
import { ToolError, callApi, requireStaffPermission } from '../context.js'
import { pickByName, audited, plural } from './util.js'
import { AREA_KEYS } from '../../../../shared/storeOpening.js'

const BASE = '/api/ai/store-openings'
const OpeningText = z.string().trim().min(1).max(120).describe('The opening: its title or id (location_openings lists them)')
const WAY = { copy: 'copy', new: 'new', skip: 'later' }
const WAY_IN = { copy: 'copy', new: 'new', later: 'skip', skip: 'skip' }

async function pickOpening(ctx, text) {
  const rows = await callApi(ctx, 'GET', BASE)
  const hit = pickByName(rows, text, r => r.title + (r.venue_name ? ' ' + r.venue_name : ''), 'opening', 'No new locations are being planned yet.')
  return callApi(ctx, 'GET', `${BASE}/${hit.id}`)
}

/** The opening, trimmed for the model. */
function brief(o) {
  const out = {
    opening_id: o.id,
    title: o.title,
    status: o.status,
    link: '/new-location/' + o.id,
    summary: o.summary || undefined,
    location: {
      name: o.plan.venue.name, web_address: o.plan.venue.slug_final, time_zone: o.plan.venue.timezone,
      opening_date: o.plan.opening_date, copying_from: o.template?.name || null,
      address: [o.plan.location.address_line1, o.plan.location.city, o.plan.location.postcode].filter(Boolean).join(', ') || null,
    },
    areas: o.areas.map(a => ({
      area: a.key, label: a.label, way: WAY[a.mode], what: a.preview,
      ...(a.note ? { pepper_note: a.note } : {}),
      ...(!a.can_set_up ? { can_set_up: false } : {}),
      ...(a.result ? { result: a.result.status, done: a.result.lines } : {}),
    })),
  }
  if (o.questions.length) {
    out.questions = o.questions.map(q => ({ id: q.id, area: q.area, question: q.text, ...(q.options.length ? { options: q.options.map(x => x.label) } : {}), ...(q.suggested ? { suggested: q.suggested } : {}) }))
    out.next = 'Ask the person these questions (or answer the ones they already answered), then call answer_location_questions. An empty answer leaves it to the planner.'
  }
  if (o.status === 'ready' && o.brief) {
    out.brief = o.brief
    out.next = 'Show the person the brief and what each area will be. When they are happy, call create_location.'
  }
  if (o.problems?.length) out.problems = o.problems
  if (o.status === 'created') {
    out.created = { venue: o.venue?.name, still_to_do: o.followups.filter(f => !f.done).map(f => f.text) }
  }
  if (o.error) out.error = o.error
  return out
}

const canPlan = async ctx => {
  await requireStaffPermission(ctx, 'venues', 'manage')
}

export const locationTools = [
  {
    name: 'plan_new_location',
    section: 'locations',
    title: 'Plan a new location',
    description:
      'Starts planning a new location (a new store, restaurant or site) for the group from the person\'s description: a planner reads ' +
      'the group\'s locations, decides area by area what to copy from a similar location, set up new or leave for later, and asks ' +
      'the questions that matter. Nothing is created yet. Pass everything the person said. Takes up to a minute. Then ask the ' +
      'person the questions it returns and call answer_location_questions; when the brief is ready, create_location makes it.',
    input: z.object({
      description: z.string().trim().min(10).max(6000).describe('The new location in the person\'s words: where, what it is like, when it opens, how it differs'),
      copy_from: z.string().trim().max(120).optional().describe('A location to copy from, if they named one'),
    }),
    async run(ctx, input) {
      await canPlan(ctx)
      let template = null
      if (input.copy_from) {
        const venues = await callApi(ctx, 'GET', '/api/venues')
        template = pickByName(venues, input.copy_from, v => v.name, 'location')
      }
      const o = await callApi(ctx, 'POST', BASE, { body: { input: input.description, template_venue_id: template?.id || null } })
      return brief(o)
    },
  },

  {
    name: 'answer_location_questions',
    section: 'locations',
    title: 'Answer the new location\'s questions',
    description:
      'Sends the person\'s answers to the questions plan_new_location (or an earlier answer) asked, by question id. An empty answer ' +
      'leaves that one to the planner. Returns the next questions, or the brief when it is ready. Takes up to a minute.',
    input: z.object({
      opening: OpeningText,
      answers: z.array(z.object({
        id: z.string().trim().min(1).max(60).describe('The question id'),
        answer: z.string().max(2000).describe('The answer, or "" to leave it to the planner'),
      })).max(30),
    }),
    async run(ctx, input) {
      await canPlan(ctx)
      const o = await pickOpening(ctx, input.opening)
      if (o.status === 'created') throw new ToolError('This location has already been created.', 422)
      const asked = new Set(o.questions.map(q => q.id))
      const answers = Object.fromEntries(o.questions.map(q => [q.id, '']))
      for (const a of input.answers) {
        if (!asked.has(a.id)) throw new ToolError('There\'s no open question "' + a.id + '". The open ones: ' + ([...asked].join(', ') || 'none') + '.', 422)
        answers[a.id] = a.answer
      }
      return brief(await callApi(ctx, 'POST', `${BASE}/${o.id}/answers`, { body: { answers } }))
    },
  },

  {
    name: 'change_location_plan',
    section: 'locations',
    title: 'Change a new location\'s plan',
    description:
      'Changes a planned location before it is created. Direct changes (they always win over the planner\'s choices): how each ' +
      'area is set up (copy, new or later), the name, web address, time zone, opening date, address and contact details, and the ' +
      'location to copy from. `request` asks the planner for a change in words instead (it re-plans; takes up to a minute), e.g. ' +
      '"30 tables of four, not a copy". `closer_look` asks the planner for more questions about one area.',
    input: z.object({
      opening: OpeningText,
      ways: z.array(z.object({ area: z.enum(AREA_KEYS), way: z.enum(['copy', 'new', 'later']) })).max(AREA_KEYS.length).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      web_address: z.string().trim().regex(/^[a-z0-9-]+$/).max(60).optional(),
      time_zone: z.string().trim().min(1).max(60).optional(),
      opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('none')).optional().describe('YYYY-MM-DD, or "none" to clear it'),
      copy_from: z.string().trim().max(120).optional().describe('A location\'s name, or "none" to set every area up new'),
      address_line1: z.string().trim().max(120).optional(),
      city: z.string().trim().max(80).optional(),
      postcode: z.string().trim().max(20).optional(),
      phone: z.string().trim().max(40).optional(),
      email: z.string().trim().max(120).optional(),
      request: z.string().trim().min(3).max(2000).optional(),
      closer_look: z.enum(AREA_KEYS).optional(),
    }),
    async run(ctx, input) {
      await canPlan(ctx)
      let o = await pickOpening(ctx, input.opening)
      if (o.status === 'created') throw new ToolError('This location has already been created.', 422)
      const overrides = {}
      if (input.ways?.length) overrides.modes = Object.fromEntries(input.ways.map(w => [w.area, WAY_IN[w.way]]))
      const venue = {}
      if (input.name) venue.name = input.name
      if (input.web_address) venue.slug = input.web_address
      if (input.time_zone) venue.timezone = input.time_zone
      if (Object.keys(venue).length) overrides.venue = venue
      const location = {}
      for (const k of ['address_line1', 'city', 'postcode', 'phone', 'email']) if (input[k] !== undefined) location[k] = input[k]
      if (Object.keys(location).length) overrides.location = location
      if (input.opening_date) overrides.opening_date = input.opening_date === 'none' ? null : input.opening_date
      if (input.copy_from) {
        if (/^(none|nothing|no)$/i.test(input.copy_from)) overrides.template_venue_id = null
        else overrides.template_venue_id = pickByName(await callApi(ctx, 'GET', '/api/venues'), input.copy_from, v => v.name, 'location').id
      }
      if (Object.keys(overrides).length) o = await callApi(ctx, 'PATCH', `${BASE}/${o.id}`, { body: { overrides } })
      if (input.closer_look) o = await callApi(ctx, 'POST', `${BASE}/${o.id}/deep-dive`, { body: { area: input.closer_look } })
      if (input.request) o = await callApi(ctx, 'POST', `${BASE}/${o.id}/change`, { body: { request: input.request } })
      if (!Object.keys(overrides).length && !input.closer_look && !input.request) throw new ToolError('Nothing to change: say what to change.', 422)
      return brief(o)
    },
  },

  {
    name: 'location_openings',
    section: 'locations',
    title: 'New locations being planned',
    description: 'Lists the new locations being planned or already created from a plan; with `opening`, one in full: its plan area by area, open questions, brief and what is still to do.',
    input: z.object({ opening: OpeningText.optional() }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'venues', 'view')
      if (input.opening) return brief(await pickOpening(ctx, input.opening))
      const rows = await callApi(ctx, 'GET', BASE)
      return {
        openings: rows.map(r => ({ opening_id: r.id, title: r.title, status: r.status, ...(r.venue_name ? { location: r.venue_name } : {}), updated: String(r.updated_at).slice(0, 10), link: '/new-location/' + r.id })),
        ...(rows.length ? {} : { message: 'None yet: plan_new_location starts one.' }),
      }
    },
  },

  {
    name: 'create_location',
    section: 'locations',
    title: 'Create the new location',
    description:
      'Creates the planned location: the venue and every area as the plan says (copied, set up new, or left for later), in one go. ' +
      'Before the opening date it stays closed for bookings and online ordering stays off. Show the brief first.',
    input: z.object({ opening: OpeningText }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'venues', 'manage')
      const o = await pickOpening(ctx, input.opening)
      if (o.status === 'created') throw new ToolError('This location has already been created.', 422)
      if (o.status === 'draft') throw new ToolError('This one hasn\'t been planned yet.', 422)
      if (o.problems?.length) throw new ToolError(o.problems.join(' '), 422)
      const doing = o.areas.filter(a => a.mode !== 'skip' && a.can_set_up)
      const blocked = o.areas.filter(a => a.mode !== 'skip' && !a.can_set_up)
      const warnings = [
        ...(o.questions.length ? [plural(o.questions.length, 'question is', 'questions are') + ' still open: the planner\'s guesses are used.'] : []),
        ...blocked.map(a => a.label + ': your role can\'t set this up, so it is left for someone who can.'),
      ]
      return {
        title: 'Create ' + o.plan.venue.name + '?',
        lines: [
          (o.template ? 'Copying from ' + o.template.name : 'Set up new') + (o.plan.opening_date ? ', opening ' + o.plan.opening_date + ' (closed for bookings until then)' : ''),
          ...doing.map(a => a.label + ': ' + a.preview),
        ],
        ...(warnings.length ? { warningTitle: 'Check', warnings } : {}),
        confirmLabel: 'Create',
        pin: { opening: o.id },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'venues', 'manage')
      return audited(ctx, 'create_location', input, async () => {
        const found = await pickOpening(ctx, input.opening)
        const o = await callApi(ctx, 'POST', `${BASE}/${found.id}/create`)
        return {
          created: o.venue?.name,
          link: '/new-location/' + o.id,
          areas: Object.fromEntries(Object.entries(o.results || {}).filter(([, r]) => r.status !== 'skipped').map(([k, r]) => [k, r.status === 'done' ? r.lines.join('. ') : 'left out: ' + r.lines.join('. ')])),
          still_to_do: o.followups.map(f => f.text),
          message: 'Created. The still-to-do list is on the New location page.',
        }
      })
    },
  },
]

