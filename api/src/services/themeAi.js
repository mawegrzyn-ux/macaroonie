// src/services/themeAi.js
//
// Pepper's side of the theme maker: themes for the website, kiosks, menu
// screens and printed menus from a picture (a logo, a photo of the
// restaurant or the food, a mood board) and a few words. One model call,
// answered as JSON in a fixed shape (structured outputs). The picture's own
// main colours, measured in the browser (extractPalette() in
// shared/themeKit.js), go with it, so the colours are exact rather than
// guessed by eye. Every theme that comes back goes through normaliseKit(),
// which fixes anything hard to read; nothing is saved here: the designer
// fills its form and the person saves it as usual.
//
//   suggestThemes({ tenantId, person, target, prompt, image, palette, current, like, brand, count })
//     Returns { kits, notes }.
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
import { FONT_OPTIONS } from '../../../shared/fonts.js'
import { normaliseKit, DISPLAY_FONTS, KIT_SHAPES, HEADING_CASES, KIT_COLORS } from '../../../shared/themeKit.js'

// ── The answer's shape ──────────────────────────────────────────
// Every property is required and nothing is nullable ('' = not set).

const obj = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false })
const str = { type: 'string' }
const oneOf = values => ({ type: 'string', enum: values })

export const THEMES_SCHEMA = obj({
  notes: str,
  themes: {
    type: 'array',
    items: obj({
      name: str,
      about: str,
      colors: obj(Object.fromEntries(KIT_COLORS.map(k => [k, str]))),
      heading_font: oneOf(FONT_OPTIONS),
      body_font: oneOf(FONT_OPTIONS),
      script_font: oneOf(FONT_OPTIONS),
      display_font: oneOf(['', ...DISPLAY_FONTS]),
      shape: oneOf(KIT_SHAPES),
      heading_case: oneOf(HEADING_CASES),
    }),
  },
})

const TARGETS = {
  website: 'the website (a page colour, cards, headings and links in the primary colour; buttons are always white text on the primary colour, so the primary must be dark enough for white text)',
  kiosk: 'a self-order kiosk (a big touch screen at the counter: pictures of the food on cards, big buttons in the primary colour with primary_text on them, highlights in the accent colour)',
  board: 'a menu screen on the wall (seen from across the room: most boards read best as light words on a deep background; prices and section titles in the accent colour)',
  print: 'a printed menu (dark ink on cream paper, prices and handwritten touches in the primary colour)',
}

export const SYSTEM_PROMPT = `You are ${ASSISTANT_NAME}, the assistant in Macaroonie, a platform restaurant groups run their restaurants on. You design colour and font themes for a restaurant group's website, self-order kiosks, menu screens and printed menus. The app turns each theme into the designer's settings; the person picks one and saves it.

You get some of:
- a picture: a logo, a photo of the restaurant, the food or the brand, or a mood board.
- measured_colours: the picture's main colours measured from its pixels, with the share of the picture each covers. These are exact; use them instead of guessing colours by eye.
- request: what the person asked for, in their words.
- designing_for: what the theme will be used on first (the other places get it too).
- brand: the group's name and tagline.
- current: the designer's current theme, for requests like "warmer" or "more modern" that start from it.
- like: a theme the person liked; make variations close to it.

Make the number of themes asked for (count), each clearly different from the others unless the request asks for one style:
- From a logo: keep its main colour as the primary (exactly, or a shade of it when it would be hard to read) and build around it.
- From a photo: take the mood and the colours of the place or the food.
- Without a picture, work from the request and the brand.
- Follow the request; when it says nothing about light or dark, offer a mix (for example one light, one dark, one bold).

Colours (#rrggbb):
- background: the page. surface: cards and panels on it, a little lighter or darker than the page.
- text on background and on surface: easy to read (at least 4.5 to 1). muted: quieter text, still readable (3 to 1). border: thin lines.
- primary: buttons and the main brand colour; primary_text: the words on primary buttons (4.5 to 1).
- accent: highlights, badges, prices; accent_text: words on the accent (4.5 to 1).

Fonts: only from the lists. heading_font for headings, body_font for text (pick a pair that reads well together), script_font for handwritten touches (Caveat when nothing else fits), display_font: a bold face for big screens (kiosks, menu boards), or '' to use the heading font there.
shape: square, soft or round corners. heading_case: upper for bold, punchy brands, normal otherwise.

name: two or three words that say the look ("Sunlit market"). about: one short sentence on the look and why it suits them.
notes: one or two sentences on what you took from the picture and the request.

Write in plain British English, no jargon.`

// ── Calling Claude ──────────────────────────────────────────────

let client = null, clientKey = null
async function anthropic() {
  const { key } = await activeKey()
  if (!key) throw httpError(503, 'AI isn\'t set up on this server: a platform admin adds the key on the Platform page.')
  if (key !== clientKey) {
    client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 180_000 })
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

/** A kit as the model sees it (no source). */
function describeKit(k) {
  return { name: k.name, colors: k.colors, fonts: k.fonts, shape: k.shape, heading_case: k.heading_case }
}

/**
 * Themes from a picture and words. image: { media_type, data } (base64,
 * already checked by the route); palette: [{ hex, share }]; current / like:
 * kits (normalised here); brand: { name, tagline }.
 */
export async function suggestThemes({ tenantId, person, target, prompt = '', image = null, palette = [], current = null, like = null, brand = null, count = 3 }) {
  if ((await chatUnitsLeft(tenantId)) <= 0) throw httpError(429, 'This month\'s AI allowance is used up.')
  const mine = person?.sub ? await personUnitsLeft(tenantId, person.sub) : null
  if (mine !== null && mine <= 0) throw httpError(429, 'You\'ve used your share of the AI allowance for today. It starts again tomorrow.')

  const request = {
    count,
    designing_for: TARGETS[target] || TARGETS.website,
    request: prompt || '(no words: work from the picture)',
    ...(palette.length ? { measured_colours: palette.map(p => ({ hex: p.hex, share: p.share })) } : {}),
    ...(brand?.name || brand?.tagline ? { brand } : {}),
    ...(current ? { current: describeKit(normaliseKit(current, { source: 'current' })) } : {}),
    ...(like ? { like: describeKit(normaliseKit(like)) } : {}),
  }
  const content = []
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } })
  content.push({ type: 'text', text: (image ? 'The picture is above.\n' : 'No picture this time.\n') + JSON.stringify(request) })

  const params = {
    model: env.AI_MODEL,
    max_tokens: 8000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: THEMES_SCHEMA } },
    messages: [{ role: 'user', content }],
  }
  let res
  try {
    res = await callClaude(params)
  } catch (err) {
    // A schema the API can't use: ask for the same JSON as plain text instead.
    if (!(err instanceof Anthropic.BadRequestError) || !/schema|output_config|format/i.test(err.message || '')) {
      if (err instanceof Anthropic.BadRequestError) throw httpError(422, 'Claude couldn\'t use that picture. Try another one (a JPEG or PNG), or describe the look in words.')
      throw err
    }
    res = await callClaude({
      ...params,
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM_PROMPT + '\n\nAnswer with one JSON object only, no other text, matching this JSON schema:\n' + JSON.stringify(THEMES_SCHEMA), cache_control: { type: 'ephemeral' } }],
    })
  }
  const u = res.usage || {}
  await addUsage(tenantId, 'staff_chat', {
    input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0, model: res.model, person,
  })
  if (res.stop_reason === 'refusal') throw httpError(422, ASSISTANT_NAME + ' can\'t help with this one. Try another picture or other words.')
  if (res.stop_reason === 'max_tokens') throw httpError(502, ASSISTANT_NAME + '\'s answer was cut off. Try again.')

  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  const out = jsonIn(text)
  if (!out || !Array.isArray(out.themes)) throw httpError(502, ASSISTANT_NAME + '\'s answer couldn\'t be read. Try again.')
  const kits = out.themes.slice(0, count).map(t => normaliseKit({
    name: t?.name, about: t?.about, colors: t?.colors,
    fonts: { heading: t?.heading_font, body: t?.body_font, script: t?.script_font, display: t?.display_font },
    shape: t?.shape, heading_case: t?.heading_case,
  }, { source: 'ai' }))
  if (!kits.length) throw httpError(502, ASSISTANT_NAME + ' didn\'t come back with a theme. Try again.')
  return { kits, notes: clip(out.notes, 400) }
}
