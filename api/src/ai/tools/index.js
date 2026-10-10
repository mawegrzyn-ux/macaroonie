// src/ai/tools/index.js
//
// The AI booking tool registry (migration 148). A tool is:
//
//   name, title, description   shown to the model
//   input                      Zod object schema (validated before run;
//                              sent to the model / MCP client as JSON Schema)
//   run(ctx, input)            does the work, returns a plain object
//   readOnly                   only reads (MCP readOnlyHint)
//   confirm                    changes a booking: in a chat it doesn't run
//                              when the model calls it. The server stores a
//                              pending action and the person presses Confirm
//                              on a card (src/ai/chat.js); describe(ctx,
//                              input) builds that card and checks the call
//                              can go ahead. Over MCP the client's own app
//                              asks the person, and run() is called directly.
//   destructive                cancels (MCP destructiveHint)
//
// Guest tools: tools/guest.js. Staff tools: tools/staff.js.

import { zodToJsonSchema } from 'zod-to-json-schema'
import { ZodError } from 'zod'
import { ToolError, isStaff } from '../context.js'
import { guestTools } from './guest.js'
import { staffTools } from './staff.js'

const BY_AUDIENCE = { guest: guestTools, staff: staffTools }

export function toolsFor(ctx) {
  return isStaff(ctx) ? staffTools : guestTools
}

export function findTool(ctx, name) {
  return toolsFor(ctx).find(t => t.name === name) ?? null
}

export function audienceTools(audience) {
  return BY_AUDIENCE[audience] || []
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
