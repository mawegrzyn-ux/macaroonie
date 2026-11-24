// src/routes/captures.js
//
// /api/ai/captures: capture to For review (Pepper-first step 6b, migration
// 281). A photo, a voice note's words or a typed line, kept with who, when and
// the venue, waiting on For review (GET /api/ai/review lists them through
// waitingCaptures()). No model call when it is made.
//
//   POST /                 multipart (file, venue_id, note): a photo, through
//                          the chat's own upload checks (saveUpload(): what the
//                          file really is, MAX_BYTES). JSON { venue_id, kind:
//                          'voice' | 'text', note }: words.
//   GET  /:id/photo        the photo, to whoever may see the capture
//   POST /:id/open         Open in Pepper: the photo copied as the opener's own
//                          unsent chat file, and the words for the first message
//                          ({ text, files }); the chat sends them (that is the
//                          model call). The capture is then opened.
//   POST /:id/dismiss      off the list, with who and when
//
// Who sees a capture: the account that made it, and anyone who manages Pepper
// (ai_assistant Manage). Needs access to Pepper (View) to make one.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, permissionLevel } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { whoDid } from '../middleware/sharedDevice.js'
import { saveUpload, MAX_BYTES } from '../ai/attachments.js'
import { ToolError } from '../ai/context.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'

export const NOTE_MAX = 2000
const MAX_UPLOAD = MAX_BYTES.image
const KIND_WORDS = { photo: 'A photo', voice: 'A voice note', text: 'A note' }

const WordsBody = z.object({
  venue_id: z.string().uuid(),
  kind:     z.enum(['voice', 'text']),
  note:     z.string().trim().min(1, 'Say or type something first').max(NOTE_MAX),
})

/** "Mon 23 Nov, 14:05" at the venue. */
function whenText(at, timeZone) {
  try {
    return new Date(at).toLocaleString('en-GB', { timeZone: timeZone || 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  }
}

async function mustUsePepper(req) {
  if (!req.tenantId) throw httpError(400, 'Choose a restaurant group first')
  const level = await permissionLevel(req, 'ai_assistant')
  if (level === 'none') throw httpError(403, 'You don\'t have access to ' + ASSISTANT_NAME + '.')
  return level
}

async function personName(req) {
  if (req.acting) return req.acting.name
  const [u] = await withTenant(req.tenantId, tx => tx`
    SELECT full_name, email FROM users WHERE tenant_id = ${req.tenantId} AND auth0_user_id = ${req.user.sub} LIMIT 1`)
  return (u?.full_name || '').trim() || u?.email || req.user.email || null
}

/** A capture this person may see, or a 404 (another group's, or someone else's without Manage). */
async function visibleCapture(req, id) {
  const level = await mustUsePepper(req)
  const ok = z.string().uuid().safeParse(id)
  if (!ok.success) throw httpError(404, 'Capture not found')
  const [c] = await withTenant(req.tenantId, tx => tx`
    SELECT c.*, v.name AS venue_name, v.timezone FROM ai_captures c
      JOIN venues v ON v.id = c.venue_id AND v.tenant_id = c.tenant_id
     WHERE c.id = ${ok.data} AND c.tenant_id = ${req.tenantId}`)
  if (!c || (c.user_sub !== req.user.sub && level !== 'manage')) throw httpError(404, 'Capture not found')
  return c
}

/** The waiting captures this person may see, as For review items (GET /api/ai/review). */
export async function waitingCaptures(req) {
  const level = await permissionLevel(req, 'ai_assistant')
  if (level === 'none') return null
  const rows = await withTenant(req.tenantId, tx => tx`
    SELECT c.id, c.kind, c.note, c.venue_id, v.name AS venue_name, c.person_name, c.created_at,
           c.attachment_id IS NOT NULL AS has_photo, d.name AS device_name
      FROM ai_captures c
      JOIN venues v ON v.id = c.venue_id AND v.tenant_id = c.tenant_id
      LEFT JOIN shared_devices d ON d.id = c.shared_device_id AND d.tenant_id = c.tenant_id
     WHERE c.tenant_id = ${req.tenantId} AND c.status = 'waiting'
       AND (${level === 'manage'} OR c.user_sub = ${req.user.sub})
     ORDER BY c.created_at DESC
     LIMIT 100`)
  return rows.map(c => ({
    kind: 'capture', id: c.id, capture: c.kind, label: 'Capture',
    title: KIND_WORDS[c.kind] + ' for ' + c.venue_name,
    lines: c.note ? [String(c.note).slice(0, 500)] : [],
    source: 'Captured by ' + (c.person_name || 'someone') + (c.device_name ? ' on ' + c.device_name : '') + ', not read by ' + ASSISTANT_NAME + ' yet',
    venue_id: c.venue_id, at: c.created_at, photo: c.has_photo ? '/ai/captures/' + c.id + '/photo' : null,
    together: false,
  }))
}

export default async function captureRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/', async (req, reply) => {
    await mustUsePepper(req)
    let venueId, note = null, kind, file = null
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file') { part.file.resume(); continue }
          const chunks = []
          let total = 0
          for await (const chunk of part.file) {
            total += chunk.length
            if (total > MAX_UPLOAD) throw httpError(413, 'Photos can be up to ' + Math.round(MAX_UPLOAD / 1024 / 1024) + ' MB.')
            chunks.push(chunk)
          }
          file = { buffer: Buffer.concat(chunks), filename: part.filename }
        } else if (part.fieldname === 'venue_id') venueId = String(part.value)
        else if (part.fieldname === 'note') note = String(part.value).trim().slice(0, NOTE_MAX) || null
      }
      if (!file) throw httpError(400, 'No photo was sent')
      kind = 'photo'
    } else {
      const body = WordsBody.safeParse(req.body ?? {})
      if (!body.success) throw httpError(422, body.error.issues[0].message)
      ;({ venue_id: venueId, kind, note } = body.data)
    }
    if (!z.string().uuid().safeParse(venueId).success) throw httpError(422, 'Pick a venue')
    const [venue] = await withTenant(req.tenantId, tx => tx`SELECT id, name FROM venues WHERE id = ${venueId} AND tenant_id = ${req.tenantId}`)
    if (!venue) throw httpError(404, 'Venue not found')
    let attachment = null
    if (file) {
      try {
        attachment = await saveUpload({ tenantId: req.tenantId, userSub: req.user.sub, ...file })
      } catch (err) {
        if (err instanceof ToolError) throw httpError(err.status || 422, err.message)
        throw err
      }
      if (attachment.kind !== 'image') throw httpError(422, 'A capture is a photo (JPEG, PNG, GIF or WebP).')
    }
    const name = await personName(req)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO ai_captures (tenant_id, venue_id, kind, note, attachment_id, user_sub, person_name, shared_device_id)
      VALUES (${req.tenantId}, ${venue.id}, ${kind}, ${note}, ${attachment?.id ?? null}, ${req.user.sub}, ${name},
              ${req.sharedDevice?.id ?? null})
      RETURNING id, kind, note, venue_id, person_name, created_at, status`)
    return reply.code(201).send({ ...row, venue_name: venue.name, has_photo: !!attachment })
  })

  app.get('/:id/photo', async (req, reply) => {
    const c = await visibleCapture(req, req.params.id)
    if (!c.attachment_id) throw httpError(404, 'This capture has no photo')
    const [file] = await withTenant(req.tenantId, tx => tx`
      SELECT media_type, data FROM ai_attachments WHERE id = ${c.attachment_id} AND tenant_id = ${req.tenantId}`)
    if (!file) throw httpError(404, 'Photo not found')
    return reply
      .header('Content-Type', file.media_type)
      .header('Cache-Control', 'private, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .send(file.data)
  })

  app.post('/:id/open', async req => {
    const c = await visibleCapture(req, req.params.id)
    if (c.status === 'dismissed') throw httpError(409, 'This capture was dismissed.')
    return withTenant(req.tenantId, async tx => {
      let files = []
      if (c.attachment_id) {
        // The opener's own unsent copy, so the chat attaches it the usual way (claimAttachments()).
        const [copy] = await tx`
          INSERT INTO ai_attachments (tenant_id, user_sub, kind, media_type, filename, bytes, data)
          SELECT tenant_id, ${req.user.sub}, kind, media_type, filename, bytes, data
            FROM ai_attachments WHERE id = ${c.attachment_id} AND tenant_id = ${req.tenantId}
          RETURNING id, kind, media_type, filename, bytes`
        if (copy) files = [{ id: copy.id, name: copy.filename, kind: copy.kind, media_type: copy.media_type, bytes: copy.bytes }]
      }
      await tx`
        UPDATE ai_captures SET status = 'opened', handled_at = now(), handled_by = ${whoDid(req)}
         WHERE id = ${c.id} AND tenant_id = ${req.tenantId}`
      const when = whenText(c.created_at, c.timezone)
      const text = KIND_WORDS[c.kind] + ' captured for ' + c.venue_name + ' by ' + (c.person_name || 'someone') +
        ' (' + when + ')' + (c.note ? ': "' + c.note + '"' : '') + '. What does it need?'
      return { text, files }
    })
  })

  app.post('/:id/dismiss', async req => {
    const c = await visibleCapture(req, req.params.id)
    await withTenant(req.tenantId, tx => tx`
      UPDATE ai_captures SET status = 'dismissed', handled_at = now(), handled_by = ${whoDid(req)}
       WHERE id = ${c.id} AND tenant_id = ${req.tenantId}`)
    return { ok: true }
  })
}
