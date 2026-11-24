// src/ai/ruleRunner.js
//
// Firing the group's rules (Pepper-first step 8B2, migration 286; what a rule
// is: shared/rules.js). The routes and sweeps that already make the events
// call fireRules() after their own change is saved, without waiting for it
// (a rule never slows or fails the change that set it off):
//
//   fridge_reading   POST /api/food-safety/temp-logs        (routes/foodSafety.js)
//   supplier_order   POST /api/purchasing/orders/:id/submit (routes/purchasing.js)
//   task_late        the task notices sweep                 (services/notices.js)
//   review_low       POST /api/reviews and /reviews/record  (routes/reviews.js)
//
//   fireRulesLater(app, tenantId, event, log)   the same, not waited for (routes)
//   fireRules(app, tenantId, event, log)
//     event: { trigger, key, day, venue_id, venue, ...the trigger's fields }
//     key: what makes the event itself (a reading's id), so a rule runs once
//     for it whichever process sees it. For each enabled rule of the trigger
//     whose conditions hold: claimed (pepper_rule_firings, one row per rule
//     and event), capped at per_day runs on the event's day ('capped'), else
//     its action runs as a system action: the tool's own run(), as the person
//     who confirmed the rule (their permissions now, through the same routes
//     as the page), named in the audit (ai_actions.rule_id, actor "Rule: ...").
//     Only a reversible tool ever runs (checked again here). -> [{ rule, status }]
//
// It loads Pepper's tools when it runs (tools/index.js): nothing here is
// imported by a tool file.

import { withTenant } from '../config/db.js'
import { INTERNAL_AS_PREFIX } from '../middleware/auth.js'
import { makeContext } from './context.js'
import { matches, fillInput, RULE_ACTIONS } from '../../../shared/rules.js'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }

/** fireRules() without waiting: what a route calls after its change is saved (never awaited, never throws). */
export function fireRulesLater(app, tenantId, event, log = quiet) {
  fireRules(app, tenantId, event, log).catch(err => log.warn?.({ tenantId, err: err?.message }, 'Rules failed'))
}

export async function fireRules(app, tenantId, event, log = quiet) {
  if (!tenantId || !event?.trigger || !event.key) return []
  const rules = await withTenant(tenantId, tx => tx`
    SELECT r.id, r.name, r.trigger, r.conditions, r.venue_id, r.action_tool, r.action_input, r.per_day,
           u.id AS user_id, u.auth0_user_id, u.email
      FROM pepper_rules r
      LEFT JOIN users u ON u.id = r.created_by AND u.tenant_id = r.tenant_id AND u.is_active
     WHERE r.tenant_id = ${tenantId} AND r.trigger = ${event.trigger} AND r.enabled`)
  const out = []
  for (const rule of rules.filter(r => matches(r, event))) {
    try {
      out.push({ rule: rule.id, status: await fireOne(app, tenantId, rule, event, log) })
    } catch (err) {
      log.warn?.({ tenantId, rule: rule.id, err: err?.message }, 'A rule failed')
      out.push({ rule: rule.id, status: 'failed' })
    }
  }
  return out
}

async function fireOne(app, tenantId, rule, event, log) {
  const eventKey = String(event.trigger + ':' + event.key).slice(0, 200)
  // Claimed once per rule and event, then counted against the day's cap in
  // the same transaction (one per rule at a time, so two processes can't both
  // pass it).
  const claim = await withTenant(tenantId, async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${'rule:' + rule.id}))`
    const [row] = await tx`
      INSERT INTO pepper_rule_firings (tenant_id, rule_id, event_key, day, status)
      VALUES (${tenantId}, ${rule.id}, ${eventKey}, ${event.day}, 'running')
      ON CONFLICT (rule_id, event_key) DO NOTHING
      RETURNING id`
    if (!row) return null
    const [{ n }] = await tx`
      SELECT count(*)::int AS n FROM pepper_rule_firings
       WHERE tenant_id = ${tenantId} AND rule_id = ${rule.id} AND day = ${event.day}
         AND status IN ('done', 'failed', 'running') AND id <> ${row.id}`
    if (n >= rule.per_day) {
      await tx`UPDATE pepper_rule_firings SET status = 'capped', result = ${tx.json({ message: 'Already ran ' + n + ' times that day (its most)' })}
                WHERE id = ${row.id} AND tenant_id = ${tenantId}`
      return { id: row.id, capped: true }
    }
    return { id: row.id }
  })
  if (!claim) return 'already'
  if (claim.capped) return 'capped'

  const finish = (status, result) => withTenant(tenantId, tx => tx`
    UPDATE pepper_rule_firings SET status = ${status}, result = ${tx.json(result)}
     WHERE id = ${claim.id} AND tenant_id = ${tenantId}`)
  if (!rule.user_id || !rule.auth0_user_id) {
    await finish('failed', { message: 'The person who made the rule is no longer on the team: make it again.' })
    return 'failed'
  }
  const { findTool, parseInput, classFor } = await import('./tools/index.js')
  const tool = findTool({ channel: 'staff_chat' }, rule.action_tool)
  const input = fillInput(rule, event)
  // Checked again when it runs: only a reversible tool, never the never-list.
  if (!RULE_ACTIONS[rule.action_tool] || !tool || classFor(tool, input) !== 'reversible') {
    await finish('failed', { message: 'A rule can\'t run ' + rule.action_tool })
    return 'failed'
  }
  const ctx = makeContext({
    app, channel: 'staff_chat', tenantId, log,
    auth: { authorization: 'Bearer ' + INTERNAL_AS_PREFIX + rule.user_id },
    principal: { sub: rule.auth0_user_id, email: rule.email },
    actor: 'Rule: ' + rule.name,
    rule: { id: rule.id, name: rule.name },
  })
  try {
    const result = await tool.run(ctx, parseInput(tool, input))
    const { _undo, ...shown } = result || {}
    await finish('done', { message: String(shown.message || 'Done').slice(0, 300) })
    return 'done'
  } catch (err) {
    await finish('failed', { message: String(err?.message || 'Failed').slice(0, 300) })
    return 'failed'
  }
}
