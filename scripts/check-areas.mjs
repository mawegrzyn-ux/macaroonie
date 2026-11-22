#!/usr/bin/env node
// The area map's checks (docs/PARALLEL_WORK.md 4.1 to 4.3). No dependencies.
//
//   node scripts/check-areas.mjs              the map: files no area claims, or two claim
//   node scripts/check-areas.mjs imports      cross-area imports not in the baseline (fails)
//   node scripts/check-areas.mjs imports --write-baseline
//                                             write today's crossings to areas-baseline.json
//   node scripts/check-areas.mjs pr <base>    the areas and shared files a branch changes
//                                             since <base> (markdown, for a PR comment)
//   node scripts/check-areas.mjs which <file>...   the area of each file
//
// areas.json: { templates, shared, areas: { <name>: { paths, public } } }.
// "templates" are globs with {area} that every area has (its notes, its route
// file, ...). "shared" lists the files any change to which is named in the PR's
// title. A file's area is the one whose paths match it; a file under shared/
// that no area claims belongs to "shared". An import from one area into another
// is allowed into "core" and "shared", into the other area's "public" files, or
// when it is in areas-baseline.json. The baseline only shrinks.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const map = JSON.parse(fs.readFileSync(path.join(root, 'areas.json'), 'utf8'))
const BASELINE = path.join(root, 'areas-baseline.json')

// A glob to a regex: ** any folders, * any characters but /, {a,b} either.
function globRe(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1 }
    else if (c === '*') re += '[^/]*'
    else if (c === '{') { const j = glob.indexOf('}', i); re += '(?:' + glob.slice(i + 1, j).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'; i = j }
    else re += c.replace(/[.+?^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}

const AREAS = Object.keys(map.areas)
const rules = AREAS.map(a => ({
  area: a,
  paths: [...(map.areas[a].paths || []), ...(map.templates || []).map(t => t.replaceAll('{area}', a))].map(globRe),
  pub: (map.areas[a].public || []).map(globRe),
}))
const sharedRes = (map.shared || []).map(globRe)

function areasOf(file) { return rules.filter(r => r.paths.some(re => re.test(file))).map(r => r.area) }
function areaOf(file) {
  const a = areasOf(file)
  if (a.length) return a[0]
  if (file.startsWith('shared/')) return 'shared'
  return null
}
const isPublic = (file, area) => rules.find(r => r.area === area)?.pub.some(re => re.test(file))
const isShared = file => sharedRes.some(re => re.test(file))

function gitFiles() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
}
// The code the map covers: the apps' source, the shared rules, tests, the notes.
const CODE = /^(api|admin|pos|hub|screen|shared|android-app|office-app|docs\/claude|scripts)\//
const IGNORE = /(^|\/)(node_modules|dist|build|\.expo)\//

function mapReport() {
  const unclaimed = [], twice = []
  for (const f of gitFiles()) {
    if (!CODE.test(f) || IGNORE.test(f)) continue
    const a = areasOf(f)
    if (a.length > 1) twice.push(`${f}: ${a.join(', ')}`)
    else if (!a.length && !f.startsWith('shared/') && !isShared(f)) unclaimed.push(f)
  }
  console.log(`Files no area claims: ${unclaimed.length}`)
  unclaimed.forEach(f => console.log('  ' + f))
  console.log(`Files two areas claim: ${twice.length}`)
  twice.forEach(f => console.log('  ' + f))
  return twice.length ? 1 : 0
}

// Relative imports (and the admin's @/ alias) in the apps' source.
const SRC = /^(api\/src|api\/scripts|admin\/src|pos\/src|hub\/src|shared)\/.*\.(js|jsx|mjs)$/
const IMPORT = /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*[\w*{}\s,$]*\s*from\s*|\bimport\s*\(\s*)['"]((?:\.{1,2}|@)\/[^'"]+)['"]/g
const EXTS = ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx']
function resolveImport(from, spec, exists) {
  const base = spec.startsWith('@/') ? path.posix.join('admin/src', spec.slice(2)) : path.posix.join(path.posix.dirname(from), spec)
  for (const e of EXTS) if (exists.has(base + e)) return base + e
  return null
}
function crossings() {
  const files = gitFiles()
  const exists = new Set(files)
  const out = new Set()
  for (const f of files) {
    if (!SRC.test(f) || IGNORE.test(f)) continue
    const fa = areaOf(f)
    // core wires the areas together (app.js registers every area's routes): it may import any of them.
    if (!fa || fa === 'shared' || fa === 'core') continue
    const text = fs.readFileSync(path.join(root, f), 'utf8')
    for (const m of text.matchAll(IMPORT)) {
      const t = resolveImport(f, m[1], exists)
      if (!t) continue
      const ta = areaOf(t)
      if (!ta || ta === fa || ta === 'core' || ta === 'shared' || isPublic(t, ta)) continue
      out.add(`${f} -> ${t}`)
    }
  }
  return [...out].sort()
}
function importsReport(write) {
  const now = crossings()
  if (write) {
    fs.writeFileSync(BASELINE, JSON.stringify({ note: 'Cross-area imports allowed because they existed when the check started (docs/PARALLEL_WORK.md 4.2). Only ever remove lines.', imports: now }, null, 2) + '\n')
    console.log(`Wrote ${now.length} crossings to areas-baseline.json`)
    return 0
  }
  const base = new Set(fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')).imports : [])
  const fresh = now.filter(c => !base.has(c))
  const gone = [...base].filter(c => !now.includes(c))
  console.log(`Cross-area imports: ${now.length} (${base.size} in the baseline)`)
  if (gone.length) console.log(`No longer there (remove them from areas-baseline.json): ${gone.length}\n` + gone.map(c => '  ' + c).join('\n'))
  if (fresh.length) {
    console.log(`New imports from one area into another's private files: ${fresh.length}`)
    for (const c of fresh) {
      const [a, b] = c.split(' -> ')
      console.log(`  ${c}   (${areaOf(a)} -> ${areaOf(b)})`)
    }
    console.log('Call the other area through a file it lists as public in areas.json, add the file to its "public" list if it is meant to be called, or move the code to shared/.')
    return 1
  }
  return 0
}

function prReport(base) {
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  const by = new Map()
  const shared = []
  for (const f of changed) {
    const a = areaOf(f) || (isShared(f) ? 'shared' : f.startsWith('migrations/') ? 'migrations' : CODE.test(f) && !IGNORE.test(f) ? 'other' : 'docs')
    if (!by.has(a)) by.set(a, [])
    by.get(a).push(f)
    if (isShared(f) || a === 'shared' || f.startsWith('migrations/')) shared.push(f)
  }
  const areas = [...by.keys()].filter(a => !['shared', 'migrations', 'other', 'docs'].includes(a)).sort()
  const lines = ['### Areas this pull request touches', '']
  lines.push(areas.length ? areas.map(a => `**${a}** (${by.get(a).length})`).join(', ') : 'none')
  if (areas.length > 1) lines.push('', 'More than one area: say so in the title, or split it (a change to another area first, on its own).')
  if (shared.length) lines.push('', 'Shared files changed (name them in the title):', ...shared.map(f => `- \`${f}\``))
  if (by.has('other')) lines.push('', 'Files no area claims (add them to `areas.json`):', ...by.get('other').map(f => `- \`${f}\``))
  console.log(lines.join('\n'))
  return 0
}

const [cmd, ...args] = process.argv.slice(2)
let code = 0
if (!cmd) code = mapReport()
else if (cmd === 'imports') code = importsReport(args.includes('--write-baseline'))
else if (cmd === 'pr') code = prReport(args[0] || 'origin/main')
else if (cmd === 'which') for (const f of args) console.log(`${f}: ${areasOf(f).join(', ') || areaOf(f) || 'none'}`)
else { console.error('usage: check-areas.mjs [imports [--write-baseline] | pr <base> | which <file>...]'); code = 2 }
process.exit(code)
