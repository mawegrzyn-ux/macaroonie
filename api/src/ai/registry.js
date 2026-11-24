// src/ai/registry.js
//
// The object registry joined with what the API knows (Pepper-first step
// 8A1, docs/PEPPER_FIRST.md 13 decision 5): the records of shared/registry/
// (one per business object, naming its table, report subjects, pages, the
// Pepper tools that change it and its forms) with each action's class,
// preconditions, undo and permission taken from the tool itself, never
// copied into the record.
//
//   registryKnown()        what the API knows, for registryProblems():
//                          Pepper's staff tools, the catalogue's subjects
//                          and every table with a catalogue decision
//   objectActions(o)       a record's actions as the tools declare them
//   actionAllowed(t, lv)   may a person with these module levels use it
//
// It imports tools/index.js, so no tool file may import it at load time
// (the registry would be read half-built): Pepper's what_can_i_do
// (tools/general.js) imports it when it runs.

import { audienceTools, SECTION_MODULES, toolAllowed, toolDescription } from './tools/index.js'
import { CATALOGUE } from '../reports/catalogue/index.js'
import { tableDecisions } from '../reports/catalogue/decisions.js'
import { OBJECT_LIST } from '../../../shared/registry/index.js'

const staffTools = () => audienceTools('staff')
const byName = () => new Map(staffTools().map(t => [t.name, t]))

/** What the API knows, in the shape registryProblems() takes. */
export function registryKnown() {
  return {
    tools: new Map(staffTools().map(t => [t.name, { readOnly: !!t.readOnly }])),
    subjects: Object.keys(CATALOGUE.subjects),
    tables: [...new Set(tableDecisions(CATALOGUE).map(d => d.table))],
  }
}

/** The modules a tool's permission depends on (its own, or its area's). */
export const toolModules = t => t.modules ?? SECTION_MODULES[t.section] ?? []

/** The level a tool needs on those modules. */
export const toolNeeds = t => t.needs ?? (t.confirm ? 'manage' : 'view')

/** Can a person with these module levels use this tool (the staff connector's rule). */
export const actionAllowed = (tool, levels) => toolAllowed(tool, levels)

/**
 * A record's actions as their tools declare them: [{ tool, name, title,
 * class, preconditions, undo, modules, needs, description }]. A name the
 * tools don't have is left out (the registry test fails on it).
 */
export function objectActions(record) {
  const tools = byName()
  return record.actions.map(name => tools.get(name)).filter(Boolean).map(t => ({
    tool: t,
    name: t.name,
    title: t.title || t.name,
    class: t.class,
    preconditions: t.preconditions || [],
    undo: typeof t.inverse === 'function',
    modules: toolModules(t),
    needs: toolNeeds(t),
    description: toolDescription(t),
  }))
}

/** Every module the records' actions can depend on, for one permission lookup. */
export function registryModules() {
  return [...new Set(OBJECT_LIST.flatMap(o => objectActions(o).flatMap(a => a.modules)))]
}
