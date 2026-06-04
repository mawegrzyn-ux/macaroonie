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

// ---------------------------------------------------------------------------
// Data seeds — run after every migrate pass (idempotent, skips existing rows)
// ---------------------------------------------------------------------------

const ORDER_SHEET_SEEDS = [
  {
    name: 'JJ Foods',
    show_prices: false,
    items: [
      { name: 'Chicken breast',          unit: '2x5 kg.' },
      { name: 'Chicken inner',           unit: '2x5kg.' },
      { name: 'Top side beef',           unit: '21kg.' },
      { name: 'Prawns 26/30',            unit: 'box (6)' },
      { name: 'Mussel',                  unit: 'box' },
      { name: 'Tilapia',                 unit: 'box (5 kg.)' },
      { name: 'Pangus fish',             unit: '5kg.' },
      { name: 'Squid ring',              unit: '1 kg.' },
      { name: 'Ribs',                    unit: 'box (10 kg.)' },
      { name: 'Frozen wing',             unit: '10 kg.' },
      { name: 'Frozen corn',             unit: '2.5kg.' },
      { name: 'Loin pork',               unit: '6kg.' },
      { name: 'Plain flour',             unit: '16kg.' },
      { name: 'Egg',                     unit: 'box' },
      { name: 'Sugar',                   unit: 'pack (15kg)' },
      { name: 'Oil',                     unit: '20 Ltr' },
      { name: 'Ketchup',                 unit: 'box (2 tub)' },
      { name: 'White vinegar',           unit: 'box (4 gal)' },
      { name: 'Salt',                    unit: '5kg.' },
      { name: 'Onion',                   unit: '4kg.' },
      { name: 'Peeled garlic',           unit: '5 kg.' },
      { name: 'Red pepper',              unit: '5 kg.' },
      { name: 'Spring onion',            unit: 'box' },
      { name: 'Carrot',                  unit: '10kg.' },
      { name: 'Coffee bean',             unit: 'box' },
      { name: 'Courgette',               unit: '10kg' },
      { name: 'Flat cabbage',            unit: '5 heads' },
      { name: 'Blue roll',               unit: 'pack (6)' },
      { name: 'Scour/sponge',            unit: 'pack (6)' },
      { name: 'Scourer',                 unit: 'pack (12)' },
      { name: 'Metal scourer',           unit: 'pack (10)' },
      { name: 'Prep glove',              unit: 'box (50)' },
      { name: 'Yellow glove',            unit: 'pack (6)' },
      { name: 'Heavy duty bin liner',    unit: 'box (200)' },
      { name: 'Cling film 30mm',         unit: 'box' },
      { name: 'Cleaning cloth',          unit: 'pack' },
      { name: 'Container 500',           unit: 'box' },
      { name: 'Container 600',           unit: 'box' },
      { name: '2oz container with lid',  unit: 'box' },
      { name: 'PC bag',                  unit: 'box' },
      { name: 'Washing up liquid',       unit: 'box (2)' },
      { name: 'Bleach',                  unit: 'box (2)' },
      { name: 'Degreaser',               unit: 'box (2)' },
      { name: 'Coke',                    unit: 'pack (24)' },
      { name: 'Diet Coke',               unit: 'pack (24)' },
      { name: '7 Up',                    unit: 'pack (24)' },
      { name: 'Still water',             unit: 'box (24)' },
      { name: 'Sparkling water',         unit: 'box (24)' },
      { name: 'Coke Zero',               unit: 'pack (24)' },
      { name: 'Orange juice',            unit: '12x Ltr' },
    ],
  },
  {
    name: 'JJ Oriental',
    show_prices: false,
    items: [
      { name: 'Lucky boat egg noodles No.1',     unit: 'box' },
      { name: '3mm rice noodles',                unit: 'box' },
      { name: '6" spring roll pastry',           unit: 'box' },
      { name: 'Panda oyster sauce',              unit: 'box' },
      { name: 'Baby corn small tin',             unit: 'box' },
      { name: 'Pineapple pieces small tin',      unit: 'box' },
      { name: 'Healthy boy soya sauce',          unit: 'box 5lt' },
      { name: 'Seasoning sauce golden mountain', unit: 'box' },
      { name: 'Squid fish sauce plastic',        unit: 'box' },
      { name: 'Golden panko breadcrumb',         unit: 'pack' },
      { name: 'Mae ploy panang',                 unit: 'tub' },
      { name: 'Mae ploy massaman',               unit: 'tub' },
      { name: 'Mae ploy green',                  unit: 'box' },
      { name: 'Mae ploy red',                    unit: 'box' },
      { name: 'Nittaya Kaeng Pa',                unit: 'pack' },
      { name: 'Mae ploy Tom yum',                unit: 'tub' },
      { name: 'Mae ploy chilli oil',             unit: 'tub' },
      { name: 'Crispy onion',                    unit: 'tub' },
      { name: 'Sriraja hot sauce',               unit: 'bottle' },
      { name: 'Hoisin sauce Amoy small tin',     unit: 'box' },
      { name: 'Choa koh small tin',              unit: 'box' },
      { name: 'Choa koh big tin',                unit: 'box' },
      { name: 'Bamboo shot sliced big tin',      unit: 'box' },
      { name: 'Yellow bean',                     unit: 'bottle' },
      { name: 'Dark soya sauce',                 unit: 'bottle' },
      { name: 'Manarah PC',                      unit: 'box' },
      { name: 'Corn flour',                      unit: '3kg.' },
      { name: 'Chang tamarind seedless',         unit: 'pack' },
      { name: 'Chopped sweet radish',            unit: 'pack' },
      { name: 'Glass noodle',                    unit: '500g.' },
      { name: 'Coarse pepper',                   unit: '500g.' },
      { name: 'White pepper powder',             unit: '500g.' },
      { name: 'Turmeric powder',                 unit: '500g.' },
      { name: 'Curry powder',                    unit: '500g.' },
      { name: 'Cashew nut',                      unit: '10kg.' },
      { name: 'Sesame seed',                     unit: '1 kg.' },
      { name: 'Dried red big chilli',            unit: 'bag' },
      { name: 'Star anise / cinnamon wood',      unit: 'bag' },
      { name: 'Dried red small chilli',          unit: 'bag' },
      { name: 'Bamboo stick 6"',                 unit: 'pack (10 bg)' },
      { name: 'Plastic bag S3',                  unit: 'box' },
      { name: 'Plastic bag S4',                  unit: 'box' },
      { name: 'Riceberry rice',                  unit: 'box' },
      { name: 'Jasmin rice',                     unit: '20kg.' },
      { name: 'Long grain rice',                 unit: '20kg.' },
      { name: 'Glutinous rice',                  unit: '10 kg.' },
      { name: 'Dried chilli flakes',             unit: 'bag' },
      { name: 'Sesame seed oil',                 unit: 'bottle' },
      { name: 'Glutinous rice flour BS',         unit: 'bag' },
      { name: 'Desiccated coconut BS',           unit: 'bag' },
    ],
  },
  {
    name: 'JP Fresh',
    show_prices: false,
    items: [
      { name: 'Small white cabbage',   unit: 'sack' },
      { name: 'Beansprouts',           unit: '4kg.' },
      { name: 'Bird eye chilli',       unit: 'box' },
      { name: 'Long red chilli',       unit: '3kg' },
      { name: 'Coriander',             unit: 'bunch' },
      { name: 'Ginger',                unit: 'kg.' },
      { name: 'Krachai',               unit: 'kg.' },
      { name: 'Young peppercorn',      unit: '100g.' },
      { name: 'Lemongrass',            unit: '12x90g' },
      { name: 'Galangal',              unit: 'kg.' },
      { name: 'Fried tofu',            unit: 'kg.' },
      { name: 'FZ medal roasted duck', unit: 'box (20)' },
      { name: 'Fz fishcake paste',     unit: 'box (20)' },
      { name: 'Fz lime leaf',          unit: '100g.' },
    ],
  },
]

async function orderSheetTemplatesTableExists() {
  const [row] = await sql`
    SELECT 1 AS present FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'order_sheet_templates'
     LIMIT 1
  `
  return !!row
}

async function runSeeds() {
  if (!(await orderSheetTemplatesTableExists())) return

  const tenants = await sql`SELECT id FROM tenants WHERE is_active = true`
  if (!tenants.length) return

  for (const { id: tenantId } of tenants) {
    for (const tpl of ORDER_SHEET_SEEDS) {
      const [existing] = await sql`
        SELECT id FROM order_sheet_templates
         WHERE tenant_id = ${tenantId} AND name = ${tpl.name} LIMIT 1
      `
      if (existing) continue

      const [created] = await sql`
        INSERT INTO order_sheet_templates (tenant_id, name, show_prices, is_active, sort_order)
        VALUES (${tenantId}, ${tpl.name}, ${tpl.show_prices}, true,
          (SELECT COALESCE(MAX(sort_order), 0) + 1
             FROM order_sheet_templates WHERE tenant_id = ${tenantId}))
        RETURNING id
      `
      for (let i = 0; i < tpl.items.length; i++) {
        const item = tpl.items[i]
        await sql`
          INSERT INTO order_sheet_items (template_id, name, unit, sort_order)
          VALUES (${created.id}, ${item.name}, ${item.unit}, ${i + 1})
        `
      }
      ok(`seeded   order template "${tpl.name}" (${tpl.items.length} items)`)
    }
  }
}

// ---------------------------------------------------------------------------

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
  } else {
    for (const f of pending) {
      await runOne(f)
    }
    ok(`Applied ${pending.length} migration(s).`)
  }

  await runSeeds()
}

main()
  .catch(e => {
    err(`Migration run aborted: ${e.message}`)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 2 }))
