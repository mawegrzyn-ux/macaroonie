// src/pages/LegacyImport.jsx
//
// One-off tool: upload the legacy spreadsheet (checklists + food-safety
// history) straight from the browser instead of needing shell/SSH access
// to the server. Backed by POST /api/legacy-import, which shares its
// mapping logic with scripts/import-legacy-checklists.js (see
// api/src/services/legacyImportSvc.js). Owner/admin only, pre-prod tool —
// same bar as Test data.

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const SHEET_LABELS = {
  KitchenDayChecklist: 'Kitchen Day Checklist',
  KitchenDayClosingChecklist: 'Kitchen Day Closing Checklist',
  KitchenWeekChecklist: 'Kitchen Week Checklist',
  KitchenMonthChecklist: 'Kitchen Month Checklist',
  FridgeFreezerChecks: 'Fridge/Freezer Checks (AM+PM)',
  HotFoodCheck: 'Hot Food Check',
  DeliveryCheck: 'Delivery Check',
}

export default function LegacyImport() {
  const api = useApi()
  const [venueId, setVenueId] = useState('')
  const [file, setFile] = useState(null)
  const [report, setReport] = useState(null)
  const [committed, setCommitted] = useState(false)
  const [confirmingCommit, setConfirmingCommit] = useState(false)

  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
  })
  const selectedVenue = venueId || venues[0]?.id || ''

  const run = useMutation({
    mutationFn: ({ commit }) => api.upload('/legacy-import', file, { venue_id: selectedVenue, commit }),
    onSuccess: (data) => {
      setReport(data.report)
      setCommitted(data.committed)
      setConfirmingCommit(false)
    },
    onError: () => setConfirmingCommit(false),
  })

  function handleFile(e) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setReport(null)
    setCommitted(false)
    setConfirmingCommit(false)
  }

  function preview() {
    setConfirmingCommit(false)
    run.mutate({ commit: false })
  }

  function commit() {
    if (!confirmingCommit) { setConfirmingCommit(true); return }
    run.mutate({ commit: true })
  }

  const canRun = !!file && !!selectedVenue && !run.isPending

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
        <div>
          <h1 className="font-semibold flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" /> Legacy data import
          </h1>
          <p className="text-xs text-muted-foreground">
            One-off: import historical checklists and food-safety logs from a spreadsheet. Pre-prod only.
          </p>
        </div>
        {venues.length > 1 && (
          <select value={selectedVenue} onChange={e => setVenueId(e.target.value)}
            className="text-sm border rounded-md px-3 py-2 bg-background min-h-[40px] touch-manipulation">
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">
        <div className="border rounded-xl p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload the spreadsheet. This first runs a <strong>preview</strong> (nothing is
            written) so you can check the counts before committing. Matches
            checklist sheets to the checklist templates you've already
            created, and creates fridge/freezer equipment + AM/PM capture
            times automatically if they don't already exist. Re-running is
            safe — it only fills in gaps, never duplicates or overwrites.
          </p>

          <div>
            <label className="block text-sm font-medium mb-1">Spreadsheet (.xlsx)</label>
            <input type="file" accept=".xlsx" onChange={handleFile}
              className="w-full text-sm border rounded-md px-3 py-2 bg-background min-h-[44px] touch-manipulation file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-sm" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={preview} disabled={!canRun}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
              {run.isPending && !committed ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Preview (dry run)
            </button>
            {report && !committed && (
              <button type="button" onClick={commit} disabled={!canRun}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation',
                  confirmingCommit ? 'bg-red-600 text-white hover:bg-red-700' : 'border hover:bg-accent',
                )}>
                {confirmingCommit ? 'Click again to confirm — this writes live data' : 'Commit import'}
              </button>
            )}
          </div>

          {run.isError && (
            <p className="text-sm text-red-600">{run.error?.body?.error || run.error?.message || 'Import failed'}</p>
          )}
        </div>

        {report && (
          <div className="border rounded-xl overflow-hidden">
            <div className={cn(
              'px-5 py-3 border-b flex items-center gap-2 text-sm font-medium',
              committed ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800',
            )}>
              {committed ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {committed ? 'Committed — these rows have been written.' : 'Preview only — nothing has been written yet.'}
            </div>
            <div className="divide-y">
              {Object.entries(report).map(([sheet, s]) => (
                <div key={sheet} className="px-5 py-3 text-sm">
                  <p className="font-medium">{SHEET_LABELS[sheet] ?? sheet}</p>
                  {s.missingSheet ? (
                    <p className="text-muted-foreground text-xs mt-1">Sheet not found in the workbook — skipped.</p>
                  ) : s.noConfidentTemplate ? (
                    <p className="text-amber-700 text-xs mt-1">
                      No confident checklist match{s.candidates?.length ? ` (checked against: ${s.candidates.join(', ')})` : ''} — skipped.
                    </p>
                  ) : (
                    <>
                      {s.matchedTemplate && (
                        <p className="text-xs text-muted-foreground mt-0.5">Matched template: "{s.matchedTemplate}"</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {s.read} rows read · {s.imported} {committed ? 'imported' : 'would import'} · {s.skippedExisting} already existed · {s.skippedFuture} future/junk dates · {s.skippedBlank} blank
                      </p>
                      {s.unmatched?.length > 0 && (
                        <p className="text-xs text-amber-700 mt-0.5">Unmatched columns: {s.unmatched.join(' | ')}</p>
                      )}
                      {s.createdEquipment?.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {committed ? 'Created' : 'Would create'} equipment: {s.createdEquipment.join(', ')}
                        </p>
                      )}
                      {s.createdCaptureTimes?.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {committed ? 'Created' : 'Would create'} capture times: {s.createdCaptureTimes.join(', ')}
                        </p>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
