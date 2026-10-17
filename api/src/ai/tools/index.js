// src/ai/tools/index.js
//
// The AI tool registry (migration 148). A tool is:
//
//   name, title, description   shown to the model
//   section                    the area of the app it belongs to (SECTIONS):
//                              Pepper's prompt lists the areas, and the staff
//                              chat loads all but CORE_TOOLS on demand
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
// Guest tools: tools/guest.js. Staff tools (Pepper): tools/staff.js
// (bookings), tools/hs.js (health & safety, checklists, action log),
// tools/purchasing.js, tools/menus.js, tools/rota.js (staff, rota, pay,
// tips), tools/cash.js (cash reconciliation), tools/orders.js (online
// orders, sold out, till and kitchen reports), tools/venue.js (customers,
// opening times, tables, booking rules), tools/site.js (website,
// promotions, reviews, menu screens, booking emails, support) and
// tools/general.js (open_page).

import { zodToJsonSchema } from 'zod-to-json-schema'
import { ZodError } from 'zod'
import { ToolError, isStaff } from '../context.js'
import { MODULE_KEYS } from '../../config/modules.js'
import { guestTools } from './guest.js'
import { staffTools as bookingTools } from './staff.js'
import { hsTools } from './hs.js'
import { purchasingTools } from './purchasing.js'
import { menuTools } from './menus.js'
import { rotaTools } from './rota.js'
import { cashTools } from './cash.js'
import { orderTools } from './orders.js'
import { venueTools } from './venue.js'
import { siteTools } from './site.js'
import { generalTools } from './general.js'

// The areas Pepper covers, in the order its prompt lists them.
export const SECTIONS = {
  general:    'Finding your way: links to pages',
  bookings:   'Table bookings',
  customers:  'Customers',
  venue:      'Opening times, closures, tables and booking rules',
  hs:         'Health & safety, food safety checks and checklists',
  rota:       'Staff, the rota, pay and tips',
  cash:       'Cash reconciliation and wages paid',
  orders:     'Online orders and sold out dishes',
  till:       'Till and kitchen reports',
  menus:      'Menus, dishes, prices and allergens',
  purchasing: 'Purchasing: inventory, suppliers and supplier orders',
  website:    'Website, promotions, reviews, menu screens and booking emails',
  support:    'Reporting problems and asking for features',
}

// The modules each area's tools check (requireStaffPermission). The staff
// connector lists a tool only when the person has View on one of its area's
// modules (Manage for a change tool), so a list can show a tool the person
// still can't use (the tool refuses), never hide one they can.
export const SECTION_MODULES = {
  bookings:   ['bookings'],
  customers:  ['customers'],
  venue:      ['schedule', 'rules', 'tables', 'venues'],
  hs:         ['checklists', 'food_safety', 'hs_action_log'],
  rota:       ['staff', 'rota', 'rota_pay', 'rota_tips'],
  cash:       ['cash_recon'],
  orders:     ['web_orders'],
  till:       ['pos_reports'],
  menus:      ['menus'],
  purchasing: ['purchasing', 'purchasing_setup'],
  website:    ['website', 'promotions', 'screens', 'email_templates'],
  support:    ['issue_log', 'feature_requests'],
}
// Tools anyone with Pepper can use (no area's permission).
const OPEN_TOOLS = new Set(['list_venues', 'open_page'])

/** Can a person with these module levels use this staff tool (connector list)? */
export function toolAllowed(tool, levels) {
  if (OPEN_TOOLS.has(tool.name) || tool.section === 'general') return true
  const modules = SECTION_MODULES[tool.section]
  if (!modules) return true
  const need = tool.confirm ? 'manage' : 'view'
  return modules.some(m => levels[m] === 'manage' || (need === 'view' && levels[m] === 'view'))
}

const withSection = (tools, section) => tools.map(t => (t.section ? t : { ...t, section }))

// Pepper's tools, every area. Older files don't tag their tools; their file is their area.
const staffTools = [
  ...generalTools,
  ...withSection(bookingTools, 'bookings'),
  ...withSection(hsTools, 'hs'),
  ...withSection(purchasingTools, 'purchasing'),
  ...withSection(menuTools, 'menus'),
  ...rotaTools, ...cashTools, ...orderTools, ...venueTools, ...siteTools,
]
const BY_AUDIENCE = { guest: guestTools, staff: staffTools }

// Loaded in every staff chat request; the rest are found with tool search
// (src/ai/chat.js). The everyday questions: today's bookings, who is on,
// what is due, where a page is.
export const CORE_TOOLS = new Set([
  'list_venues', 'find_bookings', 'day_overview', 'check_availability', 'hs_status', 'whos_working', 'open_page',
])

for (const t of staffTools) {
  if (!SECTIONS[t.section]) throw new Error('Tool ' + t.name + ' has no known section')
  if (t.section !== 'general' && !SECTION_MODULES[t.section]) throw new Error('Section ' + t.section + ' has no modules in SECTION_MODULES')
}
for (const m of Object.values(SECTION_MODULES).flat()) {
  if (!MODULE_KEYS.includes(m)) throw new Error('SECTION_MODULES names an unknown module: ' + m)
}
{
  const names = staffTools.map(t => t.name)
  const dup = names.find((n, i) => names.indexOf(n) !== i)
  if (dup) throw new Error('Two staff tools are called ' + dup)
  for (const n of CORE_TOOLS) if (!names.includes(n)) throw new Error('Core tool ' + n + ' is missing')
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
