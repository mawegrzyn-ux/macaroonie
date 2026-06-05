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

// Each item carries a `category` matching a name seeded into
// order_sheet_categories (migration 063). runSeeds() resolves it to a
// category_id per tenant. A null/unknown category just leaves the item
// uncategorised.
const ORDER_SHEET_SEEDS = [
  {
    name: 'JJ Foods',
    show_prices: false,
    items: [
      { name: 'Chicken breast',          unit: '2x5 kg.',      category: 'Meat & Poultry' },
      { name: 'Chicken inner',           unit: '2x5kg.',       category: 'Meat & Poultry' },
      { name: 'Top side beef',           unit: '21kg.',        category: 'Meat & Poultry' },
      { name: 'Prawns 26/30',            unit: 'box (6)',      category: 'Fish & Seafood' },
      { name: 'Mussel',                  unit: 'box',          category: 'Fish & Seafood' },
      { name: 'Tilapia',                 unit: 'box (5 kg.)',  category: 'Fish & Seafood' },
      { name: 'Pangus fish',             unit: '5kg.',         category: 'Fish & Seafood' },
      { name: 'Squid ring',              unit: '1 kg.',        category: 'Fish & Seafood' },
      { name: 'Ribs',                    unit: 'box (10 kg.)', category: 'Meat & Poultry' },
      { name: 'Frozen wing',             unit: '10 kg.',       category: 'Meat & Poultry' },
      { name: 'Frozen corn',             unit: '2.5kg.',       category: 'Vegetables' },
      { name: 'Loin pork',               unit: '6kg.',         category: 'Meat & Poultry' },
      { name: 'Plain flour',             unit: '16kg.',        category: 'Dry Goods' },
      { name: 'Egg',                     unit: 'box',          category: 'Dairy & Eggs' },
      { name: 'Sugar',                   unit: 'pack (15kg)',  category: 'Dry Goods' },
      { name: 'Oil',                     unit: '20 Ltr',       category: 'Oils, Sauces & Condiments' },
      { name: 'Ketchup',                 unit: 'box (2 tub)',  category: 'Oils, Sauces & Condiments' },
      { name: 'White vinegar',           unit: 'box (4 gal)',  category: 'Oils, Sauces & Condiments' },
      { name: 'Salt',                    unit: '5kg.',         category: 'Dry Goods' },
      { name: 'Onion',                   unit: '4kg.',         category: 'Vegetables' },
      { name: 'Peeled garlic',           unit: '5 kg.',        category: 'Vegetables' },
      { name: 'Red pepper',              unit: '5 kg.',        category: 'Vegetables' },
      { name: 'Spring onion',            unit: 'box',          category: 'Vegetables' },
      { name: 'Carrot',                  unit: '10kg.',        category: 'Vegetables' },
      { name: 'Coffee bean',             unit: 'box',          category: 'Beverages' },
      { name: 'Courgette',               unit: '10kg',         category: 'Vegetables' },
      { name: 'Flat cabbage',            unit: '5 heads',      category: 'Vegetables' },
      { name: 'Blue roll',               unit: 'pack (6)',     category: 'Cleaning Supplies' },
      { name: 'Scour/sponge',            unit: 'pack (6)',     category: 'Cleaning Supplies' },
      { name: 'Scourer',                 unit: 'pack (12)',    category: 'Cleaning Supplies' },
      { name: 'Metal scourer',           unit: 'pack (10)',    category: 'Cleaning Supplies' },
      { name: 'Prep glove',              unit: 'box (50)',     category: 'Cleaning Supplies' },
      { name: 'Yellow glove',            unit: 'pack (6)',     category: 'Cleaning Supplies' },
      { name: 'Heavy duty bin liner',    unit: 'box (200)',    category: 'Cleaning Supplies' },
      { name: 'Cling film 30mm',         unit: 'box',          category: 'Packaging' },
      { name: 'Cleaning cloth',          unit: 'pack',         category: 'Cleaning Supplies' },
      { name: 'Container 500',           unit: 'box',          category: 'Packaging' },
      { name: 'Container 600',           unit: 'box',          category: 'Packaging' },
      { name: '2oz container with lid',  unit: 'box',          category: 'Packaging' },
      { name: 'PC bag',                  unit: 'box',          category: 'Packaging' },
      { name: 'Washing up liquid',       unit: 'box (2)',      category: 'Cleaning Supplies' },
      { name: 'Bleach',                  unit: 'box (2)',      category: 'Cleaning Supplies' },
      { name: 'Degreaser',               unit: 'box (2)',      category: 'Cleaning Supplies' },
      { name: 'Coke',                    unit: 'pack (24)',    category: 'Beverages' },
      { name: 'Diet Coke',               unit: 'pack (24)',    category: 'Beverages' },
      { name: '7 Up',                    unit: 'pack (24)',    category: 'Beverages' },
      { name: 'Still water',             unit: 'box (24)',     category: 'Beverages' },
      { name: 'Sparkling water',         unit: 'box (24)',     category: 'Beverages' },
      { name: 'Coke Zero',               unit: 'pack (24)',    category: 'Beverages' },
      { name: 'Orange juice',            unit: '12x Ltr',      category: 'Beverages' },
    ],
  },
  {
    name: 'JJ Oriental',
    show_prices: false,
    items: [
      { name: 'Lucky boat egg noodles No.1',     unit: 'box',         category: 'Dry Goods' },
      { name: '3mm rice noodles',                unit: 'box',         category: 'Dry Goods' },
      { name: '6" spring roll pastry',           unit: 'box',         category: 'Dry Goods' },
      { name: 'Panda oyster sauce',              unit: 'box',         category: 'Oils, Sauces & Condiments' },
      { name: 'Baby corn small tin',             unit: 'box',         category: 'Dry Goods' },
      { name: 'Pineapple pieces small tin',      unit: 'box',         category: 'Dry Goods' },
      { name: 'Healthy boy soya sauce',          unit: 'box 5lt',     category: 'Oils, Sauces & Condiments' },
      { name: 'Seasoning sauce golden mountain', unit: 'box',         category: 'Oils, Sauces & Condiments' },
      { name: 'Squid fish sauce plastic',        unit: 'box',         category: 'Oils, Sauces & Condiments' },
      { name: 'Golden panko breadcrumb',         unit: 'pack',        category: 'Dry Goods' },
      { name: 'Mae ploy panang',                 unit: 'tub',         category: 'Oils, Sauces & Condiments' },
      { name: 'Mae ploy massaman',               unit: 'tub',         category: 'Oils, Sauces & Condiments' },
      { name: 'Mae ploy green',                  unit: 'box',         category: 'Oils, Sauces & Condiments' },
      { name: 'Mae ploy red',                    unit: 'box',         category: 'Oils, Sauces & Condiments' },
      { name: 'Nittaya Kaeng Pa',                unit: 'pack',        category: 'Oils, Sauces & Condiments' },
      { name: 'Mae ploy Tom yum',                unit: 'tub',         category: 'Oils, Sauces & Condiments' },
      { name: 'Mae ploy chilli oil',             unit: 'tub',         category: 'Oils, Sauces & Condiments' },
      { name: 'Crispy onion',                    unit: 'tub',         category: 'Dry Goods' },
      { name: 'Sriraja hot sauce',               unit: 'bottle',      category: 'Oils, Sauces & Condiments' },
      { name: 'Hoisin sauce Amoy small tin',     unit: 'box',         category: 'Oils, Sauces & Condiments' },
      { name: 'Choa koh small tin',              unit: 'box',         category: 'Dry Goods' },
      { name: 'Choa koh big tin',                unit: 'box',         category: 'Dry Goods' },
      { name: 'Bamboo shot sliced big tin',      unit: 'box',         category: 'Dry Goods' },
      { name: 'Yellow bean',                     unit: 'bottle',      category: 'Oils, Sauces & Condiments' },
      { name: 'Dark soya sauce',                 unit: 'bottle',      category: 'Oils, Sauces & Condiments' },
      { name: 'Manarah PC',                      unit: 'box',         category: 'Packaging' },
      { name: 'Corn flour',                      unit: '3kg.',        category: 'Dry Goods' },
      { name: 'Chang tamarind seedless',         unit: 'pack',        category: 'Dry Goods' },
      { name: 'Chopped sweet radish',            unit: 'pack',        category: 'Dry Goods' },
      { name: 'Glass noodle',                    unit: '500g.',       category: 'Dry Goods' },
      { name: 'Coarse pepper',                   unit: '500g.',       category: 'Dry Goods' },
      { name: 'White pepper powder',             unit: '500g.',       category: 'Dry Goods' },
      { name: 'Turmeric powder',                 unit: '500g.',       category: 'Dry Goods' },
      { name: 'Curry powder',                    unit: '500g.',       category: 'Dry Goods' },
      { name: 'Cashew nut',                      unit: '10kg.',       category: 'Dry Goods' },
      { name: 'Sesame seed',                     unit: '1 kg.',       category: 'Dry Goods' },
      { name: 'Dried red big chilli',            unit: 'bag',         category: 'Dry Goods' },
      { name: 'Star anise / cinnamon wood',      unit: 'bag',         category: 'Dry Goods' },
      { name: 'Dried red small chilli',          unit: 'bag',         category: 'Dry Goods' },
      { name: 'Bamboo stick 6"',                 unit: 'pack (10 bg)',category: 'Packaging' },
      { name: 'Plastic bag S3',                  unit: 'box',         category: 'Packaging' },
      { name: 'Plastic bag S4',                  unit: 'box',         category: 'Packaging' },
      { name: 'Riceberry rice',                  unit: 'box',         category: 'Dry Goods' },
      { name: 'Jasmin rice',                     unit: '20kg.',       category: 'Dry Goods' },
      { name: 'Long grain rice',                 unit: '20kg.',       category: 'Dry Goods' },
      { name: 'Glutinous rice',                  unit: '10 kg.',      category: 'Dry Goods' },
      { name: 'Dried chilli flakes',             unit: 'bag',         category: 'Dry Goods' },
      { name: 'Sesame seed oil',                 unit: 'bottle',      category: 'Oils, Sauces & Condiments' },
      { name: 'Glutinous rice flour BS',         unit: 'bag',         category: 'Dry Goods' },
      { name: 'Desiccated coconut BS',           unit: 'bag',         category: 'Dry Goods' },
    ],
  },
  {
    name: 'JP Fresh',
    show_prices: false,
    items: [
      { name: 'Small white cabbage',   unit: 'sack',     category: 'Vegetables' },
      { name: 'Beansprouts',           unit: '4kg.',     category: 'Vegetables' },
      { name: 'Bird eye chilli',       unit: 'box',      category: 'Vegetables' },
      { name: 'Long red chilli',       unit: '3kg',      category: 'Vegetables' },
      { name: 'Coriander',             unit: 'bunch',    category: 'Herbs & Garnish' },
      { name: 'Ginger',                unit: 'kg.',      category: 'Vegetables' },
      { name: 'Krachai',               unit: 'kg.',      category: 'Herbs & Garnish' },
      { name: 'Young peppercorn',      unit: '100g.',    category: 'Herbs & Garnish' },
      { name: 'Lemongrass',            unit: '12x90g',   category: 'Herbs & Garnish' },
      { name: 'Galangal',              unit: 'kg.',      category: 'Herbs & Garnish' },
      { name: 'Fried tofu',            unit: 'kg.',      category: 'Vegetables' },
      { name: 'FZ medal roasted duck', unit: 'box (20)', category: 'Meat & Poultry' },
      { name: 'Fz fishcake paste',     unit: 'box (20)', category: 'Fish & Seafood' },
      { name: 'Fz lime leaf',          unit: '100g.',    category: 'Herbs & Garnish' },
    ],
  },
]

async function runSeeds() {
  if (!(await tableExists('order_sheet_templates'))) return
  const hasCategories = await tableExists('order_sheet_categories')

  const tenants = await sql`SELECT id FROM tenants WHERE is_active = true`
  if (!tenants.length) return

  for (const { id: tenantId } of tenants) {
    // Read categories inside a tenant-scoped transaction so RLS allows the SELECT.
    // Without tenant context the USING policy filters to tenant_id = NULL
    // which matches nothing — catMap would always be empty.
    let catMap = {}
    if (hasCategories) {
      const cats = await sql.begin(async tx => {
        await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`
        return tx`SELECT id, name FROM order_sheet_categories`
      })
      catMap = Object.fromEntries(cats.map(c => [c.name, c.id]))
    }

    for (const tpl of ORDER_SHEET_SEEDS) {
      // Check for existing template (with tenant context so RLS allows the SELECT).
      // Also fetch item_count so we can force-recreate templates that exist but
      // have 0 items (leftover from previous broken runSeeds calls).
      const [existing] = await sql.begin(async tx => {
        await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`
        return tx`
          SELECT t.id, COUNT(i.id)::int AS item_count
          FROM order_sheet_templates t
          LEFT JOIN order_sheet_items i ON i.template_id = t.id
          WHERE t.name = ${tpl.name}
          GROUP BY t.id
          LIMIT 1
        `
      })

      if (existing?.item_count > 0) {
        // Template exists and already has items — leave it alone.
        continue
      }

      if (existing) {
        // Template exists but has no items — delete and recreate with categories.
        await sql`DELETE FROM order_sheet_items WHERE template_id = ${existing.id}`
        await sql`DELETE FROM order_sheet_template_venues WHERE template_id = ${existing.id}`
        await sql.begin(async tx => {
          await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`
          await tx`DELETE FROM order_sheet_templates WHERE id = ${existing.id}`
        })
      }

      const [created] = await sql`
        INSERT INTO order_sheet_templates (tenant_id, name, show_prices, is_active, sort_order)
        VALUES (${tenantId}, ${tpl.name}, ${tpl.show_prices}, true,
          (SELECT COALESCE(MAX(sort_order), 0) + 1
             FROM order_sheet_templates WHERE tenant_id = ${tenantId}))
        RETURNING id
      `
      for (let i = 0; i < tpl.items.length; i++) {
        const item = tpl.items[i]
        const categoryId = item.category ? (catMap[item.category] ?? null) : null
        if (hasCategories) {
          await sql`
            INSERT INTO order_sheet_items (template_id, name, unit, category_id, sort_order)
            VALUES (${created.id}, ${item.name}, ${item.unit}, ${categoryId}, ${i + 1})
          `
        } else {
          await sql`
            INSERT INTO order_sheet_items (template_id, name, unit, sort_order)
            VALUES (${created.id}, ${item.name}, ${item.unit}, ${i + 1})
          `
        }
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
