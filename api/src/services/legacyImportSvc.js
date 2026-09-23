// src/services/legacyImportSvc.js
//
// Core logic for importing the legacy CAFE_MANAGER.xlsx-style spreadsheet
// into checklists (083) and food-safety (076/077/090) tables. Shared by
// the CLI script (scripts/import-legacy-checklists.js) and the admin-portal
// upload route (routes/legacyImport.js) so there's exactly one place that
// knows how to read each sheet.
//
// This is NOT a general-purpose importer — it's written against the exact
// sheet names/columns of one specific workbook. Sheets it does not
// recognise are ignored.
//
// Safety model — read this before changing anything here:
//   - Callers run this inside a transaction and decide whether to commit
//     or roll back (dry-run == same code path, rolled back instead of
//     committed, so preview counts are always accurate, never guessed).
//   - Never overwrites anything already in the DB — every insert either
//     has a natural-key ON CONFLICT DO NOTHING, or a "does this already
//     exist" guard, so re-running only fills gaps.
//   - Rows dated after "today", or with no real data recorded, are
//     skipped (the workbook has pre-filled template rows far into the
//     future for some sheets).
//   - Checklist columns are matched to existing checklist_template_items
//     by exact label text (trimmed/case-insensitive). Unmatched columns
//     are reported, not guessed at.
//
// Threat model note: this parses the workbook with the `xlsx` package,
// which has known parser vulnerabilities against maliciously crafted
// files. Both call sites gate this behind owner/admin auth — never accept
// a spreadsheet from an untrusted or unauthenticated source.

import XLSX from 'xlsx'

const TODAY = new Date(); TODAY.setUTCHours(23, 59, 59, 999)

const DEFAULT_TEMPS = {
  fridge:  { target: 5,   min: -2,  max: 8 },
  freezer: { target: -18, min: -30, max: -15 },
}

function normLabel(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function isoDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return null
  return d.toISOString().slice(0, 10)
}

function mondayOf(isoStr) {
  const d = new Date(isoStr + 'T00:00:00Z')
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function firstOfMonth(isoStr) {
  return isoStr.slice(0, 7) + '-01'
}

function withinRange(temp, min, max) {
  if (temp == null) return null
  if (min != null && temp < min) return false
  if (max != null && temp > max) return false
  return true
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name]
  if (!ws) return null
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
}

function findCol(header, name) {
  return header.findIndex(h => normLabel(h) === normLabel(name))
}

// stat accumulator per sheet, returned in the report
function stat() {
  return { read: 0, imported: 0, skippedExisting: 0, skippedFuture: 0, skippedBlank: 0, unmatched: new Set() }
}

/** Parse an uploaded/on-disk workbook buffer/path into the XLSX object both callers pass into runLegacyImport(). */
export function readWorkbook(bufferOrPath) {
  return Buffer.isBuffer(bufferOrPath)
    ? XLSX.read(bufferOrPath, { cellDates: true, type: 'buffer' })
    : XLSX.readFile(bufferOrPath, { cellDates: true })
}

export const LEGACY_SHEETS = [
  'KitchenDayChecklist', 'KitchenDayClosingChecklist', 'KitchenWeekChecklist', 'KitchenMonthChecklist',
  'FridgeFreezerChecks', 'HotFoodCheck', 'DeliveryCheck',
]

/**
 * Run the full import against an open transaction. Caller is responsible
 * for the transaction itself (and for deciding whether to commit or roll
 * back — dry-run and commit share this exact code path).
 */
export async function runLegacyImport({ tx, wb, tenantId, venueId, skip = [] }) {
  const report = {}

  if (!skip.includes('KitchenDayChecklist'))
    report.KitchenDayChecklist = await importChecklistSheet(tx, wb, tenantId, venueId, 'KitchenDayChecklist', 'daily', isoDate)
  if (!skip.includes('KitchenDayClosingChecklist'))
    report.KitchenDayClosingChecklist = await importChecklistSheet(tx, wb, tenantId, venueId, 'KitchenDayClosingChecklist', 'daily', isoDate)
  if (!skip.includes('KitchenWeekChecklist'))
    report.KitchenWeekChecklist = await importChecklistSheet(tx, wb, tenantId, venueId, 'KitchenWeekChecklist', 'weekly', d => mondayOf(isoDate(d)))
  if (!skip.includes('KitchenMonthChecklist'))
    report.KitchenMonthChecklist = await importChecklistSheet(tx, wb, tenantId, venueId, 'KitchenMonthChecklist', 'monthly', d => firstOfMonth(isoDate(d)))

  if (!skip.includes('FridgeFreezerChecks'))
    report.FridgeFreezerChecks = await importFridgeFreezerChecks(tx, wb, tenantId, venueId)

  if (!skip.includes('HotFoodCheck'))
    report.HotFoodCheck = await importHotFoodCheck(tx, wb, tenantId, venueId)

  if (!skip.includes('DeliveryCheck'))
    report.DeliveryCheck = await importDeliveryCheck(tx, wb, tenantId, venueId)

  return report
}

// ── Generic daily/weekly/monthly checklist importer ─────────────
async function importChecklistSheet(tx, wb, tenantId, venueId, sheetName, frequency, periodFn) {
  const s = stat()
  const rows = sheetRows(wb, sheetName)
  if (!rows) { s.missingSheet = true; return s }

  const header = rows[0]
  const completedCol = findCol(header, 'Completed')
  const notesCol = findCol(header, 'Notes')
  const taskCols = header
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i !== 0 && i !== completedCol && i !== notesCol && h != null)

  // Candidate templates for this frequency, each with its normalized item-label set
  const templateRows = await tx`
    SELECT t.id, t.name, ti.id AS item_id, ti.label
      FROM checklist_templates t
      JOIN checklist_template_items ti ON ti.template_id = t.id
     WHERE t.tenant_id = ${tenantId} AND t.venue_id = ${venueId} AND t.frequency = ${frequency}
  `
  const byTemplate = new Map()
  for (const row of templateRows) {
    if (!byTemplate.has(row.id)) byTemplate.set(row.id, { name: row.name, items: new Map() })
    byTemplate.get(row.id).items.set(normLabel(row.label), row.item_id)
  }

  const sheetLabels = taskCols.map(({ h }) => normLabel(h))
  let best = null
  for (const [templateId, t] of byTemplate) {
    const matched = sheetLabels.filter(l => t.items.has(l)).length
    const score = sheetLabels.length ? matched / sheetLabels.length : 0
    if (!best || score > best.score) best = { templateId, score, name: t.name, items: t.items }
  }
  if (!best || best.score < 0.5) {
    s.noConfidentTemplate = true
    s.candidates = [...byTemplate.values()].map(t => t.name)
    return s
  }
  s.matchedTemplate = best.name
  for (const { h } of taskCols) {
    if (!best.items.has(normLabel(h))) s.unmatched.add(h)
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const dateVal = row[0]
    if (!dateVal) continue
    s.read++
    const date = dateVal instanceof Date ? dateVal : null
    if (!date || date > TODAY) { s.skippedFuture++; continue }
    const anyValue = taskCols.some(({ i }) => row[i] === true) || row[completedCol] != null
    if (!anyValue) { s.skippedBlank++; continue }

    const periodStart = periodFn(date)
    const status = row[completedCol] === true ? 'completed' : 'in_progress'
    const notes = notesCol >= 0 ? (row[notesCol] ?? null) : null

    const [inst] = await tx`
      INSERT INTO checklist_instances (tenant_id, venue_id, template_id, period_start, status, notes)
      VALUES (${tenantId}, ${venueId}, ${best.templateId}, ${periodStart}, ${status}, ${notes})
      ON CONFLICT (template_id, period_start) DO NOTHING
      RETURNING id
    `
    if (!inst) { s.skippedExisting++; continue }
    s.imported++

    for (const { h, i } of taskCols) {
      const itemId = best.items.get(normLabel(h))
      if (!itemId) continue
      const checked = row[i] === true
      await tx`
        INSERT INTO checklist_instance_items (tenant_id, instance_id, template_item_id, is_checked)
        VALUES (${tenantId}, ${inst.id}, ${itemId}, ${checked})
        ON CONFLICT (instance_id, template_item_id) DO NOTHING
      `
    }
  }
  return s
}

// ── FridgeFreezerChecksAM / PM → fs_equipment + fs_capture_times + fs_temp_logs ──
async function importFridgeFreezerChecks(tx, wb, tenantId, venueId) {
  const s = stat()
  const amRows = sheetRows(wb, 'FridgeFreezerChecksAM')
  const pmRows = sheetRows(wb, 'FridgeFreezerChecksPM')
  if (!amRows && !pmRows) { s.missingSheet = true; return s }

  const header = (amRows ?? pmRows)[0]
  const notesCol = findCol(header, 'Notes')
  const byCol = findCol(header, 'Completed By')
  const skipCols = new Set(['Date', 'Day', 'Weekday', 'Notes', 'Completed By', 'Completed'])
  const unitCols = header
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h != null && !skipCols.has(String(h).trim()))

  // Ensure equipment rows exist (by normalized name)
  const existingEquip = await tx`SELECT id, name, min_temp_c, max_temp_c FROM fs_equipment WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
  const equipByName = new Map(existingEquip.map(e => [normLabel(e.name), e]))
  const equipByHeader = new Map() // header text -> equipment row
  for (const { h } of unitCols) {
    const key = normLabel(h)
    let eq = equipByName.get(key)
    if (!eq) {
      const isFreezer = key.includes('freezer')
      const d = isFreezer ? DEFAULT_TEMPS.freezer : DEFAULT_TEMPS.fridge
      ;[eq] = await tx`
        INSERT INTO fs_equipment (tenant_id, venue_id, name, equipment_type, target_temp_c, min_temp_c, max_temp_c)
        VALUES (${tenantId}, ${venueId}, ${h}, ${isFreezer ? 'freezer' : 'fridge'}, ${d.target}, ${d.min}, ${d.max})
        RETURNING id, name, min_temp_c, max_temp_c
      `
      equipByName.set(key, eq)
      s.createdEquipment = (s.createdEquipment ?? []).concat(h)
    }
    equipByHeader.set(h, eq)
  }

  // Ensure AM/PM capture times exist
  const existingCT = await tx`SELECT id, label FROM fs_capture_times WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}`
  const ctByLabel = new Map(existingCT.map(c => [normLabel(c.label), c]))
  async function ensureCaptureTime(label, timeOfDay) {
    let ct = ctByLabel.get(normLabel(label))
    if (!ct) {
      ;[ct] = await tx`
        INSERT INTO fs_capture_times (tenant_id, venue_id, label, time_of_day)
        VALUES (${tenantId}, ${venueId}, ${label}, ${timeOfDay})
        RETURNING id, label
      `
      ctByLabel.set(normLabel(label), ct)
      s.createdCaptureTimes = (s.createdCaptureTimes ?? []).concat(label)
    }
    return ct
  }
  const amCt = await ensureCaptureTime('AM', '09:00')
  const pmCt = await ensureCaptureTime('PM', '18:00')

  async function importSlot(rows, capture, syntheticTime) {
    if (!rows) return
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      const dateVal = row[0]
      if (!(dateVal instanceof Date)) continue
      s.read++
      if (dateVal > TODAY) { s.skippedFuture++; continue }
      const iso = isoDate(dateVal)
      const recordedBy = byCol >= 0 ? row[byCol] : null
      const notes = notesCol >= 0 ? row[notesCol] : null
      let any = false
      for (const { h, i } of unitCols) {
        const temp = row[i]
        if (typeof temp !== 'number') continue
        any = true
        const eq = equipByHeader.get(h)
        const inRange = withinRange(temp, eq.min_temp_c ?? null, eq.max_temp_c ?? null)
        const [log] = await tx`
          INSERT INTO fs_temp_logs (tenant_id, venue_id, equipment_id, log_date, recorded_at, temperature_c, is_within_range, notes, recorded_by, capture_time_id)
          VALUES (${tenantId}, ${venueId}, ${eq.id}, ${iso}, ${iso + 'T' + syntheticTime}, ${temp}, ${inRange}, ${notes}, ${recordedBy}, ${capture.id})
          ON CONFLICT (equipment_id, log_date, capture_time_id) WHERE capture_time_id IS NOT NULL DO NOTHING
          RETURNING id
        `
        if (!log) s.skippedExisting++
        else s.imported++
      }
      if (!any) s.skippedBlank++
    }
  }
  await importSlot(amRows, amCt, '09:00:00Z')
  await importSlot(pmRows, pmCt, '18:00:00Z')
  return s
}

// ── HotFoodCheck → fs_cooking_checks ─────────────────────────────
async function importHotFoodCheck(tx, wb, tenantId, venueId) {
  const s = stat()
  const rows = sheetRows(wb, 'HotFoodCheck')
  if (!rows) { s.missingSheet = true; return s }
  const header = rows[0]
  const cols = {
    dish1Name: findCol(header, 'Dish 1 Name'), dish1Temp: findCol(header, 'Dish 1 Temp'),
    dish2Name: findCol(header, 'Dish 2 Name'), dish2Temp: findCol(header, 'Dish 2 Temp'),
    riceTemp: findCol(header, 'Rice Temp'), notes: findCol(header, 'Notes'), by: findCol(header, 'Completed By'),
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const dateVal = row[0]
    if (!(dateVal instanceof Date)) continue
    s.read++
    if (dateVal > TODAY) { s.skippedFuture++; continue }
    const iso = isoDate(dateVal)
    const notes = cols.notes >= 0 ? row[cols.notes] : null
    const recordedBy = cols.by >= 0 ? row[cols.by] : null

    const entries = [
      [row[cols.dish1Name], row[cols.dish1Temp], '12:00:00Z'],
      [row[cols.dish2Name], row[cols.dish2Temp], '12:00:01Z'],
      ['Rice', row[cols.riceTemp], '12:00:02Z'],
    ].filter(([name, temp]) => name && typeof temp === 'number')

    if (!entries.length) { s.skippedBlank++; continue }

    for (const [dishName, temp, time] of entries) {
      const existing = await tx`
        SELECT 1 FROM fs_cooking_checks
         WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
           AND check_date = ${iso} AND dish_name = ${dishName} AND core_temp_c = ${temp}
      `
      if (existing.length) { s.skippedExisting++; continue }
      await tx`
        INSERT INTO fs_cooking_checks (tenant_id, venue_id, check_date, recorded_at, dish_name, core_temp_c, is_within_range, notes, recorded_by)
        VALUES (${tenantId}, ${venueId}, ${iso}, ${iso + 'T' + time}, ${dishName}, ${temp}, ${temp >= 75}, ${notes}, ${recordedBy})
      `
      s.imported++
    }
  }
  return s
}

// ── DeliveryCheck → fs_delivery_checks ───────────────────────────
async function importDeliveryCheck(tx, wb, tenantId, venueId) {
  const s = stat()
  const rows = sheetRows(wb, 'DeliveryCheck')
  if (!rows) { s.missingSheet = true; return s }
  const header = rows[0]
  const cols = {
    supplier: findCol(header, 'Supplier'), shelfLife: findCol(header, 'Food shelf life acceptable'),
    noDamage: findCol(header, 'No damage to packaging'), tempOk: findCol(header, 'Food item temperature correct'),
    notes: findCol(header, 'Notes'), by: findCol(header, 'Completed by'),
    dry: findCol(header, 'Dry'), chilled: findCol(header, 'Chilled'), frozen: findCol(header, 'Frozen'), id: findCol(header, 'ID'),
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const dateVal = row[0]
    if (!(dateVal instanceof Date)) continue
    s.read++
    if (dateVal > TODAY) { s.skippedFuture++; continue }
    const vendor = row[cols.supplier]
    if (!vendor) { s.skippedBlank++; continue }
    const iso = isoDate(dateVal)

    const existing = await tx`
      SELECT 1 FROM fs_delivery_checks
       WHERE tenant_id = ${tenantId} AND venue_id = ${venueId}
         AND delivery_date = ${iso} AND vendor_name = ${vendor}
    `
    if (existing.length) { s.skippedExisting++; continue }

    const items = []
    if (row[cols.dry] === true) items.push('dry')
    if (row[cols.chilled] === true) items.push('chilled')
    if (row[cols.frozen] === true) items.push('frozen')

    const packagingOk = row[cols.noDamage] !== false
    const qualityOk = row[cols.shelfLife] !== false
    const tempOk = row[cols.tempOk] !== false
    let notes = cols.notes >= 0 ? row[cols.notes] : null
    if (!notes && cols.id >= 0 && row[cols.id] != null) notes = `Ref: ${row[cols.id]}`

    await tx`
      INSERT INTO fs_delivery_checks
        (tenant_id, venue_id, delivery_date, recorded_at, vendor_name, packaging_ok, damage_ok, quality_ok, temp_ok, items, accepted, notes, recorded_by)
      VALUES
        (${tenantId}, ${venueId}, ${iso}, ${iso + 'T12:00:00Z'}, ${vendor}, ${packagingOk}, ${packagingOk}, ${qualityOk}, ${tempOk},
         ${items}, ${packagingOk && qualityOk && tempOk}, ${notes}, ${cols.by >= 0 ? row[cols.by] : null})
    `
    s.imported++
  }
  return s
}

/** Serialize a report (whose per-sheet `unmatched` fields are Sets) to plain JSON for an HTTP response. */
export function reportToJSON(report) {
  const out = {}
  for (const [sheet, s] of Object.entries(report)) {
    out[sheet] = { ...s, unmatched: s.unmatched ? [...s.unmatched] : [] }
  }
  return out
}
