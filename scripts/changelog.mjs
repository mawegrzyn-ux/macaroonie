#!/usr/bin/env node
// Prints the changelog: every file in changes/ newest first (by the date in
// its name, then the name), then CHANGE.md, which holds everything before the
// switch (docs/PARALLEL_WORK.md 3.3).
//   node scripts/changelog.mjs [--since YYYY-MM-DD]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'changes')
const i = process.argv.indexOf('--since')
const since = i > 0 ? process.argv[i + 1] : null
const NAME = /^(\d{4}-\d{2}-\d{2})-([a-z-]+)\.md$/

const files = fs.readdirSync(dir).filter(f => NAME.test(f))
  .filter(f => !since || f.slice(0, 10) >= since)
  .sort((a, b) => b.slice(0, 10).localeCompare(a.slice(0, 10)) || a.localeCompare(b))

const out = []
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8').trim()
  const [first, ...rest] = text.split('\n')
  out.push(`## [${f.slice(0, 10)} — ${first.replace(/^#\s*/, '')}]`, ...rest, '')
}
if (!since) out.push(fs.readFileSync(path.join(root, 'CHANGE.md'), 'utf8'))
process.stdout.on('error', () => {})   // a closed pipe (head) is fine
process.stdout.write(out.join('\n') + '\n')
