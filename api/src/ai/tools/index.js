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
//   destructive                cancels or erases (MCP destructiveHint)
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

import fs from 'node:fs'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ZodError } from 'zod'
import { ToolError, isStaff } from '../context.js'
import { MODULE_KEYS, permissionAtLeast } from '../../config/modules.js'
import { guestTools } from './guest.js'

// The staff tool files, in order. A top-level await: nothing a tool file
// imports may lead back to this file, or it would never finish loading.
const HERE = new URL('./', import.meta.url)
const toolFiles = []
for (const file of fs.readdirSync(HERE).filter(f => f.endsWith('.js') && f !== 'index.js').sort()) {
  const mod = await import(new URL(file, HERE).href)
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
const BY_AUDIENCE = { guest: guestTools, staff: staffTools }

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
