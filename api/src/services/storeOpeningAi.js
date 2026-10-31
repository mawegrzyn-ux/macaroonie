// src/services/storeOpeningAi.js
//
// Pepper's side of opening a new location (migration 186): one model call per
// step, answered as JSON in a fixed shape (structured outputs). The answer is
// never trusted as it stands: its plan goes through normalisePlan()
// (shared/storeOpening.js), its questions are trimmed and numbered here, and
// nothing is created until the person presses Create (routes/storeOpenings.js).
//
//   askPepper({ tenantId, person, step, opening, context, canSetUp, today, extra })
//     step: 'scope' (first look), 'answers' (after a round of answers),
//           'deep_dive' (more questions on one area), 'change' (the person
//           asked for a change to a finished brief)
//     Returns { title, summary, ready, rawPlan, areas, questions, brief, usage }.
//
// Counts towards the tenant's monthly AI allowance and the person's daily
// share of it, like the chat.

import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { httpError } from '../middleware/error.js'
import { activeKey } from '../ai/apiKey.js'
import { addUsage } from '../ai/context.js'
import { chatUnitsLeft, personUnitsLeft } from '../ai/settings.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'
import { OPENING_AREAS, AREA_KEYS, MAX_ROUNDS, MODES } from '../../../shared/storeOpening.js'

// ── The answer's shape ──────────────────────────────────────────
// Every property is required and nothing is nullable: '' / 0 / [] mean
// "not set", which keeps the schema simple for the grammar it compiles to.

const obj = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false })
const arr = items => ({ type: 'array', items })
const str = { type: 'string' }, int = { type: 'integer' }, num = { type: 'number' }, bool = { type: 'boolean' }
const oneOf = values => ({ type: 'string', enum: values })

export const ANSWER_SCHEMA = obj({
  title: str,
  summary: str,
  ready: bool,
  plan: obj({
    venue: obj({ name: str, slug: str, timezone: str, currency: str }),
    location: obj({ address_line1: str, address_line2: str, city: str, postcode: str, country: str, phone: str, email: str }),
    opening_date: str,
    template_venue_id: str,
    areas: arr(obj({ key: oneOf(AREA_KEYS), mode: oneOf(MODES), note: str, deep_dive: bool })),
    hours: obj({
      slot_interval_mins: int,
      days: arr(obj({ day: int, open: bool, sittings: arr(obj({ name: str, opens_at: str, closes_at: str, max_covers: int })) })),
    }),
    tables: obj({ sections: arr(obj({ name: str, tables: arr(obj({ label: str, min_covers: int, max_covers: int })) })) }),
    booking_rules: obj({ slot_duration_mins: int, min_covers: int, max_covers: int, book_until_days: int, cutoff_before_mins: int }),
    ordering_enabled: bool,
    till: obj({ receipt_name: str, streams: arr(obj({ name: str })) }),
    devices: obj({ tills: int, kitchen_screens: int, kiosks: int, menu_screens: int }),
    food_safety: obj({
      equipment: arr(obj({ name: str, type: oneOf(['fridge', 'freezer']) })),
      check_times: arr(str),
      hold_stations: arr(obj({ name: str, hold_type: oneOf(['hot', 'cold']) })),
      hold_check_times: arr(str),
      cooking_sessions: arr(obj({ label: str, time: str, required: int })),
    }),
    checklists: arr(obj({ name: str, frequency: oneOf(['daily', 'weekly', 'monthly']), tasks: arr(str) })),
    pars_percent: int,
    staff: arr(obj({ name: str, role: str, pay_type: oneOf(['hourly', 'fixed']), rate: num })),
    email_from_name: str,
  }),
  questions: arr(obj({
    id: str,
    area: oneOf([...AREA_KEYS, 'basics']),
    text: str,
    why: str,
    kind: oneOf(['choice', 'multi', 'text', 'number', 'date', 'time', 'yesno']),
    options: arr(obj({ value: str, label: str })),
    suggested: str,
  })),
  brief: obj({ headline: str, summary: str, highlights: arr(str), assumptions: arr(str), risks: arr(str), followups: arr(str) }),
})

// ── The prompt ──────────────────────────────────────────────────

const AREA_LINES = OPENING_AREAS.map(a =>
  '- ' + a.key + ' (' + a.label + '): ' + a.about + ' Ways: ' + a.modes.join(', ') + '.').join('\n')

export const SYSTEM_PROMPT = `You are ${ASSISTANT_NAME}, the assistant in Macaroonie, a platform restaurant groups run their restaurants on. You are helping a group open a new location: you scope it, ask only the questions that matter, and write a short brief. When the person is happy with it, the app creates the location from your plan. You never create anything yourself.

Each area of a location is set up one of three ways:
- copy: copied from one of the group's own locations (template_venue_id). Best when a similar location exists (same brand, same kind of site): it brings across everything that location has set up.
- new: set up from the settings you put in the plan. Only some areas have settings.
- skip: left for later, for someone to set up on its page.

The areas:
${AREA_LINES}

Each time you are called:
1. Read the request, the questions and answers so far (an empty answer means the person left it to you), the person's own choices (person_choices: always keep them) and the group's locations (context.locations, with what each has set up, area by area).
2. Fill in the whole plan. Pick a location to copy from when one is similar, and say in each area's note why it is copied, set up new or left for later. Only use ways the area allows. Areas the person can't set up (anything not in can_set_up) must be skip, with a note saying someone with access sets it up.
3. Ask questions only where the answer changes the setup and you can't sensibly decide yourself. At most 8 in a round, fewer is better; none is fine. Prefer a choice with options and put your recommendation in suggested. Don't ask what the context or earlier answers already say. Mark an area deep_dive when it needs more than a quick answer (for example a different table layout from the location copied from, a different kind of kitchen or service, a different trading pattern).
4. Set ready to true when the plan is good enough to create the location: nothing important left unknown, or round equals max_rounds. When ready, questions must be empty and the brief filled in. When not ready, the brief may stay empty.

For a deep_dive step, ask the questions that set up deep_dive_area well (up to 8), and keep everything else as it is.
For a change step, change the plan as change_request asks, explain the change in summary, and set ready to true unless the change needs answers first.

Rules for the plan:
- venue.name: the location's name as guests see it, usually the brand and the place. venue.slug: lower case words joined with hyphens. venue.timezone: an IANA time zone for where it is (Europe/London in the UK). venue.currency: an ISO code.
- location: only what the person told you; '' for anything unknown. Never make up an address, phone number or email.
- opening_date: YYYY-MM-DD, or '' when unknown. today is in the request.
- template_venue_id: the id of a location in context.locations, or ''.
- An area set to copy or skip leaves its settings empty ([] or 0); an area set to new has them filled in fully.
- hours.days: day 0 is Sunday to 6 Saturday; times are HH:MM, 24-hour; max_covers 0 means no limit; slot_interval_mins is 15, 30 or 60.
- tables: real labels (T1, T2 ...) and sizes, grouped into rooms; seats should add up to about what they said.
- devices: how many tills, kitchen screens, kiosks and menu screens to make ready to link (new), or 0.
- food_safety (new): fridges and freezers by name, check times, hot or cold hold stations, cooking sessions.
- checklists (new): short, practical lists for a UK restaurant (opening, closing, cleaning) with short tasks.
- staff (new): only people the person named; role as they said it.
- pars_percent: 100 means the same order pars as the location copied from; scale it to the expected trade (150 for a site half as busy again).
- email_from_name: who booking emails come from, or ''.
- ordering_enabled: true only if they want online ordering on straight away (it stays off before the opening date anyway).

The brief (when ready): headline (one line); summary (two or three sentences: what this location is and how it is being set up); highlights (up to 6 short points); assumptions (what you decided without being told, up to 6); risks (up to 4 things that could go wrong around opening); followups (up to 6 things people must do outside the app or by hand, for example ordering a card terminal or getting a licence; don't list what the app does itself).

title: a short working name for this opening, like "Leeds city centre". summary (always): one or two sentences on what you have understood so far.

Write in plain British English, short and friendly, no jargon.`

// ── Calling Claude ──────────────────────────────────────────────

let client = null, clientKey = null
async function anthropic() {
  const { key } = await activeKey()
  if (!key) throw httpError(503, 'AI isn\'t set up on this server: a platform admin adds the key on the Platform page.')
  if (key !== clientKey) {
    client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 240_000 })
    clientKey = key
  }
  return client
}

async function callClaude(params) {
  const api = await anthropic()
  try {
    return await api.messages.stream(params).finalMessage()
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw httpError(503, 'The AI key isn\'t working. A platform admin needs to update it.')
    }
    if (err instanceof Anthropic.BadRequestError) throw err
    throw httpError(503, 'Claude is busy or can\'t be reached right now. Try again in a moment.')
  }
}

/** The first JSON object in a text reply (when the schema couldn't be used). */
function jsonIn(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const lines = (v, max, n = 240) => (Array.isArray(v) ? v.map(x => clip(x, n)).filter(Boolean).slice(0, max) : [])

function cleanQuestions(qs, round) {
  const out = []
  const seen = new Set()
  for (const q of Array.isArray(qs) ? qs.slice(0, 10) : []) {
    const text = clip(q?.text, 400)
    if (!text) continue
    let id = clip(q?.id, 40).replace(/[^a-z0-9_-]/gi, '') || 'q' + (out.length + 1)
    id = 'r' + round + '-' + id
    while (seen.has(id)) id += 'x'
    seen.add(id)
    const kind = ['choice', 'multi', 'text', 'number', 'date', 'time', 'yesno'].includes(q?.kind) ? q.kind : 'text'
    const options = (Array.isArray(q?.options) ? q.options : []).slice(0, 8)
      .map(o => ({ value: clip(o?.value, 120) || clip(o?.label, 120), label: clip(o?.label, 160) || clip(o?.value, 160) }))
      .filter(o => o.value)
    out.push({
      id,
      area: [...AREA_KEYS, 'basics'].includes(q?.area) ? q.area : 'basics',
      text,
      why: clip(q?.why, 300),
      kind: (kind === 'choice' || kind === 'multi') && !options.length ? 'text' : kind,
      options: kind === 'choice' || kind === 'multi' ? options : [],
      suggested: clip(q?.suggested, 200),
    })
  }
  return out
}

/** Pepper's plan (answer shape) into the shape normalisePlan() reads. */
function rawPlanOf(p = {}) {
  return {
    venue: p.venue, location: p.location,
    opening_date: p.opening_date || null,
    template_venue_id: p.template_venue_id || null,
    modes: Object.fromEntries((p.areas || []).map(a => [a.key, a.mode])),
    hours: p.hours, tables: p.tables, booking_rules: p.booking_rules,
    ordering: { enabled: !!p.ordering_enabled },
    till: p.till, devices: p.devices, food_safety: p.food_safety,
    checklists: { lists: p.checklists || [] },
    purchasing: { pars_percent: p.pars_percent || 100 },
    staff: { people: p.staff || [] },
    emails: { from_name: p.email_from_name || '' },
  }
}

/**
 * One step with Pepper. `opening` is the store_openings row (steps so far,
 * overrides, the current plan); `extra` is { answers } / { area } / { request }.
 */
export async function askPepper({ tenantId, person, step, opening, context, canSetUp, today, extra = {} }) {
  if ((await chatUnitsLeft(tenantId)) <= 0) throw httpError(429, 'This month\'s AI allowance is used up.')
  const mine = person?.sub ? await personUnitsLeft(tenantId, person.sub) : null
  if (mine !== null && mine <= 0) throw httpError(429, 'You\'ve used your share of the AI allowance for today. It starts again tomorrow.')

  const round = (opening.rounds || 0) + (step === 'scope' || step === 'answers' ? 1 : 0)
  const conversation = (opening.steps || [])
    .filter(s => s.questions?.length || s.answers || s.request || s.area)
    .map(s => ({ step: s.kind, questions: (s.questions || []).map(q => ({ id: q.id, area: q.area, text: q.text })), answers: s.answers || undefined, deep_dive_area: s.area || undefined, change_request: s.request || undefined }))
  if (step === 'answers') conversation.push({ step: 'answers', answers: extra.answers })
  const request = {
    step,
    today,
    round: Math.min(round, MAX_ROUNDS),
    max_rounds: MAX_ROUNDS,
    request: opening.input,
    conversation,
    person_choices: opening.overrides || {},
    current_plan: opening.plan || null,
    can_set_up: canSetUp,
    ...(step === 'deep_dive' ? { deep_dive_area: extra.area } : {}),
    ...(step === 'change' ? { change_request: extra.request } : {}),
  }

  const params = {
    model: env.AI_MODEL,
    max_tokens: 32000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: env.AI_EFFORT, format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'The group (context):\n' + JSON.stringify(context), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'This step:\n' + JSON.stringify(request) },
      ],
    }],
  }
  let res
  try {
    res = await callClaude(params)
  } catch (err) {
    // A schema the API can't use (too complex for its grammar): ask for the
    // same JSON as plain text instead.
    if (!(err instanceof Anthropic.BadRequestError) || !/schema|output_config|format/i.test(err.message || '')) {
      if (err instanceof Anthropic.BadRequestError) throw httpError(502, 'Claude couldn\'t read this request: try again in a moment.')
      throw err
    }
    res = await callClaude({
      ...params,
      output_config: { effort: env.AI_EFFORT },
      system: [{ type: 'text', text: SYSTEM_PROMPT + '\n\nAnswer with one JSON object only, no other text, matching this JSON schema:\n' + JSON.stringify(ANSWER_SCHEMA), cache_control: { type: 'ephemeral' } }],
    })
  }
  const u = res.usage || {}
  addUsage(tenantId, 'staff_chat', {
    input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0, model: res.model, person,
  })
  if (res.stop_reason === 'refusal') throw httpError(422, ASSISTANT_NAME + ' can\'t help with this one. Try describing the new location differently.')
  if (res.stop_reason === 'max_tokens') throw httpError(502, ASSISTANT_NAME + '\'s answer was cut off. Try again, or describe the location more briefly.')

  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const out = jsonIn(text)
  if (!out || typeof out !== 'object') throw httpError(502, ASSISTANT_NAME + '\'s answer couldn\'t be read. Try again.')

  const last = round >= MAX_ROUNDS
  const questions = step === 'change' && out.ready ? [] : cleanQuestions(out.questions, round)
  const ready = !!out.ready || last || (!questions.length && step !== 'deep_dive')
  const b = out.brief || {}
  return {
    title: clip(out.title, 80),
    summary: clip(out.summary, 800),
    ready,
    rawPlan: rawPlanOf(out.plan || {}),
    areas: (out.plan?.areas || []).filter(a => AREA_KEYS.includes(a?.key)).map(a => ({ key: a.key, note: clip(a.note, 400), deep_dive: !!a.deep_dive })),
    questions: ready && step !== 'deep_dive' ? [] : questions,
    brief: {
      headline: clip(b.headline, 160),
      summary: clip(b.summary, 1200),
      highlights: lines(b.highlights, 6),
      assumptions: lines(b.assumptions, 6),
      risks: lines(b.risks, 4),
      followups: lines(b.followups, 6),
    },
    round,
  }
}
