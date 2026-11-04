// src/utils/importClosure.js
//
// The files a set of ES modules needs: the entries and everything they import
// by relative path (static imports, export ... from, import()), followed
// through the files themselves. Used to ship the venue hub's code
// (services/hubRelease.js) and to serve the menu screen player the shared
// files it imports (services/screenSvc.js), so a file that gains an import is
// shipped without a list to keep by hand.

import fs from 'node:fs'
import path from 'node:path'

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm

/**
 * Every file `entries` load, as paths relative to `root` with forward slashes.
 * `who` starts the message when a file is missing ("The hub needs x, which is missing").
 */
export function importClosure(entries, root, { who = 'This code' } = {}) {
  const seen = new Set()
  const todo = [...entries]
  while (todo.length) {
    const rel = todo.pop()
    if (seen.has(rel)) continue
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) throw new Error(who + ' needs ' + rel + ', which is missing')
    seen.add(rel)
    const src = fs.readFileSync(abs, 'utf8')
    IMPORT_RE.lastIndex = 0
    let m
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[1] || m[2] || m[3]
      const next = path.relative(root, path.resolve(path.dirname(abs), spec)).split(path.sep).join('/')
      if (next.startsWith('..')) throw new Error(rel + ' imports ' + spec + ', outside the repository')
      todo.push(next)
    }
  }
  return [...seen]
}
