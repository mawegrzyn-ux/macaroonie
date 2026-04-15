#!/usr/bin/env node
// scripts/migrate.js
//
// Runs pending SQL migrations in order against DATABASE_URL.
//
// - Looks at <repo>/migrations/*.sql (sorted lexically — the NNN_ prefix
//   makes lexical == chronological).
// - Tracks applied migrations in a `schema_migrations` table
//   (created on first run).
// - Each new migration runs inside a transaction — either the whole
//   file succeeds or nothing changes.
// - Idempotent: running twice is a no-op.
//
// Intended use:
//   node api/scripts/migrate.js             # apply pending migrations
//   node api/scripts/migrate.js --list      # list status without applying
//   node api/scripts/migrate.js --baseline  # mark all migrations as applied
//                                             (no SQL runs — use ONCE on a
//                                             server that already has the
//                                             schema from manual psql runs)
//   node api/scripts/migrate.js --baseline-up-to 024
//                                           # same, but only up to a version
//
// Env:
//   DATABASE_URL — required (same value the API uses)
//   MIGRATIONS_DIR — optional override, defaults to ../../migrations

import fs   from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DIR = path.resolve(__dirname, '..', '..', 'migrations')

const MIG_DIR = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : DEFAULT_DIR

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set')
  process.exit(1)
}

const argv = process.argv.slice(2)
const LIST_ONLY = argv.includes('--list') || argv.includes('-l')
const BASELINE  = argv.includes('--baseline')
// --baseline-up-to <version>   (e.g. 024)
const baselineUpToIdx = argv.indexOf('--baseline-up-to')
const BASELINE_UP_TO = baselineUpToIdx !== -1 ? argv[baselineUpToIdx + 1] : null

// Auto-baseline: if schema_migrations is EMPTY AND the tenants table
// already exists (i.e. the DB was built manually via psql before this
// script existed), mark everything up to AUTO_BASELINE_UP_TO as applied
// on first run, then proceed to apply anything newer.
// Set via env var so it can be configured once in the deploy pipeline
// and remains a no-op on every subsequent run.
const AUTO_BASELINE_UP_TO = process.env.AUTO_BASELINE_UP_TO || null

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 2 })

function log(msg)  { console.log(msg) }
function ok(msg)   { console.log(`\x1b[32m✓\x1b[0m ${msg}`) }
function warn(msg) { console.warn(`\x1b[33m!\x1b[0m ${msg}`) }
function err(msg)  { console.error(`\x1b[31m✗\x1b[0m ${msg}`) }

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text        PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      checksum    text
    )
  `
}

async function listMigrationFiles() {
  let entries
  try {
    entries = await fs.readdir(MIG_DIR)
  } catch (e) {
    err(`Cannot read migrations dir: ${MIG_DIR}`)
    throw e
  }
  return entries
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => ({
      version:  f.replace(/\.sql$/, ''),
      filename: f,
      path:     path.join(MIG_DIR, f),
    }))
}

async function applied() {
  const rows = await sql`SELECT version FROM schema_migrations ORDER BY version`
  return new Set(rows.map(r => r.version))
}

async function runOne({ version, filename, path: p }) {
  const body = await fs.readFile(p, 'utf-8')
  try {
    await sql.begin(async tx => {
      // .unsafe() allows multi-statement SQL, which our migration files use.
      await tx.unsafe(body)
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`
    })
    ok(`applied  ${filename}`)
  } catch (e) {
    err(`failed   ${filename}`)
    err(`  ${e.message}`)
    throw e
  }
}

async function tenantsTableExists() {
  const [row] = await sql`
    SELECT 1 AS present
      FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'tenants'
     LIMIT 1
  `
  return !!row
}

async function autoBaselineIfNeeded(files) {
  if (!AUTO_BASELINE_UP_TO) return
  const done = await applied()
  if (done.size > 0) return                    // tracker already populated — nothing to do
  const hasSchema = await tenantsTableExists()
  if (!hasSchema) return                       // fresh DB — let normal apply flow run 001+

  const cutoff = AUTO_BASELINE_UP_TO
  const toMark = files.filter(f => {
    const vNum = f.version.split('_')[0]
    return vNum.localeCompare(cutoff) <= 0
  })
  for (const f of toMark) {
    await sql`INSERT INTO schema_migrations (version) VALUES (${f.version})
              ON CONFLICT (version) DO NOTHING`
  }
  ok(`auto-baselined ${toMark.length} migration(s) up to ${cutoff} (schema already present)`)
}

async function main() {
  log(`migrations dir: ${MIG_DIR}`)
  await ensureTable()

  const files = await listMigrationFiles()
  if (!files.length) {
    warn('No migration files found.')
    return
  }

  // First-run catch-up for servers whose schema pre-dates this runner.
  await autoBaselineIfNeeded(files)

  const done = await applied()
  const pending = files.filter(f => !done.has(f.version))

  log(`total: ${files.length}  applied: ${done.size}  pending: ${pending.length}`)

  if (LIST_ONLY) {
    for (const f of files) {
      const status = done.has(f.version) ? '✓' : ' '
      log(`  [${status}] ${f.filename}`)
    }
    return
  }

  if (BASELINE || BASELINE_UP_TO) {
    // Mark files as applied WITHOUT running them. Use ONCE on a server
    // that already has the schema from manual psql runs so the tracker
    // catches up with reality.
    const cutoff = BASELINE_UP_TO
    const toMark = files.filter(f => {
      if (done.has(f.version)) return false
      if (!cutoff) return true
      // Compare by the leading digits before '_' — e.g. "024" vs "024_foo"
      const vNum = f.version.split('_')[0]
      return vNum.localeCompare(cutoff) <= 0
    })
    for (const f of toMark) {
      await sql`INSERT INTO schema_migrations (version) VALUES (${f.version})
                ON CONFLICT (version) DO NOTHING`
      ok(`baseline ${f.filename}`)
    }
    ok(`Baselined ${toMark.length} migration(s). No SQL was run.`)
    return
  }

  if (!pending.length) {
    ok('Database is up to date.')
    return
  }

  for (const f of pending) {
    await runOne(f)
  }
  ok(`Applied ${pending.length} migration(s).`)
}

main()
  .catch(e => {
    err(`Migration run aborted: ${e.message}`)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 2 }))
