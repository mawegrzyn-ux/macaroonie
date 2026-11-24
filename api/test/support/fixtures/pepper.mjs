// Pepper: an access token for the connectors, the AI settings, a chat
// with a message and a card waiting for an answer (written here: chats only
// come from the model), a form draft (migration 275) and a capture (281).
import { sql } from '../app.mjs'
import { MONDAY } from './parts.mjs'

export const order = 220

export async function fill(ctx) {
  const { mark, sub, tenantId, step, post, patch, put, get, V } = ctx
  // A field of the group's own on suppliers (migration 285), and its value on one.
  const field = await step('custom field', () => post('/api/custom-fields', { object_key: 'purchasing.suppliers', label: 'Payment terms', type: 'choice', options: ['7 days', '30 days'] }))
  if (field) {
    const sups = await step('suppliers for a custom value', () => get('/api/suppliers'))
    if (sups?.[0]) await step('custom value', () => patch('/api/suppliers/' + sups[0].id, { custom: { [field.field_key]: '30 days' } }))
  }
  await step('access token', () => post('/api/ai/tokens', { name: mark + ' Claude Code' }))
  await step('form draft', () => put('/api/form-drafts', { form: 'delivery', venue_id: V, day: MONDAY, values: { supplier: mark + ' Fresh Co', notes: mark + ' two boxes short' } }))
  await step('ai settings', () => patch('/api/ai/settings', { guest_chat_enabled: false, chat_retention_days: 90 }))
  // A capture waiting on For review (migration 281): words, no model call.
  await step('capture', () => post('/api/ai/captures', { venue_id: V, kind: 'text', note: mark + ' bread short by 14 loaves' }))
  const [conv] = await sql`
    INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, system_prompt, title, model_tier)
    VALUES (${tenantId}, 'staff_chat', ${sub}, ${sub + '@test.local'}, 'test', ${mark + ' chat'}, 'fast') RETURNING id
  `
  await sql`INSERT INTO ai_messages (conversation_id, tenant_id, seq, role, content) VALUES (${conv.id}, ${tenantId}, 1, 'user', ${sql.json([{ type: 'text', text: mark + ' hello' }])})`
  // One model request (migration 271): written by addUsage() after a model call.
  await sql`INSERT INTO ai_requests (tenant_id, channel, use, model, input_tokens, output_tokens, units, cost_usd, ms)
            VALUES (${tenantId}, 'staff_chat', 'chat', 'claude-sonnet-5-5', 1200, 80, 3400, 0.0032, 1800)`
  await sql`INSERT INTO ai_pending_actions (tenant_id, conversation_id, tool_use_id, tool, input, card, expires_at)
            VALUES (${tenantId}, ${conv.id}, 'toolu_x', 'set_rota', ${sql.json({})}, ${sql.json({ title: mark + ' card', lines: [] })}, now() + interval '30 minutes')`
}
