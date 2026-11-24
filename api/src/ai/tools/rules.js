// src/ai/tools/rules.js
//
// Rules made from a sentence and notices to people's phones (Pepper-first
// step 8B2, migration 286; shared/rules.js says what a rule is).
//
//   make_rule     reads the person's sentence into a rule (one askForJson()
//                 call, services/rules.js parseRule()) and shows it as a card;
//                 saved only on Confirm (the card pins the rule it showed).
//                 Refuses the never-list (money, pay, prices, allergens,
//                 deletions, a person). Undo (step 9a): deletes the rule if
//                 it hasn't run yet, else switches it off and says so
//                                                               reversible
//   list_rules    the group's rules, each in words, with its last run   read
//   change_rule   a rule changed in place, found by its name: its name,
//                 venue, conditions, the action's text, how often; the card
//                 shows it before and after (PATCH /api/ai/rules/:id, checked
//                 as a save is)                              consequential
//   switch_rule   a rule off or on (Undo switches it back)     reversible
//   delete_rule   a rule and its runs; what it did stays       destructive
//   send_notice   a short notice to the phones of the people with a role,
//                 or one person (the task notices' devices, services/notices.js);
//                 also what a rule runs for "ask the owner to approve"
//                                                               reversible
//
// Rules are set up with Manage on Pepper (ai_assistant), and a rule runs as
// the person who confirmed it, so they must be able to use its action
// themselves (checkRule()).

import { z } from 'zod'
import { withTenant } from '../../config/db.js'
import { ToolError, requireStaffPermission, staffReq, callApi } from '../context.js'
import { VenueText, venueFor, audited, plural, pickByName } from './util.js'
import { parseRule, checkRule, saveRule, listRules, ranCount, RuleSchema } from '../../services/rules.js'
import { ruleLines, editableRule, TRIGGERS, RULE_ACTIONS, MAX_PER_DAY, NEVER_WORDS } from '../../../../shared/rules.js'
import { PRICES_MODULE, seesPurchasingPrices } from '../../../../shared/procurement.js'
import { levelsForUser } from '../../middleware/auth.js'
import { sendToDevices } from '../../services/notices.js'

const ROLES = ['owner', 'admin', 'operator', 'viewer']

// A service's refusal (an httpError) as the tool's own, with its words.
async function asTool(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ToolError || !err?.statusCode) throw err
    throw new ToolError(err.message, err.statusCode)
  }
}

async function rulePlan(ctx, input) {
  return asTool(async () => {
    const rule = input.rule || (await parseRule({ tenantId: ctx.tenantId, person: ctx.principal, sentence: input.sentence })).rule
    const { venue } = await checkRule(staffReq(ctx), rule)
    return { rule, venue }
  })
}

/** The people a notice goes to: a role (owner, admin, operator, viewer, or the group's own role by name) or one person. */
async function recipients(ctx, to) {
  const want = to.trim().toLowerCase().replace(/^(the|our|all|every)\s+/, '').replace(/s$/, '')
  return withTenant(ctx.tenantId, async tx => {
    const people = await tx`
      SELECT u.id, u.auth0_user_id AS sub, COALESCE(u.full_name, u.email) AS name, u.email, u.role, r.label AS role_name
        FROM users u
        LEFT JOIN tenant_roles r ON r.id = u.custom_role_id AND r.tenant_id = u.tenant_id AND r.is_active
       WHERE u.tenant_id = ${ctx.tenantId} AND u.is_active AND u.auth0_user_id IS NOT NULL`
    let picked = people.filter(p => ROLES.includes(want) ? p.role === want : (p.role_name || '').toLowerCase().replace(/s$/, '') === want)
    if (!picked.length) {
      picked = people.filter(p => (p.name || '').toLowerCase() === to.trim().toLowerCase() || (p.email || '').toLowerCase() === to.trim().toLowerCase())
    }
    if (!picked.length) {
      const named = people.filter(p => (p.name || '').toLowerCase().includes(to.trim().toLowerCase()))
      if (named.length === 1) picked = named
    }
    if (!picked.length) throw new ToolError('Nobody here is "' + to + '": name a role (owner, admin, operator) or a person on the team.', 404)
    const devices = await tx`
      SELECT id, user_sub, kind, token FROM push_devices
       WHERE tenant_id = ${ctx.tenantId} AND user_sub = ANY(${picked.map(p => p.sub)}::text[])`
    return picked.map(p => ({ ...p, devices: devices.filter(d => d.user_sub === p.sub) }))
  })
}

/** One of the group's rules, by its name (or the id a card pinned). */
async function findRule(ctx, text) {
  const rules = await listRules(ctx.tenantId)
  return pickByName(rules, text, r => r.name, 'rule', 'There are no rules yet: make_rule makes one from a sentence.')
}

const RuleRef = z.string().trim().min(1).max(120).describe('The rule\'s name, as list_rules gives it')
const ALL_VENUES = /^(any|all|every)( venues?)?$|^everywhere$/i

/**
 * The rule with the person's changes: a new name, venue ("every venue" for all), conditions
 * (null takes one off), the action's text fields (null clears one) and how often. Numbers and
 * yes / no are read by the condition's type; everything is checked again by the route.
 */
async function changedRule(ctx, was, input) {
  const rule = editableRule(was)
  if (input.name) rule.name = input.name
  if (input.venue != null) rule.venue_id = ALL_VENUES.test(input.venue.trim()) ? null : (await venueFor(ctx, input.venue)).id
  const t = TRIGGERS[rule.trigger]
  for (const [k, v] of Object.entries(input.conditions || {})) {
    const d = t.conditions[k]
    if (!d) throw new ToolError('"' + k + '" isn\'t something this rule can check. It can check: ' + Object.entries(t.conditions).map(([c, x]) => c + ' (' + x.label + ')').join(', ') + '.', 422)
    if (v === null || v === '') { delete rule.conditions[k]; continue }
    if (d.type === 'number') rule.conditions[k] = typeof v === 'number' ? v : Number(String(v).replace(/[£°c\s,]/gi, ''))
    else if (d.type === 'yesno') rule.conditions[k] = typeof v === 'boolean' ? v : /^(yes|true|y)$/i.test(String(v))
    else rule.conditions[k] = String(v)
  }
  const a = RULE_ACTIONS[rule.action_tool]
  for (const [k, v] of Object.entries(input.text || {})) {
    if (!a.fields[k]) throw new ToolError(a.label + ' has no "' + k + '". It has: ' + Object.keys(a.fields).join(', ') + '.', 422)
    if (v === null || v === '') delete rule.action_input[k]
    else rule.action_input[k] = v
  }
  if (input.per_day != null) rule.per_day = input.per_day
  return rule
}

const onWords = on => (on ? 'On: runs by itself' : 'Off: doesn\'t run')

export { ruleTools as tools }
export const order = 147
export const sections = {
  rules: { label: 'Rules made from a sentence, and notices to the team\'s phones', modules: ['ai_assistant'] },
}
export const promptLines = [
  'Rules: make_rule turns the person\'s sentence into a rule the app runs by itself ("when a fridge reads above 8, add ' +
    'an H&S action for the manager", "when a supplier order is over 500, ask the owner to approve"): pass their words as ' +
    'they said them; the card shows the rule and it is kept only on Confirm. A rule can only add an H&S action or send a ' +
    'notice, never ' + NEVER_WORDS + '. list_rules lists them; change_rule changes one in place (name, venue, conditions, ' +
    'the action\'s text, how often), switch_rule switches one off or on, delete_rule deletes one. send_notice sends a short ' +
    'notice to the phones of a role or a person.',
]

export const ruleTools = [
  {
    name: 'make_rule',
    // Reversible since step 9a: a rule only ever runs reversible actions, and Undo takes it away
    // (deleted if it hasn't run yet, else switched off so its runs stay on record).
    class: 'reversible',
    title: 'Make a rule',
    activity: 'Read the rule',
    description:
      'Makes a rule the app runs by itself, from the person\'s sentence: when something happens (a fridge or freezer ' +
      'reading is logged, a supplier order is placed, a task on Today is late, a review is recorded), if conditions hold ' +
      '(reads above 8, over £500, at a venue, 2 stars or fewer), then add an H&S action or send a notice to a role or a ' +
      'person (at most a few times a day). sentence: their words, as they said them. Never for ' + NEVER_WORDS + ': ' +
      'those are refused. The card shows the rule as read; it is saved only when they confirm.',
    input: z.object({
      sentence: z.string().trim().min(8).max(500),
      rule: RuleSchema.optional().describe('Never set: the card pins the rule it read from the sentence'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      // The card always shows the sentence as the reader read it: a rule the model wrote
      // itself (ids, its own conditions) is never shown or saved. Confirm runs the pinned one.
      const { rule, venue } = await rulePlan(ctx, { sentence: input.sentence })
      return {
        title: 'Make the rule "' + rule.name + '"?',
        lines: ruleLines(rule, { venueName: venue?.name }),
        warningTitle: 'Runs by itself',
        warnings: ['It runs as you, with your access, each time it holds (at most ' + rule.per_day + ' a day). Switch it off or delete it in Settings.'],
        confirmLabel: 'Make rule',
        pin: { rule },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      return audited(ctx, 'make_rule', { sentence: input.sentence }, async () => {
        const { rule } = await rulePlan(ctx, input)
        const saved = await asTool(() => saveRule(staffReq(ctx), rule, input.sentence))
        return {
          rule: saved.name, lines: saved.lines, message: 'The rule is on. Switch it off or delete it in Settings.',
          _undo: { id: saved.id, name: saved.name },
        }
      })
    },
    // Undo: the rule goes if it hasn't run yet; once it has, it is switched off instead (its runs
    // stay on record) and the message says so.
    async inverse(ctx, undo) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      const [r] = await listRules(ctx.tenantId, undo.id)
      if (!r) return { message: 'The rule "' + undo.name + '" was already deleted.' }
      const ran = await ranCount(ctx.tenantId, r.id)
      if (!ran) {
        await callApi(ctx, 'DELETE', '/api/ai/rules/' + r.id)
        return { message: 'The rule "' + r.name + '" is deleted.' }
      }
      await callApi(ctx, 'PATCH', '/api/ai/rules/' + r.id, { body: { enabled: false } })
      return {
        message: 'The rule "' + r.name + '" had already run ' + plural(ran, 'time') + ', so it is switched off rather than ' +
          'deleted (what it did stays). Delete it in Settings if it should go.',
      }
    },
  },

  {
    name: 'list_rules',
    activity: 'Looked at the rules',
    title: 'The group\'s rules',
    description: 'The group\'s rules, each in words (when, if, then, how often), whether it is on, and its last run.',
    input: z.object({}),
    readOnly: true,
    async run(ctx) {
      await requireStaffPermission(ctx, 'ai_assistant', 'view')
      const rules = await listRules(ctx.tenantId)
      return {
        rules: rules.map(r => ({
          name: r.name, on: r.enabled, rule: r.lines,
          ...(r.last_run ? { last_run: r.last_run.status + (r.last_run.message ? ': ' + r.last_run.message : '') } : {}),
        })),
        ...(rules.length ? {} : { note: 'No rules yet. make_rule makes one from a sentence.' }),
      }
    },
  },

  {
    name: 'change_rule',
    class: 'consequential',
    title: 'Change a rule',
    activity: 'Changed a rule',
    description:
      'Changes one of the group\'s rules in place, found by its name (list_rules): its name, venue ("every venue" for all), ' +
      'conditions (by key, e.g. above, below, over, supplier, stars_at_most; null takes one off), the action\'s text ' +
      '(task, details, priority, assigned_to for an H&S action; to, title, text for a notice; {words} from the trigger ' +
      'work as when it was made) and how many times a day at most. What happens and what it does stay; for another ' +
      'trigger or action make a new rule. It keeps its runs and still runs as the person who made it.',
    input: z.object({
      rule: RuleRef,
      name: z.string().trim().min(1).max(80).optional().describe('A new name'),
      venue: z.string().trim().max(120).optional().describe('A venue\'s name, or "every venue"'),
      conditions: z.record(z.string(), z.union([z.number(), z.boolean(), z.string().max(80), z.null()])).optional(),
      text: z.record(z.string(), z.union([z.string().max(1000), z.null()])).optional().describe('The action\'s text fields to change'),
      per_day: z.number().int().min(1).max(MAX_PER_DAY).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      const was = await findRule(ctx, input.rule)
      const rule = await changedRule(ctx, was, input)
      const { venue } = await asTool(() => checkRule(staffReq(ctx), rule))
      const before = was.lines
      const after = ruleLines(rule, { venueName: venue?.name })
      return {
        title: 'Change the rule "' + was.name + '"?',
        lines: [...(rule.name !== was.name ? ['Named "' + rule.name + '"'] : []), 'Runs as ' + (was.created_by_name || 'the person who made it')],
        before, after,
        ...(JSON.stringify(before) === JSON.stringify(after) && rule.name === was.name ? { warningTitle: 'Check', warnings: ['Nothing changes.'] } : {}),
        confirmLabel: 'Change rule',
        pin: { rule: was.id },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      const { rule: _ref, ...changes } = input
      return audited(ctx, 'change_rule', changes, async () => {
        const was = await findRule(ctx, input.rule)
        const rule = await changedRule(ctx, was, input)
        const saved = await callApi(ctx, 'PATCH', '/api/ai/rules/' + was.id, { body: { rule } })
        return { rule: saved.name, lines: saved.lines, message: 'The rule is changed.' }
      })
    },
  },

  {
    name: 'switch_rule',
    class: 'reversible',
    title: 'Switch a rule off or on',
    activity: 'Switched a rule',
    description: 'Switches one of the group\'s rules off (on false) or back on (on true), found by its name. Nothing else changes.',
    input: z.object({ rule: RuleRef, on: z.boolean() }),
    confirm: true,
    async inverse(ctx, undo) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      const r = await callApi(ctx, 'PATCH', '/api/ai/rules/' + undo.id, { body: { enabled: undo.enabled } })
      return { message: 'The rule "' + r.name + '" is ' + (r.enabled ? 'on' : 'off') + ' again.' }
    },
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      const r = await findRule(ctx, input.rule)
      return {
        title: (input.on ? 'Switch on' : 'Switch off') + ' the rule "' + r.name + '"?',
        lines: r.lines,
        before: [onWords(r.enabled)], after: [onWords(input.on)],
        ...(r.enabled === input.on ? { warningTitle: 'Check', warnings: ['It is already ' + (r.enabled ? 'on' : 'off') + '.'] } : {}),
        confirmLabel: input.on ? 'Switch on' : 'Switch off',
        pin: { rule: r.id },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      return audited(ctx, 'switch_rule', { on: input.on }, async () => {
        const r = await findRule(ctx, input.rule)
        const saved = await callApi(ctx, 'PATCH', '/api/ai/rules/' + r.id, { body: { enabled: input.on } })
        return {
          rule: saved.name, on: saved.enabled, message: saved.enabled ? 'The rule is on.' : 'The rule is off.',
          _undo: { id: r.id, enabled: r.enabled },
        }
      })
    },
  },

  {
    name: 'delete_rule',
    class: 'destructive',
    title: 'Delete a rule',
    activity: 'Deleted a rule',
    description: 'Deletes one of the group\'s rules and its record of runs, found by its name. What it already did (H&S actions, notices) stays. Switching it off (switch_rule) keeps it.',
    input: z.object({ rule: RuleRef }),
    confirm: true,
    destructive: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      const r = await findRule(ctx, input.rule)
      return {
        title: 'Delete the rule "' + r.name + '"?',
        lines: [...r.lines, 'This can\'t be undone. What it already did stays; switching it off keeps it instead.'],
        confirmLabel: 'Delete it',
        pin: { rule: r.id },
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      return audited(ctx, 'delete_rule', {}, async () => {
        const r = await findRule(ctx, input.rule)
        await callApi(ctx, 'DELETE', '/api/ai/rules/' + r.id)
        return { deleted: r.name, message: 'The rule is deleted.' }
      })
    },
  },

  {
    name: 'send_notice',
    class: 'reversible',
    title: 'Send a notice',
    description:
      'Sends a short notice to the phones of the people with a role (owner, admin, operator, or the group\'s own role ' +
      'by name) or of one person on the team, where they have the app\'s notices on. For "tell the owner...", "ask the ' +
      'owner to approve...". Says how many it reached.',
    input: z.object({
      to: z.string().trim().min(2).max(100).describe('A role (owner, admin, operator) or a person\'s name'),
      title: z.string().trim().min(2).max(100),
      text: z.string().trim().max(300).optional(),
      venue: VenueText.optional().describe('The venue it is about, when there is one'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      const people = await recipients(ctx, input.to)
      const venue = input.venue ? await venueFor(ctx, input.venue) : null
      const on = people.filter(p => p.devices.length)
      return {
        title: 'Send this notice?',
        lines: [
          input.title, ...(input.text ? [input.text] : []), ...(venue ? [venue.name] : []),
          'To ' + people.map(p => p.name).join(', ') + ' (' + plural(on.length, 'person', 'people') + ' with notices on)',
        ],
        confirmLabel: 'Send',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      return audited(ctx, 'send_notice', { to: input.to, title: input.title, text: input.text ?? null }, async () => {
        const people = await recipients(ctx, input.to)
        const venue = input.venue ? await venueFor(ctx, input.venue) : null
        const payload = {
          title: input.title,
          body: [venue?.name, input.text].filter(Boolean).join(' · '),
          url: '/', tag: 'notice:' + Date.now(),
        }
        // A rule's notice that carries an order's total (ruleRunner.js sets ctx.withoutPrices) goes
        // without it to people who can't see purchasing prices (the purchasing routes' one rule).
        const plain = ctx.withoutPrices
          ? { ...payload, title: ctx.withoutPrices.title ?? payload.title, body: [venue?.name, ctx.withoutPrices.text].filter(Boolean).join(' · ') }
          : null
        let reached = 0
        for (const p of people) {
          const sees = !plain || seesPurchasingPrices((await levelsForUser(ctx.tenantId, p.id, [PRICES_MODULE]))[PRICES_MODULE])
          reached += await sendToDevices(ctx.tenantId, p.devices, sees ? payload : plain).catch(() => 0)
        }
        const on = people.filter(p => p.devices.length).length
        return {
          to: people.map(p => p.name), reached,
          message: on ? 'Sent to ' + plural(on, 'person', 'people') + ' (' + plural(reached, 'phone') + ').'
            : 'Nobody of ' + input.to + ' has the app\'s notices on, so it reached no one.',
        }
      })
    },
  },
]
