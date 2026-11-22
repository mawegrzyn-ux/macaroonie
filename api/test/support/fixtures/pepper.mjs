// Pepper: an access token for the connectors, the AI settings, and a chat
// with a message and a card waiting for an answer (written here: chats only
// come from the model).
import { sql } from '../app.mjs'

export const order = 220

export async function fill(ctx) {
  const { mark, sub, tenantId, step, post, patch } = ctx
  await step('access token', () => post('/api/ai/tokens', { name: mark + ' Claude Code' }))
  await step('ai settings', () => patch('/api/ai/settings', { guest_chat_enabled: false, chat_retention_days: 90 }))
  const [conv] = await sql`
    INSERT INTO ai_conversations (tenant_id, channel, user_sub, user_email, system_prompt, title, model_tier)
    VALUES (${tenantId}, 'staff_chat', ${sub}, ${sub + '@test.local'}, 'test', ${mark + ' chat'}, 'fast') RETURNING id
  `
  await sql`INSERT INTO ai_messages (conversation_id, tenant_id, seq, role, content) VALUES (${conv.id}, ${tenantId}, 1, 'user', ${sql.json([{ type: 'text', text: mark + ' hello' }])})`
  await sql`INSERT INTO ai_pending_actions (tenant_id, conversation_id, tool_use_id, tool, input, card, expires_at)
            VALUES (${tenantId}, ${conv.id}, 'toolu_x', 'set_rota', ${sql.json({})}, ${sql.json({ title: mark + ' card', lines: [] })}, now() + interval '30 minutes')`
}
