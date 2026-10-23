// src/components/brand/ApplyBrand.jsx
//
// Brand & theme's Apply the brand: the group's saved brand (kitFromBrand())
// onto kiosk designs, menu screen boards and printed menu designs the person
// ticks. Each design keeps everything but its colours and fonts: the same
// mappers the designers' Use the brand uses (kioskBrandFromKit(),
// boardFromKit(), printFromKit() in shared/themeKit.js), saved through each
// design's own save route, so its own checks apply. Only designs the person
// can change are offered (Store tech, Menu screens, Menus manage).

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Loader2, Monitor, Printer, Tablet, TriangleAlert } from 'lucide-react'
import { useApi } from '@/lib/api'
import { usePermission } from '@/hooks/usePermission'
import { cn } from '@/lib/utils'
import { KitPreview, KitSwatches, useBrandKit, useFontLink } from '@/components/themes/ThemeMaker'
import {
  kioskBrandFromKit, boardFromKit, printFromKit, kitFromKioskBrand, kitFromBoard, kitFromPrint, kitFontsUrl,
} from '@shared/themeKit.js'

const KINDS = {
  kiosk: { label: 'Kiosk designs', icon: Tablet, target: 'kiosk', before: d => kitFromKioskBrand(d.settings?.brand || {}) },
  board: { label: 'Menu screen boards', icon: Monitor, target: 'board', before: d => kitFromBoard(d.layout || {}) },
  print: { label: 'Printed menu designs', icon: Printer, target: 'print', before: d => kitFromPrint(d.layout || {}) },
}

const errText = e => e?.body?.error || e?.message || 'It couldn\'t be saved'

export function ApplyBrandCard({ className }) {
  const api = useApi()
  const qc = useQueryClient()
  const kit = useBrandKit()
  const kiosk = usePermission('pos_setup')
  const screens = usePermission('screens')
  const menus = usePermission('menus')

  const { data: kioskDesigns = [] } = useQuery({
    queryKey: ['kiosk-designs'], queryFn: () => api.get('/pos/kiosk-designs'), enabled: kiosk.canManage,
  })
  const { data: boards = [] } = useQuery({
    queryKey: ['screen-designs'], queryFn: () => api.get('/screens/designs'), enabled: screens.canManage,
  })
  const { data: printDesigns = [] } = useQuery({
    queryKey: ['menu-print-designs'], queryFn: () => api.get('/menus/print-designs'), enabled: menus.canManage,
  })

  const rows = useMemo(() => [
    ...(kiosk.canManage ? kioskDesigns.map(d => ({ key: 'kiosk:' + d.id, kind: 'kiosk', id: d.id, name: d.name, data: d })) : []),
    ...(screens.canManage ? boards.map(d => ({ key: 'board:' + d.id, kind: 'board', id: d.id, name: d.name, data: d })) : []),
    ...(menus.canManage ? printDesigns.map(d => ({ key: 'print:' + d.id, kind: 'print', id: d.id, name: d.name, sub: d.menu_name, data: d })) : []),
  ], [kiosk.canManage, screens.canManage, menus.canManage, kioskDesigns, boards, printDesigns])

  const [picked, setPicked] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState({})

  // A board's list row has no layout: its colours load with the board.
  const beforeKits = useMemo(() => Object.fromEntries(rows.filter(r => r.kind !== 'board').map(r => [r.key, KINDS[r.kind].before(r.data)])), [rows])
  useFontLink(useMemo(() => kitFontsUrl(kit ? [kit] : []), [kit]))

  if (!kiosk.canManage && !screens.canManage && !menus.canManage) return null

  const toggle = key => setPicked(p => {
    const next = new Set(p)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  const allKeys = rows.map(r => r.key)
  const allPicked = allKeys.length > 0 && allKeys.every(k => picked.has(k))

  async function applyOne(r) {
    if (r.kind === 'kiosk') {
      const settings = r.data.settings || {}
      await api.put('/pos/kiosk-designs/' + r.id, { name: r.data.name, settings: { ...settings, brand: kioskBrandFromKit(kit, settings.brand || {}) } })
    } else if (r.kind === 'board') {
      const b = await api.get('/screens/designs/' + r.id)
      await api.put('/screens/designs/' + r.id, { name: b.name, width: b.width, height: b.height, layout: boardFromKit(kit, b.layout || {}) })
    } else {
      await api.put('/menus/' + r.data.menu_id + '/designs/' + r.id, { layout: printFromKit(kit, r.data.layout || {}) })
    }
  }

  async function apply() {
    setBusy(true)
    const out = {}
    for (const r of rows.filter(x => picked.has(x.key))) {
      try { await applyOne(r); out[r.key] = { ok: true } } catch (e) { out[r.key] = { ok: false, error: errText(e) } }
      setResults({ ...out })
    }
    setBusy(false)
    setConfirming(false)
    setPicked(new Set(Object.entries(out).filter(([, v]) => !v.ok).map(([k]) => k)))
    qc.invalidateQueries({ queryKey: ['kiosk-designs'] })
    qc.invalidateQueries({ queryKey: ['screen-designs'] })
    qc.invalidateQueries({ queryKey: ['menu-print-designs'] })
  }

  const done = Object.values(results).filter(r => r.ok).length
  const failed = Object.values(results).filter(r => !r.ok).length

  return (
    <div className={cn('bg-background border rounded-xl overflow-hidden', className)} data-testid="apply-brand">
      <div className="px-5 py-3 section-head">
        <h2 className="text-sm font-semibold">Use the brand on other designs</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Kiosks, menu screens and printed menus have their own colours and fonts. Tick the ones that should take the
          brand as saved above; everything else on them stays as it is.
        </p>
      </div>
      <div className="p-5 space-y-4">
        {!kit ? (
          <p className="text-sm text-muted-foreground">Save the brand&apos;s colours and fonts first.</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-3" aria-label="The brand on each kind of design">
              {['kiosk', 'board', 'print'].map(t => (
                <div key={t} className="space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground">{KINDS[t].label}</p>
                  <KitPreview kit={kit} target={KINDS[t].target} />
                </div>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="apply-brand-none">There are no kiosk designs, boards or printed menu designs yet.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => setPicked(allPicked ? new Set() : new Set(allKeys))} disabled={busy}
                    className="min-h-[44px] px-3 rounded-md border text-sm touch-manipulation">{allPicked ? 'Untick all' : 'Tick all'}</button>
                  <span className="text-xs text-muted-foreground">{picked.size} ticked</span>
                </div>
                {Object.keys(KINDS).map(kind => {
                  const list = rows.filter(r => r.kind === kind)
                  if (!list.length) return null
                  const Icon = KINDS[kind].icon
                  return (
                    <div key={kind}>
                      <p className="text-xs font-semibold flex items-center gap-1.5 mb-1"><Icon className="w-3.5 h-3.5 text-primary" />{KINDS[kind].label}</p>
                      <ul className="divide-y border rounded-lg">
                        {list.map(r => {
                          const res = results[r.key]
                          return (
                            <li key={r.key}>
                              <label className="flex items-center gap-3 px-3 min-h-[52px] touch-manipulation cursor-pointer">
                                <input type="checkbox" className="w-5 h-5" checked={picked.has(r.key)} onChange={() => toggle(r.key)} disabled={busy}
                                  data-testid={'apply-brand-' + r.key} />
                                <span className="flex-1 min-w-0">
                                  <span className="text-sm font-medium block truncate">{r.name}</span>
                                  {r.sub && <span className="text-xs text-muted-foreground block truncate">{r.sub}</span>}
                                </span>
                                {beforeKits[r.key] && <KitSwatches kit={beforeKits[r.key]} className="hidden sm:inline-flex" />}
                                {picked.has(r.key) && <><ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><KitSwatches kit={kit} /></>}
                                {res?.ok && <span className="text-xs text-emerald-700 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" />Done</span>}
                                {res && !res.ok && <span className="text-xs text-destructive inline-flex items-center gap-1" title={res.error}><TriangleAlert className="w-3.5 h-3.5" />{res.error}</span>}
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
                {(done > 0 || failed > 0) && !busy && (
                  <p className={cn('text-sm', failed ? 'text-destructive' : 'text-emerald-700')} data-testid="apply-brand-result" role="status">
                    {done > 0 && `The brand is on ${done} ${done === 1 ? 'design' : 'designs'}.`}{failed > 0 && ` ${failed} couldn't be changed: see the list.`}
                    {done > 0 && ' Kiosks and screens show it within a minute.'}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  {confirming ? (
                    <>
                      <span className="text-sm">Put the brand&apos;s colours and fonts on {picked.size} {picked.size === 1 ? 'design' : 'designs'}?</span>
                      <button type="button" onClick={() => setConfirming(false)} disabled={busy}
                        className="min-h-[44px] px-4 rounded-md border text-sm touch-manipulation">Cancel</button>
                      <button type="button" onClick={apply} disabled={busy} data-testid="apply-brand-confirm"
                        className="min-h-[44px] px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 touch-manipulation disabled:opacity-50">
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}Yes, use the brand
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => { setResults({}); setConfirming(true) }} disabled={!picked.size || busy} data-testid="apply-brand-go"
                      className="min-h-[44px] px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50">
                      Use the brand on the ticked designs
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
