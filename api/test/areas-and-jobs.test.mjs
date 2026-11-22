// The lists gathered from folders (docs/PARALLEL_WORK.md 3.5 and 3.9): the
// route plugins, one file per area in src/areas (registered by app.js), and
// the background jobs, one file per job in src/jobs (started by server.js,
// listed on the Platform page's Status as JOBS).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { env } from '../src/config/env.js'
import { loadJobs } from '../src/jobs/queues.js'
import { JOBS } from '../src/services/platformStatus.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(here, '..', 'src')
const jsIn = dir => fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()
const SLUGS = fs.readdirSync(path.join(here, '..', '..', 'docs', 'claude', 'areas'))
  .filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))

test('every area file is named after an area and lists [plugin, options] pairs', async () => {
  const seen = new Set()
  for (const file of jsIn(path.join(src, 'areas'))) {
    assert.ok(SLUGS.includes(file.slice(0, -3)), 'areas/' + file + ' is named after one of docs/claude/areas')
    const { routes } = await import(pathToFileURL(path.join(src, 'areas', file)).href)
    assert.ok(Array.isArray(routes) && routes.length, 'areas/' + file + ' exports its routes')
    for (const entry of routes) {
      assert.ok(Array.isArray(entry) && entry.length >= 1 && entry.length <= 2, 'areas/' + file + ': [plugin, options]')
      const [plugin, opts] = entry
      assert.equal(typeof plugin, 'function', 'areas/' + file + ': a plugin')
      assert.ok(opts === undefined || (opts && typeof opts === 'object'), 'areas/' + file + ': options are an object')
      // One plugin may be registered more than once with different options (the dashboards).
      const key = (plugin.name || '?') + ' ' + JSON.stringify(opts ?? null)
      assert.ok(!seen.has(key), key + ' is registered twice')
      seen.add(key)
    }
  }
})

test('every route file is registered: in an area file, by app.js, or by another route file', () => {
  const read = f => fs.readFileSync(f, 'utf8')
  const registered = [path.join(src, 'app.js'), ...jsIn(path.join(src, 'areas')).map(f => path.join(src, 'areas', f))].map(read).join('\n')
  const routeFiles = jsIn(path.join(src, 'routes'))
  const routeSources = routeFiles.map(f => read(path.join(src, 'routes', f))).join('\n')
  for (const file of routeFiles) {
    const ref = new RegExp("routes/" + file.replace('.', '\\.') + "'|'\\./" + file.replace('.', '\\.') + "'")
    assert.ok(ref.test(registered) || ref.test(routeSources), 'routes/' + file + ' is in no area file (src/areas)')
  }
})

test('every job is named after its file, on its own queue and the run\'s prefix', async () => {
  const jobs = await loadJobs()
  assert.ok(jobs.length > 0)
  const names = jobs.map(j => j.name)
  assert.equal(new Set(names).size, names.length, 'job names are unique')
  for (const j of jobs) {
    assert.ok(fs.existsSync(path.join(src, 'jobs', j.name + '.js')), j.name + ' is in jobs/' + j.name + '.js')
    assert.equal(j.queue.name, j.name)
    assert.equal(j.queue.qualifiedName, env.QUEUE_PREFIX + ':' + j.name, j.name + ' uses QUEUE_PREFIX')
    assert.ok(typeof j.label === 'string' && j.label.length, j.name + ' has a label')
    assert.ok(j.every === null || (Number.isInteger(j.every) && j.every >= 60_000), j.name + ': every is null or at least a minute')
    assert.equal(typeof j.start, 'function')
  }
  // In order on the Status: by order, ties by name.
  const sorted = [...jobs].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  assert.deepEqual(names, sorted.map(j => j.name))
})

test('the Status lists every job, in the same order', async () => {
  const jobs = await loadJobs()
  assert.deepEqual(JOBS, jobs.map(j => ({ name: j.name, label: j.label, every: j.every })))
})
