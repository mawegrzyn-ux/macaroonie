#!/usr/bin/env node
// scripts/import-legacy-checklists.js
//
// CLI wrapper around src/services/legacyImportSvc.js — see that file for
// the actual sheet-mapping logic and the safety model (dry-run via
// transaction rollback, additive-only writes, etc). The same logic backs
// the in-app upload at Food safety → Import legacy data, so this script
// is only needed for someone who prefers the command line, or a server
// that isn't reachable via the admin portal for some reason.
//
// Usage:
//   node scripts/import-legacy-checklists.js --file <path.xlsx> --venue <venue_id> [--commit] [--skip SheetA,SheetB]
//
// Env:
//   DATABASE_URL — required (same value the API uses)

import postgres from 'postgres'
import { readWorkbook, runLegacyImport } from '../src/services/legacyImportSvc.js'

function parseArgs(argv) {
  const out = { commit: false, skip: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--commit') out.commit = true
    else if (a === '--file') out.file = argv[++i]
    else if (a === '--venue') out.venue = argv[++i]
    else if (a === '--skip') out.skip = argv[++i].split(',').map(s => s.trim())
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (!args.file || !args.venue) {
  console.error('Usage: node scripts/import-legacy-checklists.js --file <path.xlsx> --venue <venue_id> [--commit] [--skip SheetA,SheetB]')
  process.exit(1)
}
const COMMIT = args.commit

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set')
  process.exit(1)
}

class DryRunAbort extends Error {}

async function main() {
  const wb = readWorkbook(args.file)
  const sql = postgres(DATABASE_URL, { max: 1 })
  let report = {}

  try {
    await sql.begin(async tx => {
      const venue = (await tx`SELECT id, tenant_id FROM venues WHERE id = ${args.venue}`)[0]
      if (!venue) throw new Error(`No venue found with id ${args.venue}`)
      await tx`SELECT set_config('app.tenant_id', ${venue.tenant_id}, true)`

      report = await runLegacyImport({ tx, wb, tenantId: venue.tenant_id, venueId: venue.id, skip: args.skip })

      if (!COMMIT) throw new DryRunAbort()
    })
  } catch (e) {
    if (!(e instanceof DryRunAbort)) throw e
  } finally {
    await sql.end()
  }

  printReport(report, COMMIT)
}

function printReport(report, committed) {
  console.log(`\n=== Import ${committed ? '(COMMITTED)' : '(DRY RUN — pass --commit to write)'} ===\n`)
  for (const [sheet, s] of Object.entries(report)) {
    console.log(`--- ${sheet} ---`)
    if (s.missingSheet) { console.log('  sheet not found in workbook, skipped'); continue }
    if (s.noConfidentTemplate) {
      console.log(`  no confident checklist_template match (candidates: ${s.candidates.join(', ') || 'none'}) — skipped`)
      continue
    }
    if (s.matchedTemplate) console.log(`  matched template: "${s.matchedTemplate}"`)
    console.log(`  rows read: ${s.read}, imported: ${s.imported}, already existed: ${s.skippedExisting}, future/junk dates: ${s.skippedFuture}, blank: ${s.skippedBlank}`)
    if (s.unmatched?.size) console.log(`  unmatched columns (no matching template item): ${[...s.unmatched].join(' | ')}`)
    if (s.createdEquipment?.length) console.log(`  ${committed ? 'created' : 'would create'} equipment: ${s.createdEquipment.join(', ')}`)
    if (s.createdCaptureTimes?.length) console.log(`  ${committed ? 'created' : 'would create'} capture times: ${s.createdCaptureTimes.join(', ')}`)
  }
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
