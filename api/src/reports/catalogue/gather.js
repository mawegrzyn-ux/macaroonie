// src/reports/catalogue/gather.js
//
// Gathers a folder's files instead of a list that every area edits
// (docs/PARALLEL_WORK.md 3.10). Used by catalogue/index.js (the subjects),
// catalogue/decisions.js (the tables no subject reads) and
// starters/index.js (the starter reports).
//
//   await gather(import.meta.url, 'subjects')
//       every .js file in the asking file's folder that exports `subjects`,
//       as [{ file, order, module }], by its `order` export (a number; one
//       without comes last), then by file name. The asking file and the
//       folder's index.js are never read: each of them gathers, and reading
//       one from inside the other would wait for itself.
//
// A file without the export is a helper (define.js, coverage.js ...) and is
// left alone. Nothing here is a list of files.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function gather(from, name) {
  const self = fileURLToPath(from)
  const dir = path.dirname(self)
  const names = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') && f !== 'index.js' && f !== path.basename(self))
    .sort()
  const out = []
  for (const file of names) {
    const module = await import(pathToFileURL(path.join(dir, file)).href)
    if (!(name in module)) continue
    out.push({ file, order: module.order, module })
  }
  const rank = f => (Number.isFinite(f.order) ? f.order : Infinity)
  return out.sort((a, b) => rank(a) - rank(b) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}
