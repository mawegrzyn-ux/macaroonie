// src/ai/erase.js
//
// Personal data in Pepper's records (migration 174).
//
// eraseFromAi(tx, tenantId, identifiers): part of a customer's GDPR erasure
// (POST /api/customers/:id/anonymise), inside its transaction. Every chat,
// staff or website, that mentions one of the guest's identifiers (their
// full name, email or phone as written: case ignored, whole words) has them
// replaced with [removed] in its messages, title and cards, its thinking
// blocks and attached files removed, its unanswered cards cancelled, and is
// closed (closed_reason 'erased'). A chat's history is replayed to the model
// exactly as stored, so one that has been edited can be read but not carried
// on. The audit (ai_actions) has the identifiers replaced in its input and
// result. A first name on its own, or a phone written another way, isn't
// matched.
//
// cleanUpAi(log): the hourly clean-up (jobs/queues.js). Chats idle longer
// than the tenant's chat_retention_days are deleted with their messages,
// cards and files; the audit's input and result are cleared after a year;
// unsent uploads go after a day, used or expired guest codes after a day,
// per-person usage after 400 days.

import { sql, systemSql, withTenant } from '../config/db.js'

const REMOVED = '[removed]'
const MIN_LENGTH = 3

/** The identifiers worth matching: trimmed, long enough, no repeats. */
function cleanIdentifiers(values) {
  const seen = new Set()
  const out = []
  for (const v of values) {
    const s = String(v ?? '').trim()
    if (s.length < MIN_LENGTH || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
  }
  return out
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function matcher(identifiers) {
  // Longest first, so "John Smith" goes before "John Smith's" partials.
  const alts = [...identifiers].sort((a, b) => b.length - a.length).map(escapeRe)
  return new RegExp('(?<![\\p{L}\\p{N}_])(?:' + alts.join('|') + ')(?![\\p{L}\\p{N}_])', 'giu')
}

/** Every string in a JSON value with the identifiers replaced. */
function scrub(value, re) {
  if (typeof value === 'string') return value.replace(re, REMOVED)
  if (Array.isArray(value)) return value.map(v => scrub(v, re))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, re)]))
  }
  return value
}

/** A stored message of an erased chat: no thinking, no files, identifiers out. */
function scrubMessage(content, re) {
  const blocks = Array.isArray(content) ? content : [content]
  const out = []
  for (const b of blocks) {
    if (!b || typeof b !== 'object') { out.push(scrub(b, re)); continue }
    if (b.type === 'thinking' || b.type === 'redacted_thinking') continue
    if (b._attachment) { out.push({ type: 'text', text: '[File removed]' }); continue }
    out.push(scrub(b, re))
  }
  return out
}

/** LIKE patterns for finding candidate rows by their JSON text. */
const likesOf = identifiers =>
  identifiers.map(s => '%' + JSON.stringify(s).slice(1, -1).replace(/[\\%_]/g, '\\$&') + '%')

export async function eraseFromAi(tx, tenantId, values) {
  const identifiers = cleanIdentifiers(values)
  if (!identifiers.length) return { chats: 0, actions: 0 }
  const re = matcher(identifiers)
  const likes = likesOf(identifiers)

  const convs = await tx`
    SELECT DISTINCT conversation_id AS id FROM ai_messages
     WHERE tenant_id = ${tenantId} AND content::text ILIKE ANY(${likes}::text[])
    UNION
    SELECT DISTINCT conversation_id FROM ai_pending_actions
     WHERE tenant_id = ${tenantId}
       AND (input::text ILIKE ANY(${likes}::text[]) OR card::text ILIKE ANY(${likes}::text[])
            OR COALESCE(result::text, '') ILIKE ANY(${likes}::text[]))
    UNION
    SELECT id FROM ai_conversations
     WHERE tenant_id = ${tenantId} AND COALESCE(title, '') ILIKE ANY(${likes}::text[])
  `
  // The search above matches text anywhere; a chat is only redacted and
  // closed when something in it matches as a whole word.
  const hit = v => v != null && JSON.stringify(scrub(v, re)) !== JSON.stringify(v)
  let chats = 0
  for (const { id } of convs) {
    const rows = await tx`
      SELECT seq, content FROM ai_messages WHERE conversation_id = ${id} AND tenant_id = ${tenantId} ORDER BY seq
    `
    const cards = await tx`
      SELECT id, input, card, result, status, decided_at FROM ai_pending_actions
       WHERE conversation_id = ${id} AND tenant_id = ${tenantId}
    `
    const [c] = await tx`SELECT title FROM ai_conversations WHERE id = ${id} AND tenant_id = ${tenantId}`
    if (!rows.some(r => hit(r.content)) && !cards.some(a => hit(a.input) || hit(a.card) || hit(a.result)) && !hit(c?.title)) continue
    chats++
    for (const r of rows) {
      await tx`
        UPDATE ai_messages SET content = ${tx.json(scrubMessage(r.content, re))}
         WHERE conversation_id = ${id} AND seq = ${r.seq} AND tenant_id = ${tenantId}
      `
    }
    for (const a of cards) {
      const open = a.status === 'pending' && !a.decided_at
      await tx`
        UPDATE ai_pending_actions
           SET input  = ${tx.json(scrub(a.input, re))},
               card   = ${tx.json(scrub(a.card, re))},
               result = ${open ? tx.json({ error: 'erased' }) : (a.result == null ? null : tx.json(scrub(a.result, re)))},
               status = ${open ? 'cancelled' : a.status},
               decided_at = ${open ? new Date() : a.decided_at}
         WHERE id = ${a.id} AND tenant_id = ${tenantId}
      `
    }
    await tx`DELETE FROM ai_attachments WHERE conversation_id = ${id} AND tenant_id = ${tenantId}`
    await tx`
      UPDATE ai_conversations
         SET title = ${c?.title ? scrub(c.title, re) : null},
             closed_at = COALESCE(closed_at, now()), closed_reason = 'erased'
       WHERE id = ${id} AND tenant_id = ${tenantId}
    `
  }

  const candidates = await tx`
    SELECT id, input, result FROM ai_actions
     WHERE tenant_id = ${tenantId}
       AND (COALESCE(input::text, '') ILIKE ANY(${likes}::text[]) OR COALESCE(result::text, '') ILIKE ANY(${likes}::text[]))
  `
  const actions = candidates.filter(a => hit(a.input) || hit(a.result))
  for (const a of actions) {
    await tx`
      UPDATE ai_actions
         SET input  = ${a.input == null ? null : tx.json(scrub(a.input, re))},
             result = ${a.result == null ? null : tx.json(scrub(a.result, re))},
             redacted_at = now()
       WHERE id = ${a.id} AND tenant_id = ${tenantId}
    `
  }
  return { chats, actions: actions.length }
}

// ── The hourly clean-up ──────────────────────────────────

export async function cleanUpAi(log) {
  const tenants = await systemSql`
    SELECT t.id, COALESCE(s.chat_retention_days, 90) AS days
      FROM tenants t LEFT JOIN ai_settings s ON s.tenant_id = t.id
  `
  const totals = { chats: 0, audit: 0, uploads: 0, codes: 0, usage: 0 }
  for (const t of tenants) {
    try {
      await withTenant(t.id, async tx => {
        const chats = await tx`
          DELETE FROM ai_conversations
           WHERE tenant_id = ${t.id} AND updated_at < now() - make_interval(days => ${t.days})
             AND (running_until IS NULL OR running_until < now())
          RETURNING id
        `
        const audit = await tx`
          UPDATE ai_actions SET input = '{}'::jsonb, result = NULL, redacted_at = now()
           WHERE tenant_id = ${t.id} AND created_at < now() - interval '365 days'
             AND (input IS DISTINCT FROM '{}'::jsonb OR result IS NOT NULL)
          RETURNING id
        `
        const uploads = await tx`
          DELETE FROM ai_attachments
           WHERE tenant_id = ${t.id} AND conversation_id IS NULL AND created_at < now() - interval '1 day'
          RETURNING id
        `
        const codes = await tx`
          DELETE FROM ai_booking_codes
           WHERE tenant_id = ${t.id} AND (used_at IS NOT NULL OR expires_at < now()) AND created_at < now() - interval '1 day'
          RETURNING id
        `
        await tx`DELETE FROM ai_booking_grants WHERE tenant_id = ${t.id} AND expires_at < now() - interval '1 day'`
        const usage = await tx`
          DELETE FROM ai_usage_people WHERE tenant_id = ${t.id} AND day < current_date - 400 RETURNING day
        `
        totals.chats += chats.length; totals.audit += audit.length; totals.uploads += uploads.length
        totals.codes += codes.length; totals.usage += usage.length
      })
    } catch (err) {
      log?.warn({ err, tenantId: t.id }, 'AI clean-up failed for a tenant')
    }
  }
  return totals
}
