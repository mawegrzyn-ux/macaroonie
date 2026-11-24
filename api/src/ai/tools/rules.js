// src/ai/tools/rules.js
//
// Rules made from a sentence and notices to people's phones (Pepper-first
// step 8B2, migration 286; shared/rules.js says what a rule is).
//
//   make_rule     reads the person's sentence into a rule (one askForJson()
//                 call, services/rules.js parseRule()) and shows it as a card;
//                 saved only on Confirm (the card pins the rule it showed).
//                 Refuses the never-list (money, pay, prices, allergens,
//                 deletions, a person)                         consequential
//   list_rules    the group's rules, each in words, with its last run   read
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
import { ToolError, requireStaffPermission, staffReq } from '../context.js'
import { VenueText, venueFor, audited, plural } from './util.js'
import { parseRule, checkRule, saveRule, listRules, RuleSchema } from '../../services/rules.js'
import { ruleLines, NEVER_WORDS } from '../../../../shared/rules.js'
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

export { ruleTools as tools }
export const order = 147
export const sections = {
  rules: { label: 'Rules made from a sentence, and notices to the team\'s phones', modules: ['ai_assistant'] },
}
export const promptLines = [
  'Rules: make_rule turns the person\'s sentence into a rule the app runs by itself ("when a fridge reads above 8, add ' +
    'an H&S action for the manager", "when a supplier order is over 500, ask the owner to approve"): pass their words as ' +
    'they said them; the card shows the rule and it is kept only on Confirm. A rule can only add an H&S action or send a ' +
    'notice, never ' + NEVER_WORDS + '. list_rules lists them. send_notice sends a short notice to the phones of a role or a person.',
]

export const ruleTools = [
  {
    name: 'make_rule',
    class: 'consequential',
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
      rule: RuleSchema.optional().describe('Leave out: the card pins the rule it showed'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'ai_assistant', 'manage')
      const { rule, venue } = await rulePlan(ctx, input)
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
        return { rule: saved.name, lines: saved.lines, message: 'The rule is on. Switch it off or delete it in Settings.' }
      })
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
        let reached = 0
        for (const p of people) reached += await sendToDevices(ctx.tenantId, p.devices, payload).catch(() => 0)
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
