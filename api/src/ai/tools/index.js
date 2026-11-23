// src/ai/tools/index.js
//
// The AI tool registry (migration 148). A tool is:
//
//   name, title, description   shown to the model
//   section                    the area of the app it belongs to (from the
//                              `sections` a tool file exports): the staff
//                              connector checks the area's modules. A tool
//                              without one takes its file's only area
//   activity                   the line the chat shows for a call ("Looked
//                              at the rota"), src/ai/chat.js
//   core                       loaded in every staff chat request; the rest
//                              are found with tool search (src/ai/chat.js).
//                              Only for the everyday questions: each one is
//                              sent in full in every staff chat request
//   open                       anyone with Pepper can use it (no area's permission)
//   input                      Zod object schema (validated before run;
//                              sent to the model / MCP client as JSON Schema)
//   run(ctx, input)            does the work, returns a plain object
//   readOnly                   only reads (MCP readOnlyHint)
//   confirm                    changes something: in a chat it doesn't run
//                              when the model calls it. The server stores a
//                              pending action and the person presses Confirm
//                              on a card (src/ai/chat.js); describe(ctx,
//                              input) builds that card and checks the call
//                              can go ahead. Over MCP the client's own app
//                              asks the person, and run() is called directly.
//   destructive                cancels or erases (MCP destructiveHint, with
//                              class 'destructive')
//   class                      what a change costs if it is wrong (Pepper-first
//                              step 4a, CLASSES): 'read' (readOnly tools, set
//                              here), 'reversible' (low cost, can be undone:
//                              mark sold out, tick a check), 'consequential'
//                              (prices, orders, a rota, a refund, bookings) or
//                              'destructive' (delete, anonymise, anything to
//                              pay or tips, allergen data, anything about a
//                              person). Every tool that changes something
//                              declares one; start-up throws without it. The
//                              Confirm card's friction follows it (chat.js):
//                              a destructive card needs a typed word and is
//                              never confirmed by voice
//   escalate(input)            optional: a higher class for this call (a dish
//                              change that touches allergens is destructive)
//   preconditions              optional: the checks the tool makes before it
//                              runs, in plain words, added to its description
//                              (toolDescription())
//   editable                   optional, confirm tools: { key: { label, kind } }
//                              input fields the person may change on the card
//                              (kind 'number' | 'time' | 'text' | 'note'); the
//                              edited input goes through `input` and
//                              describe() again (chat.js)
//   inverse(ctx, undo)         optional, reversible tools: undoes a run from
//                              the `_undo` its result carried, through the same
//                              routes; the done card offers Undo for
//                              UNDO_MINUTES (chat.js). `_undo` never reaches the
//                              model or an MCP client (shownResult())
//
// Guest tools: tools/guest.js (guestTools). Staff tools (Pepper): every
// other file in this folder that exports `tools` is gathered at start-up
// (a file that doesn't, such as util.js, is a helper). A tool file exports:
//
//   tools         its tools
//   order         its place: the files are gathered by order, then by file
//                 name, and Pepper's system prompt lists them in that order.
//                 The prompt is cached by the model provider, so the order
//                 depends on nothing but the files
//   sections      the areas it adds: { key: { label, modules } }, modules
//                 being the ones its tools check (requireStaffPermission),
//                 or { label, open: true } for an area anyone can use
//   promptLines   its line(s) in the prompt's list of what Pepper can do
//   promptNotes   its paragraph(s) on how to use them (prompts.js)
//
// The files: staff.js (bookings), venue.js (customers, opening times,
// tables, booking rules), hs.js (health & safety, checklists, action log),
// rota.js (staff, rota, pay, tips), cash.js (cash reconciliation),
// orders.js (online orders, sold out, till and kitchen reports), menus.js,
// purchasing.js, locations.js (opening a new location), localInfo.js,
// reports.js (the report builder: figures from the data, saved reports,
// past runs), reportSchedules.js (report schedules and sends), site.js
// (website, promotions, reviews, menu screens, booking emails, support),
// general.js (open_page, how_do_i), forms.js (open_form) and briefing.js
// (day_briefing).

import { FILES } from './files.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ZodError } from 'zod'
import { ToolError, isStaff } from '../context.js'
import { MODULE_KEYS, permissionAtLeast } from '../../config/modules.js'
import { guestTools } from './guest.js'

// The staff tool files, in order (files.js lists them; a tool file never
// imports this file, chat.js or prompts.js).
const toolFiles = []
for (const [file, mod] of FILES) {
  if (!mod.tools) continue
  if (!Array.isArray(mod.tools)) throw new Error('Tool file ' + file + ': tools is not a list')
  if (!Number.isFinite(mod.order)) throw new Error('Tool file ' + file + ' has no order')
  toolFiles.push({ file, ...mod })
}
toolFiles.sort((a, b) => a.order - b.order)   // stable: the same order keeps file-name order

// The areas Pepper covers ({ key: label }) and the modules each area's tools
// check (requireStaffPermission). The staff connector lists a tool only when
// the person has View on one of its area's modules (Manage for a change
// tool), so a list can show a tool the person still can't use (the tool
// refuses), never hide one they can.
export const SECTIONS = {}
export const SECTION_MODULES = {}
const OPEN_SECTIONS = new Set()
for (const f of toolFiles) {
  for (const [key, s] of Object.entries(f.sections || {})) {
    if (SECTIONS[key]) throw new Error('Two tool files add the area ' + key)
    if (!s.label) throw new Error('Area ' + key + ' (' + f.file + ') has no label')
    SECTIONS[key] = s.label
    if (s.open) OPEN_SECTIONS.add(key)
    else if (s.modules?.length) SECTION_MODULES[key] = s.modules
    else throw new Error('Area ' + key + ' (' + f.file + ') names no modules')
  }
}

// What a tool's change costs if it is wrong (Pepper-first step 4a; see the
// head of this file). Ranked: a call can only move a tool up (escalate()).
export const CLASSES = ['read', 'reversible', 'consequential', 'destructive']
export const CHANGE_CLASSES = ['reversible', 'consequential', 'destructive']
const CLASS_RANK = Object.fromEntries(CLASSES.map((c, i) => [c, i]))
export const EDIT_KINDS = ['number', 'time', 'text', 'note']

/** Checks a tool's class and the fields that go with it; a read tool gets 'read'. */
function checkClass(t) {
  if (t.readOnly) {
    if (t.class && t.class !== 'read') throw new Error('Tool ' + t.name + ' only reads but says it is ' + t.class)
    t.class = 'read'
  } else if (!CHANGE_CLASSES.includes(t.class)) {
    throw new Error('Tool ' + t.name + ' changes something but has no class (' + CHANGE_CLASSES.join(', ') + '): ' + t.class)
  }
  if (t.inverse && (t.class !== 'reversible' || typeof t.inverse !== 'function')) {
    throw new Error('Tool ' + t.name + ': only a reversible tool has an inverse (a function)')
  }
  if (t.escalate && typeof t.escalate !== 'function') throw new Error('Tool ' + t.name + ': escalate is a function')
  if (t.preconditions && (!Array.isArray(t.preconditions) || t.preconditions.some(p => typeof p !== 'string' || !p.trim()))) {
    throw new Error('Tool ' + t.name + ': preconditions are a list of sentences')
  }
  if (t.editable) {
    if (!t.confirm) throw new Error('Tool ' + t.name + ': only a confirm tool has editable fields')
    const shape = t.input?.shape || {}
    for (const [key, f] of Object.entries(t.editable)) {
      if (!shape[key]) throw new Error('Tool ' + t.name + ': editable field ' + key + ' isn\'t in its input')
      if (!f?.label || !EDIT_KINDS.includes(f.kind)) throw new Error('Tool ' + t.name + ': editable field ' + key + ' needs a label and a kind')
    }
  }
  return t
}

/** The class of one call: the tool's, or higher when the input asks for it
 *  (escalate(): a dish change that touches allergens). Never lower. */
export function classFor(tool, input) {
  const base = tool.class || (tool.readOnly ? 'read' : 'consequential')
  const up = tool.escalate?.(input ?? {})
  return up && CLASS_RANK[up] > CLASS_RANK[base] ? up : base
}

/** A tool's description with its preconditions, for the model and the connector. */
export function toolDescription(t) {
  return t.preconditions?.length ? t.description + ' Before it can run: ' + t.preconditions.join(' ') : t.description
}

/** A tool's result as the model or an MCP client sees it: without `_undo`
 *  (ids for Undo, kept with the card and the audit only). */
export function shownResult(out) {
  if (!out || typeof out !== 'object' || Array.isArray(out) || !('_undo' in out)) return out
  const { _undo, ...rest } = out
  return rest
}

/** Can a person with these module levels use this staff tool (connector list)?
 *  A reading tool needs View on one of its area's modules, a change tool Manage,
 *  or the level it names itself (`needs: 'use'`: the everyday H&S work). */
export function toolAllowed(tool, levels) {
  if (tool.open || OPEN_SECTIONS.has(tool.section)) return true
  // A tool may name its own modules (find_dishes: Menus or the Allergen lookup).
  const modules = tool.modules ?? SECTION_MODULES[tool.section]
  if (!modules) return true
  const need = tool.needs ?? (tool.confirm ? 'manage' : 'view')
  return modules.some(m => permissionAtLeast(levels[m], need))
}

// Pepper's tools, every area. A tool that doesn't name its area gets its file's only one.
const staffTools = toolFiles.flatMap(f => {
  const own = Object.keys(f.sections || {})
  return f.tools.map(t => {
    if (t.section) return t
    if (own.length !== 1) throw new Error('Tool ' + t.name + ' (' + f.file + ') has no section')
    return { ...t, section: own[0] }
  })
})
for (const t of [...staffTools, ...guestTools]) checkClass(t)
// The guest chat has no typed word on its cards: a guest tool is never destructive.
for (const t of guestTools) if (t.class === 'destructive' || t.escalate) throw new Error('Guest tool ' + t.name + ' can\'t be destructive')
const BY_AUDIENCE = { guest: guestTools, staff: staffTools }

/** Staff tools that can be undone (a reversible tool with an inverse), by name. */
export const UNDO_TOOLS = new Set(staffTools.filter(t => t.inverse).map(t => t.name))

// Loaded in every staff chat request (`core` on the tool); the rest are found
// with tool search (src/ai/chat.js). The everyday questions: today's
// bookings, who is on, what is due, where a page is.
export const CORE_TOOLS = new Set(staffTools.filter(t => t.core).map(t => t.name))

// Pepper's system prompt parts from the tool files, in their order (prompts.js).
export const PROMPT_LINES = toolFiles.flatMap(f => f.promptLines || [])
export const PROMPT_NOTES = toolFiles.flatMap(f => f.promptNotes || [])

for (const t of staffTools) {
  if (!SECTIONS[t.section]) throw new Error('Tool ' + t.name + ' has no known section')
}
for (const m of Object.values(SECTION_MODULES).flat()) {
  if (!MODULE_KEYS.includes(m)) throw new Error('SECTION_MODULES names an unknown module: ' + m)
}
for (const t of staffTools) {
  for (const m of t.modules || []) if (!MODULE_KEYS.includes(m)) throw new Error('Tool ' + t.name + ' names an unknown module: ' + m)
}

/** Every module a staff tool's permission can depend on (the connector reads these levels). */
export const TOOL_MODULE_KEYS = [...new Set([
  ...Object.values(SECTION_MODULES).flat(),
  ...staffTools.flatMap(t => t.modules || []),
])]
{
  const names = staffTools.map(t => t.name)
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) throw new Error('Two staff tools are called ' + dup)
  if (!CORE_TOOLS.size) throw new Error('No core tools')
  // A guest tool may share a staff tool's name; the chat shows one activity line per name.
  for (const g of guestTools) {
    const s = staffTools.find(t => t.name === g.name)
    if (s && s.activity !== g.activity) throw new Error('The guest and staff tools called ' + g.name + ' show different activity')
  }
}

export function toolsFor(ctx) {
  return isStaff(ctx) ? staffTools : guestTools
}

export function findTool(ctx, name) {
  return toolsFor(ctx).find(t => t.name === name) ?? null
}

export function audienceTools(audience) {
  return BY_AUDIENCE[audience] || []
}

/** Tool names per area, for Pepper's prompt: { section: [names] }. */
export function toolsBySection() {
  const out = {}
  for (const t of staffTools) (out[t.section] ??= []).push(t.name)
  return out
}

const schemaCache = new WeakMap()
export function jsonSchemaOf(tool) {
  if (!schemaCache.has(tool)) {
    const s = zodToJsonSchema(tool.input, { target: 'jsonSchema7', $refStrategy: 'none' })
    delete s.$schema
    if (!s.properties) s.properties = {}
    schemaCache.set(tool, s)
  }
  return schemaCache.get(tool)
}

/** Validates input against the tool's schema; throws ToolError listing the problems. */
export function parseInput(tool, input) {
  try {
    return tool.input.parse(input ?? {})
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map(i => (i.path.join('.') || 'input') + ': ' + i.message).join('; ')
      throw new ToolError('Invalid input: ' + issues, 400)
    }
    throw err
  }
}

/** Runs a tool now (MCP, read tools in chats, and a confirmed pending action). */
export async function runTool(ctx, name, input) {
  const tool = findTool(ctx, name)
  if (!tool) throw new ToolError('Unknown tool ' + name, 404)
  return tool.run(ctx, parseInput(tool, input))
}

/** A tool error as text for the model. Unexpected errors don't leak detail. */
export function errorText(err, log) {
  if (err instanceof ToolError) return err.message
  log?.error({ err }, 'AI tool failed')
  return 'Something went wrong on our side. Try again in a moment, or use the website or call the restaurant.'
}
