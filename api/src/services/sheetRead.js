// src/services/sheetRead.js
//
// Reading a spreadsheet someone uploaded (base64) as rows of text, for the
// catalogue import and price update (routes/inventory.js) and a supplier's
// basket (routes/purchasing.js). One reader, so every upload treats
// encodings and cells the same way.

import * as XLSX     from 'xlsx'
import { httpError } from '../middleware/error.js'

// .xlsx (a zip) or .xls by their first bytes.
const isSpreadsheet = buf => (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf)

/**
 * A text file's text (base64 in): UTF-8 when it is, else read as Windows
 * Latin-1; null for an Excel file (read that with readSheet()).
 */
export function fileText(base64) {
  const buf = Buffer.from(base64, 'base64')
  if (isSpreadsheet(buf)) return null
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '') }
  catch { return new TextDecoder('windows-1252').decode(buf) }
}

/**
 * The first sheet of a CSV or Excel file (base64) as rows of text. A CSV
 * that is UTF-8 is read as UTF-8 (XLSX reads one without a byte-order mark
 * as Latin-1, so £ and accents came out wrong), else as XLSX guesses (an
 * old Windows CSV); a CSV's cells stay as typed (a code like 12-04 isn't
 * read as a date, 00123 keeps its zeros).
 */
export function readSheet(base64) {
  const buf = Buffer.from(base64, 'base64')
  let text = null
  if (!isSpreadsheet(buf)) { try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { text = null } }
  let wb
  try {
    wb = text != null
      ? XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true })
      : XLSX.read(buf, { type: 'buffer', raw: true })
  } catch { throw httpError(422, "That file couldn't be read. Save it as CSV or Excel (.xlsx).") }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw httpError(422, 'The file is empty')
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false })
}
