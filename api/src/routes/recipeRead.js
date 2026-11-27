// src/routes/recipeRead.js — mounted at /api/ai/recipes
//
// Pepper reads recipes (inventory phase 3, docs/INVENTORY.md 5.6). Under
// /api/ai so the longer proxy timeout for Pepper applies
// (scripts/ensure-nginx-ai-timeout.sh): a long sheet takes a minute.
//
//   POST /read    { files: [{ name?, data (base64) }], text?, hint? }
//                 photos of recipe cards (JPEG, PNG, WebP, GIF), PDFs, a
//                 spreadsheet (Excel or CSV, read to rows) and / or pasted
//                 text -> { recipes, notes, counts, items_listed,
//                 items_total, preps_listed, preps_total }: each recipe with
//                 its lines, every line matched (an inventory item or a prep
//                 recipe, by Pepper's ref, its code or its name), suggested,
//                 or not found with the words read. Pepper is sent the first
//                 800 items and 300 prep recipes as refs; a line is matched
//                 by code and name against all of them.
//                 Nothing is saved: POST /api/recipes/drafts makes the drafts
//                 the person keeps.                       Recipes manage + Pepper
//   POST /yield   { item_id } or { name }   a typical usable yield for an
//                 ingredient (the item drawer's Suggest): { yield_pct, low,
//                 high, words, sure }. Nothing is saved: the person saves the
//                 yield with the card's own Save.
//                                       Purchasing setup or Recipes manage + Pepper
//
// Files: photos up to 5 MB each, PDFs and spreadsheets up to 10 MB (checked
// from their first bytes, a CSV by its name), up to 10 files and 20 MB
// together; pasted text up to 60,000 characters.

import { z } from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, requireAnyPermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { pepperOn } from '../services/aiJson.js'
import { readSheet, fileText } from '../services/sheetRead.js'
import { loadCostItems } from '../services/costingSvc.js'
import { readRecipes, suggestYield, MAX_ITEMS, MAX_PREPS } from '../services/recipeReadAi.js'

const MAX_FILES = 10
const MAX_IMAGE = 5 * 1024 * 1024
const MAX_DOC = 10 * 1024 * 1024
const MAX_TOTAL = 20 * 1024 * 1024
const MAX_TEXT = 60000
const MAX_SHEET_ROWS = 3000
const b64 = n => Math.ceil(n / 3) * 4 + 4

const FileIn = z.object({
  name: z.string().max(200).optional(),
  data: z.string().min(8).max(b64(MAX_DOC)).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'A file didn\'t arrive whole'),
})
const ReadBody = z.object({
  files: z.array(FileIn).max(MAX_FILES, 'Up to ' + MAX_FILES + ' files at a time').default([]),
  text: z.string().max(MAX_TEXT, 'Paste up to ' + MAX_TEXT.toLocaleString('en-GB') + ' characters at a time').default(''),
  hint: z.string().max(1000).default(''),
}).refine(b => b.files.length || b.text.trim(), 'Add a photo, a PDF or a spreadsheet of the recipes, or paste them')
const YieldBody = z.object({
  item_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
}).refine(b => b.item_id || b.name, 'Say which item')

const isSheet = buf => (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf)
const starts = (buf, bytes) => bytes.every((b, i) => buf[i] === b)
/** A photo or a PDF, from its first bytes (never its name): { kind, media_type } or null. */
export function photoOrPdf(buf) {
  if (starts(buf, [0xFF, 0xD8, 0xFF])) return { kind: 'image', media_type: 'image/jpeg' }
  if (starts(buf, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return { kind: 'image', media_type: 'image/png' }
  const head = buf.subarray(0, 12).toString('latin1')
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return { kind: 'image', media_type: 'image/gif' }
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return { kind: 'image', media_type: 'image/webp' }
  if (head.startsWith('%PDF-')) return { kind: 'pdf', media_type: 'application/pdf' }
  return null
}
const TEXT_NAMES = /\.(csv|tsv|txt)$/i

/** A sheet's rows as text for the model: cells by tabs, empty rows gone, cut at MAX_SHEET_ROWS. */
export function sheetText(rows) {
  const out = rows.slice(0, MAX_SHEET_ROWS).map(r => r.map(c => String(c ?? '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t').replace(/\t+$/, ''))
    .filter(r => r.trim())
  return out.join('\n').slice(0, MAX_TEXT * 2)
}

/** The files sorted into what the model reads as blocks (photos, PDFs) and as text (sheets, CSV). */
export function sortFiles(list) {
  let total = 0
  const files = []
  const texts = []
  list.forEach((f, i) => {
    const buffer = Buffer.from(f.data, 'base64')
    const label = f.name || 'File ' + (i + 1)
    total += buffer.length
    if (isSheet(buffer) || TEXT_NAMES.test(f.name || '')) {
      if (buffer.length > MAX_DOC) throw httpError(413, label + ' is too big: spreadsheets up to 10 MB.')
      // A .txt file is read as text; Excel and CSV as rows.
      const asText = !isSheet(buffer) && /\.txt$/i.test(f.name || '')
      const text = asText ? String(fileText(f.data) || '').slice(0, MAX_TEXT) : sheetText(readSheet(f.data))
      if (!text.trim()) throw httpError(422, label + ' is empty.')
      texts.push({ kind: asText ? 'text' : 'sheet', name: label, text })
      return
    }
    const kind = photoOrPdf(buffer)
    if (!kind) {
      throw httpError(422, label + ' isn\'t a photo, a PDF or a spreadsheet: use JPEG, PNG, WebP, GIF, PDF, Excel or CSV.')
    }
    if (buffer.length > (kind.kind === 'pdf' ? MAX_DOC : MAX_IMAGE)) throw httpError(413, label + ' is too big: photos up to 5 MB, PDFs up to 10 MB.')
    files.push({ media_type: kind.media_type, data: f.data })
  })
  if (total > MAX_TOTAL) throw httpError(413, 'Those files are too big together: up to 20 MB at a time.')
  return { files, texts }
}

/** What the reader matches against: the group's active items and prep recipes, and every recipe's name (to say a name is taken). */
export async function readerLists(tx, tenantId) {
  const items = [...(await loadCostItems(tx, tenantId)).values()].filter(i => i.is_active)
  const recipes = await tx`
    SELECT id, name, kind, yield_unit, code, is_active FROM recipes WHERE tenant_id = ${tenantId} ORDER BY lower(name)`
  return {
    items,
    preps: recipes.filter(r => r.kind === 'prep' && r.is_active),
    existing: recipes.map(r => ({ id: r.id, name: r.name })),
  }
}

export default async function recipeReadRoutes(app) {
  app.addHook('preHandler', requireAuth)

  app.post('/read', {
    bodyLimit: b64(MAX_TOTAL) + MAX_TEXT * 4 + 64 * 1024,
    preHandler: [requirePermission('recipes', 'manage'), requirePermission('ai_assistant', 'view')],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async req => {
    const body = ReadBody.parse(req.body || {})
    await pepperOn(req.tenantId)
    const { files, texts } = sortFiles(body.files)
    if (body.text.trim()) texts.push({ kind: 'text', name: 'pasted', text: body.text.trim() })
    const lists = await withTenant(req.tenantId, tx => readerLists(tx, req.tenantId))
    const read = await readRecipes({
      tenantId: req.tenantId, person: { sub: req.user?.sub, email: req.user?.email },
      files, texts, hint: body.hint, ...lists,
    })
    return {
      ...read,
      items_listed: Math.min(lists.items.length, MAX_ITEMS), items_total: lists.items.length,
      preps_listed: Math.min(lists.preps.length, MAX_PREPS), preps_total: lists.preps.length,
    }
  })

  app.post('/yield', {
    preHandler: [requireAnyPermission(['purchasing_setup', 'recipes'], 'manage'), requirePermission('ai_assistant', 'view')],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async req => {
    const body = YieldBody.parse(req.body || {})
    await pepperOn(req.tenantId)
    let name = body.name
    let baseUnit = null
    if (body.item_id) {
      const [item] = await withTenant(req.tenantId, tx => tx`
        SELECT name, base_unit FROM inv_items WHERE id = ${body.item_id} AND tenant_id = ${req.tenantId}`)
      if (!item) throw httpError(404, 'Inventory item not found')
      name = item.name
      baseUnit = item.base_unit
    }
    return { name, ...(await suggestYield({ tenantId: req.tenantId, person: { sub: req.user?.sub, email: req.user?.email }, name, baseUnit })) }
  })
}
