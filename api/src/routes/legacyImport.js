// src/routes/legacyImport.js
//
// Admin-portal front door for the one-off legacy spreadsheet import (see
// src/services/legacyImportSvc.js for the actual mapping logic, shared
// with scripts/import-legacy-checklists.js). Lets an owner/admin upload
// the workbook straight from the browser instead of needing shell/SSH
// access to the server — SSH file transfer (especially through Lightsail's
// browser console, which has no straightforward upload) was the whole
// reason this route exists.
//
// Mounted at /api/legacy-import in app.js.

import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { readWorkbook, runLegacyImport, reportToJSON } from '../services/legacyImportSvc.js'

const MAX_BYTES = 25 * 1024 * 1024 // 25MB — plenty for a spreadsheet, well under the app-wide 30MB multipart ceiling

export default async function legacyImportRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // Gated on the same test_data module as Test data — this writes
  // thousands of historical compliance rows in one go, same bar as that
  // other pre-prod-only tool, and keeping them on one module switch means
  // one place turns off all pre-prod tooling once real tenants onboard.
  app.post('/', { preHandler: requirePermission('test_data', 'manage') }, async (req) => {
    if (!req.isMultipart()) throw httpError(400, 'Expected multipart/form-data')

    let venueId = null
    let commit = false
    let skip = []
    let fileBuffer = null

    for await (const part of req.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'venue_id') venueId = String(part.value || '')
        if (part.fieldname === 'commit') commit = part.value === 'true'
        if (part.fieldname === 'skip') skip = String(part.value || '').split(',').map(s => s.trim()).filter(Boolean)
      } else if (part.type === 'file' && part.fieldname === 'file') {
        const chunks = []
        let total = 0
        for await (const chunk of part.file) {
          total += chunk.length
          if (total > MAX_BYTES) throw httpError(413, `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit`)
          chunks.push(chunk)
        }
        fileBuffer = Buffer.concat(chunks)
      }
    }
    if (!fileBuffer) throw httpError(400, 'No file provided')
    if (!venueId) throw httpError(400, 'venue_id required')

    let wb
    try {
      wb = readWorkbook(fileBuffer)
    } catch {
      throw httpError(422, 'Could not read that file as an Excel workbook (.xlsx)')
    }

    // Confirm the venue belongs to this tenant before touching anything —
    // withTenant's RLS context makes this a no-op 404 rather than a leak
    // if someone passes another tenant's venue id.
    const [venue] = await withTenant(req.tenantId, tx => tx`
      SELECT id FROM venues WHERE id = ${venueId} AND tenant_id = ${req.tenantId}
    `)
    if (!venue) throw httpError(404, 'Venue not found')

    class DryRunAbort extends Error {}
    let report = {}
    try {
      await withTenant(req.tenantId, async tx => {
        report = await runLegacyImport({ tx, wb, tenantId: req.tenantId, venueId, skip })
        if (!commit) throw new DryRunAbort()
      })
    } catch (e) {
      if (!(e instanceof DryRunAbort)) throw e
    }

    return { committed: commit, report: reportToJSON(report) }
  })
}
