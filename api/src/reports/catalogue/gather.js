// src/reports/catalogue/gather.js
//
// Gathers a folder's files instead of a list that every area edits
// (docs/PARALLEL_WORK.md 3.10). Used by catalogue/index.js (the subjects),
// catalogue/decisions.js (the tables no subject reads) and
// starters/index.js (the starter reports).
//
//   gather(FILES, 'subjects')
//       every file of the folder's list (files.js) that exports `subjects`,
//       as [{ file, order, module }], by its `order` export (a number; one
//       without comes last), then by file name.
//
// A file without the export is a helper (define.js, coverage.js ...) and is
// left alone. Nothing here is a list of files.

export function gather(files, name) {
  const out = []
  for (const [file, module] of files) {
    if (!(name in module)) continue
    out.push({ file, order: module.order, module })
  }
  const rank = f => (Number.isFinite(f.order) ? f.order : Infinity)
  return out.sort((a, b) => rank(a) - rank(b) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}
