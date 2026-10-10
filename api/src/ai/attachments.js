// src/ai/attachments.js
//
// Files attached in the staff AI chat (migration 150): photos and
// screenshots, PDFs and plain-text files. The flow:
//
//   1. POST /api/ai/attachments uploads one file: saveUpload() checks what
//      it really is (by its first bytes, not the name), stores it in
//      ai_attachments with no conversation yet, and returns its id.
//   2. POST /api/ai/chat sends the ids with the message: runTurn() calls
//      claimAttachments() (only the uploader's own unsent files, within the
//      per-message and per-conversation limits) and stores the message with
//      attachmentBlocks(): image / document blocks that carry a reference,
//      not the data.
//   3. Every request to the model fills the data back in (withFileData()
//      from the map loadAttachmentData() builds), so the history in
//      ai_messages stays small and each request carries the same bytes.
//
// Limits keep a whole conversation under the API's 32 MB request size:
// MAX_PER_MESSAGE files per message, MAX_PER_CONVERSATION and
// MAX_CONVERSATION_BYTES per conversation (base64 adds a third).

import { withTenant } from '../config/db.js'
import { ToolError } from './context.js'

export const MAX_PER_MESSAGE        = 5
export const MAX_PER_CONVERSATION   = 10
export const MAX_CONVERSATION_BYTES = 20 * 1024 * 1024
export const MAX_BYTES = {
  image: 5 * 1024 * 1024,
  pdf:   10 * 1024 * 1024,
  text:  1 * 1024 * 1024,
}
const UNSENT_HOURS = 24

const TEXT_EXTENSIONS = ['txt', 'csv', 'tsv', 'md', 'json', 'log']
const mb = n => Math.round(n / 1024 / 1024) + ' MB'

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b)

/** What a file is, from its first bytes (images, PDF) or its name (text). */
export function detectFile(buffer, filename = '') {
  if (startsWith(buffer, [0xFF, 0xD8, 0xFF])) return { kind: 'image', media_type: 'image/jpeg' }
  if (startsWith(buffer, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return { kind: 'image', media_type: 'image/png' }
  if (buffer.subarray(0, 6).toString('latin1') === 'GIF87a' || buffer.subarray(0, 6).toString('latin1') === 'GIF89a') {
    return { kind: 'image', media_type: 'image/gif' }
  }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { kind: 'image', media_type: 'image/webp' }
  }
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', media_type: 'application/pdf' }
  const ext = String(filename).toLowerCase().split('.').pop()
  if (TEXT_EXTENSIONS.includes(ext)) {
    // Text only: valid UTF-8 and no NUL bytes (a binary file renamed .txt).
    if (buffer.includes(0)) throw new ToolError('That file isn\'t plain text.', 422)
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      throw new ToolError('That text file isn\'t UTF-8. Save it as UTF-8 text or CSV and attach it again.', 422)
    }
    return { kind: 'text', media_type: 'text/plain' }
  }
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods'].includes(ext)) {
    throw new ToolError('The assistant can\'t read Word, Excel or PowerPoint files. Save it as a PDF (or a CSV for a spreadsheet) and attach that.', 422)
  }
  if (['heic', 'heif'].includes(ext)) {
    throw new ToolError('HEIC photos can\'t be read. Attach a JPEG or PNG, or take a screenshot of it.', 422)
  }
  throw new ToolError('Attach a photo or screenshot (JPEG, PNG, GIF, WebP), a PDF, or a text or CSV file.', 422)
}

const summary = r => ({ id: r.id, name: r.filename, kind: r.kind, media_type: r.media_type, bytes: r.bytes })

/** Stores one uploaded file, not yet in a conversation. */
export async function saveUpload({ tenantId, userSub, buffer, filename }) {
  if (!buffer?.length) throw new ToolError('That file is empty.', 422)
  const name = String(filename || 'file').replace(/[\r\n]/g, ' ').slice(0, 200)
  const { kind, media_type } = detectFile(buffer, name)
  if (buffer.length > MAX_BYTES[kind]) {
    throw new ToolError((kind === 'image' ? 'Images' : kind === 'pdf' ? 'PDFs' : 'Text files') +
      ' can be up to ' + mb(MAX_BYTES[kind]) + '.', 413)
  }
  return withTenant(tenantId, async tx => {
    // Uploads never sent are cleared out as people upload new ones.
    await tx`
      DELETE FROM ai_attachments
       WHERE tenant_id = ${tenantId} AND user_sub = ${userSub} AND conversation_id IS NULL
         AND created_at < now() - make_interval(hours => ${UNSENT_HOURS})
    `
    const [row] = await tx`
      INSERT INTO ai_attachments (tenant_id, user_sub, kind, media_type, filename, bytes, data)
      VALUES (${tenantId}, ${userSub}, ${kind}, ${media_type}, ${name}, ${buffer.length}, ${buffer})
      RETURNING id, kind, media_type, filename, bytes
    `
    return summary(row)
  })
}

/** One of the caller's own attachments (bytes included), or null. */
export async function loadOwnAttachment(tenantId, userSub, id) {
  const [row] = await withTenant(tenantId, tx => tx`
    SELECT id, kind, media_type, filename, bytes, data, conversation_id FROM ai_attachments
     WHERE id = ${id} AND tenant_id = ${tenantId} AND user_sub = ${userSub}
  `)
  return row ?? null
}

/** Removes one of the caller's own uploads that hasn't been sent yet. */
export async function deleteUnsent(tenantId, userSub, id) {
  const rows = await withTenant(tenantId, tx => tx`
    DELETE FROM ai_attachments
     WHERE id = ${id} AND tenant_id = ${tenantId} AND user_sub = ${userSub} AND conversation_id IS NULL
    RETURNING id
  `)
  return rows.length > 0
}

/**
 * Links the caller's unsent uploads to the conversation, in the order given.
 * Throws when one isn't theirs / already sent, or a limit would be passed.
 */
export async function claimAttachments(conv, userSub, ids) {
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  if (unique.length > MAX_PER_MESSAGE) throw new ToolError('Attach up to ' + MAX_PER_MESSAGE + ' files per message.', 422)
  if (!userSub) throw new ToolError('Attachments aren\'t available here.', 403)
  return withTenant(conv.tenant_id, async tx => {
    const [have] = await tx`
      SELECT count(*)::int AS n, COALESCE(sum(bytes), 0)::bigint AS total FROM ai_attachments
       WHERE conversation_id = ${conv.id} AND tenant_id = ${conv.tenant_id}
    `
    const rows = await tx`
      UPDATE ai_attachments SET conversation_id = ${conv.id}
       WHERE id = ANY(${unique}::uuid[]) AND tenant_id = ${conv.tenant_id}
         AND user_sub = ${userSub} AND conversation_id IS NULL
      RETURNING id, kind, media_type, filename, bytes
    `
    if (rows.length !== unique.length) {
      throw new ToolError('An attached file wasn\'t found (it may have been sent already). Attach it again.', 422)
    }
    const count = have.n + rows.length
    const total = Number(have.total) + rows.reduce((s, r) => s + r.bytes, 0)
    if (count > MAX_PER_CONVERSATION || total > MAX_CONVERSATION_BYTES) {
      throw new ToolError('This chat already has as many files as it can hold (' + MAX_PER_CONVERSATION +
        ' files or ' + mb(MAX_CONVERSATION_BYTES) + '). Start a new chat to attach more.', 422)
    }
    const byId = new Map(rows.map(r => [r.id, r]))
    return unique.map(id => byId.get(id))
  })
}

/** Puts files claimed for a message that never reached the model back to unsent. */
export async function releaseAttachments(conv, ids) {
  if (!ids.length) return
  await withTenant(conv.tenant_id, tx => tx`
    UPDATE ai_attachments SET conversation_id = NULL
     WHERE id = ANY(${ids}::uuid[]) AND conversation_id = ${conv.id} AND tenant_id = ${conv.tenant_id}
  `)
}

/** The stored blocks for a message's files: a reference, no data. Images
 *  and documents go before the text (the model reads them best that way). */
export function attachmentBlocks(rows) {
  return rows.map(r => {
    const _attachment = { id: r.id, name: r.filename, kind: r.kind, bytes: r.bytes }
    if (r.kind === 'image') return { type: 'image', source: { type: 'base64', media_type: r.media_type }, _attachment }
    if (r.kind === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf' }, title: r.filename, _attachment }
    return { type: 'document', source: { type: 'text', media_type: 'text/plain' }, title: r.filename, _attachment }
  })
}

/** Every file in the conversation, ready to send: id -> data string. */
export async function loadAttachmentData(conv) {
  const rows = await withTenant(conv.tenant_id, tx => tx`
    SELECT id, kind, data FROM ai_attachments
     WHERE conversation_id = ${conv.id} AND tenant_id = ${conv.tenant_id}
  `)
  return new Map(rows.map(r => [r.id, r.kind === 'text' ? r.data.toString('utf8') : r.data.toString('base64')]))
}

/** A stored block as sent to the model: the reference replaced by the data. */
export function withFileData(block, files) {
  const { _attachment, ...rest } = block
  const data = files.get(_attachment.id)
  if (data === undefined) return { type: 'text', text: '[The file "' + _attachment.name + '" is no longer available.]' }
  return { ...rest, source: { ...rest.source, data } }
}

/** What the chat shows for a stored message's files. */
export function attachmentItems(blocks) {
  return blocks.filter(b => b && b._attachment).map(b => ({
    id: b._attachment.id, name: b._attachment.name, kind: b._attachment.kind, bytes: b._attachment.bytes,
  }))
}
