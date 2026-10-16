// src/pages/MenuDeliveroo.jsx
//
// Menus > Deliveroo menu (/menus/deliveroo, migration 157): read the
// bulk-management CSV a venue downloads from the Deliveroo Hub, match each
// Deliveroo item to a dish, fill prices (menu price + the venue's uplift),
// VAT, descriptions, allergens and calories from our menus, review and edit
// item by item, then download the file again for Deliveroo (CSV, same
// columns and line endings) or for Excel.
//
// All the rules (matching, filling, checks, CSV) are in shared/deliveroo.js.
// Saved per venue: the settings (explicit Save) and each item's match, kept
// columns and typed values (Save matches). The file is kept in this browser
// tab only (sessionStorage), never on the server.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bike, ChevronLeft, Upload, Download, FileSpreadsheet, Search, Percent, AlertTriangle, Tags } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PageHeader, Section, Btn, Toggle, NumberBox, Segmented, ErrorNote, inputCls } from '@/components/pos/shared'
import {
  FIELD_LABEL, ROUND_OPTIONS, StateBadge, DishPicker, ItemEditor, CodesModal, PriceModal, dishLine, money,
} from '@/components/menus/DeliverooParts'
import {
  FILL_FIELDS, matchRow, buildRow, dishValues, toCsv, priceRule, pricePence,
} from '@shared/deliveroo.js'

const VENUE_KEY = 'maca_deliveroo_venue'
const fileKey = venueId => 'maca_deliveroo_file_' + venueId
const MAX_FILE = 8 * 1024 * 1024
const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)) } catch { return null } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)) } catch { /* full or private */ } },
}
const lsGet = k => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private */ } }

const SETTINGS_KEYS = ['menu_ids', 'price_uplift_pct', 'price_round_pence', 'price_round_mode', 'fill', 'allergen_map', 'dietary_map', 'include_may_contain', 'include_removable', 'order_type_id', 'revenue_stream_id']
const pickSettings = s => Object.fromEntries(SETTINGS_KEYS.map(k => [k, s?.[k]]))
const linkKey = l => JSON.stringify([l?.menu_item_id || null, !!l?.skip, [...(l?.keep || [])].sort(), Object.entries(l?.overrides || {}).sort()])

function saveFile(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const baseName = n => (n || 'deliveroo-menu').replace(/\.(csv|xlsx?)$/i, '')

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('That file couldn\'t be opened'))
    r.readAsDataURL(file)
  })
}

export default function MenuDeliveroo() {
  const api = useApi()
  const qc = useQueryClient()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const canEdit = !!me?.is_platform_admin || me?.permissions?.menus === 'manage'
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const [chosenVenue, setChosenVenue] = useState(() => lsGet(VENUE_KEY))
  const venueId = venues.some(v => v.id === chosenVenue) ? chosenVenue : (venues[0]?.id ?? '')

  const setupQ = useQuery({
    queryKey: ['deliveroo', venueId], queryFn: () => api.get(`/deliveroo/venues/${venueId}`), enabled: !!venueId,
  })
  const setup = setupQ.data

  // The file (this tab only)
  const [file, setFile] = useState(null)
  useEffect(() => { if (venueId) setFile(store.get(fileKey(venueId))) }, [venueId])
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState(null)
  const inputRef = useRef(null)
  async function openFile(f) {
    if (!f) return
    setReadError(null)
    if (f.size > MAX_FILE) { setReadError(new Error('That file is over 8 MB, which Deliveroo won\'t take either')); return }
    setReading(true)
    try {
      const data = await readBase64(f)
      const out = await api.post('/deliveroo/read', { file_name: f.name, data })
      setFile(out)
      store.set(fileKey(venueId), out)
      setDraftLinks({})
      setDownloaded(null)
    } catch (e) { setReadError(e) } finally { setReading(false) }
  }
  function closeFile() { setFile(null); store.set(fileKey(venueId), null); setDraftLinks({}); setDownloaded(null) }

  // Settings draft (live on the review, saved with Save)
  const [draft, setDraft] = useState(null)
  useEffect(() => { if (setup?.settings) setDraft(pickSettings(setup.settings)) }, [setup?.settings])
  const settings = useMemo(() => ({ ...(setup?.settings || {}), ...(draft || {}) }), [setup?.settings, draft])
  const settingsDirty = !!setup && !!draft && JSON.stringify(pickSettings(setup.settings)) !== JSON.stringify(draft)
  const patch = p => setDraft(d => ({ ...d, ...p }))
  const saveSettings = useMutation({
    mutationFn: () => api.put(`/deliveroo/venues/${venueId}/settings`, draft),
    onSuccess: data => qc.setQueryData(['deliveroo', venueId], data),
  })

  // Item links: saved (server) + this page's changes
  const savedLinks = useMemo(() => Object.fromEntries((setup?.links || []).map(l => [l.deliveroo_item_id, l])), [setup?.links])
  const [draftLinks, setDraftLinks] = useState({})
  useEffect(() => { setDraftLinks({}) }, [venueId])
  const linkFor = id => draftLinks[id] ?? savedLinks[id] ?? null
  const setLink = (id, name, change) => setDraftLinks(d => {
    const cur = d[id] ?? savedLinks[id] ?? { deliveroo_item_id: id, keep: [], overrides: {} }
    return { ...d, [id]: { ...cur, deliveroo_item_id: id, deliveroo_name: name, keep: cur.keep || [], overrides: cur.overrides || {}, ...change } }
  })

  // Every row worked out
  const dishes = setup?.dishes || []
  const byId = useMemo(() => Object.fromEntries(dishes.map(d => [d.id, d])), [dishes])
  const ctx = useMemo(() => ({ settings, tags: setup?.tags || [] }), [settings, setup?.tags])
  const rows = useMemo(() => {
    if (!file || !setup) return []
    return file.rows.map((row, index) => {
      const link = linkFor(row.item_id) || {}
      const match = matchRow(row, link, dishes, byId)
      const built = buildRow(row, { columns: file.columns, match, link, fill: settings.fill || {}, ctx })
      const ours = match.dish ? dishValues(match.dish, ctx) : null
      // What Save matches would store for this row
      const effective = {
        deliveroo_item_id: row.item_id, deliveroo_name: row.item_name,
        menu_item_id: link.skip ? null : (match.dish?.id ?? link.menu_item_id ?? null),
        skip: !!link.skip, keep: link.keep || [], overrides: link.overrides || {},
      }
      const errors = built.problems.filter(p => p.level === 'error').length
      return { index, row, link, match, built, ours, values: built.values, effective, errors, changed: built.changes.some(c => c.changed) }
    })
    // linkFor reads draftLinks / savedLinks
  }, [file, setup, dishes, byId, settings, ctx, draftLinks, savedLinks]) // eslint-disable-line react-hooks/exhaustive-deps

  const unsavedLinks = useMemo(() => rows.filter(r => r.row.item_id && linkKey(r.effective) !== linkKey(savedLinks[r.row.item_id] || {})), [rows, savedLinks])
  const saveLinks = useMutation({
    mutationFn: () => api.put(`/deliveroo/venues/${venueId}/links`, { links: unsavedLinks.map(r => r.effective) }),
    onSuccess: data => {
      qc.setQueryData(['deliveroo', venueId], old => old ? { ...old, links: data.links } : old)
      setDraftLinks({})
    },
  })

  // Filters
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const counts = useMemo(() => ({
    all: rows.length,
    changed: rows.filter(r => r.changed).length,
    check: rows.filter(r => ['suggested', 'none', 'missing'].includes(r.match.state)).length,
    problems: rows.filter(r => r.built.problems.length).length,
    auto: rows.filter(r => r.match.state === 'auto').length,
    linked: rows.filter(r => r.match.state === 'linked').length,
    skipped: rows.filter(r => r.match.state === 'skipped').length,
    errors: rows.reduce((n, r) => n + r.errors, 0),
  }), [rows])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === 'changed' && !r.changed) return false
      if (filter === 'check' && !['suggested', 'none', 'missing'].includes(r.match.state)) return false
      if (filter === 'problems' && !r.built.problems.length) return false
      if (t && !(r.row.item_name || '').toLowerCase().includes(t) && !(r.match.dish?.name || '').toLowerCase().includes(t)) return false
      return true
    })
  }, [rows, filter, q])

  // Modals
  const [picking, setPicking] = useState(null)   // row id
  const [editing, setEditing] = useState(null)   // row id
  const [codesOpen, setCodesOpen] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)
  const pickRow = rows.find(r => r.row.item_id === picking)
  const editRow = rows.find(r => r.row.item_id === editing)

  const usedCodes = useMemo(() => new Set(rows.flatMap(r => r.match.dish?.dietary || [])), [rows])
  const allergenGaps = (setup?.tags || []).filter(t => t.kind === 'allergen' && usedCodes.has(t.code) && !(settings.allergen_map?.[t.code] || []).length)

  // Downloads
  const [downloaded, setDownloaded] = useState(null)
  const [xlsxError, setXlsxError] = useState(null)
  function downloadCsv() {
    const text = toCsv(file.columns, rows.map(r => r.values), { eol: file.eol || '\r\n', trailing: !!file.trailing })
    const name = baseName(file.file_name) + '-updated.csv'
    saveFile(new Blob([text], { type: 'text/csv;charset=utf-8' }), name)
    setDownloaded(name)
  }
  async function downloadXlsx() {
    setXlsxError(null)
    try {
      const blob = await api.postBlob('/deliveroo/xlsx', { columns: file.columns, rows: rows.map(r => r.values), file_name: file.file_name })
      saveFile(blob, baseName(file.file_name) + '-updated.xlsx')
    } catch (e) { setXlsxError(e) }
  }

  const exampleDish = dishes.find(d => d.price_pence != null)
  const loading = setupQ.isLoading || (!!venueId && !setup && !setupQ.error)

  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">
      <PageHeader icon={Bike} title="Deliveroo menu">
        <Link to="/menus" className="hidden sm:inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground h-10 px-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Menus
        </Link>
        {venues.length > 1 && (
          <select value={venueId} onChange={e => { setChosenVenue(e.target.value); lsSet(VENUE_KEY, e.target.value) }} aria-label="Venue"
            className="h-10 rounded-xl border bg-background px-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40">
            {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
          <ErrorNote error={setupQ.error} />
          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

          {/* 1. The file */}
          <Section title="Deliveroo file"
            hint={file ? null : 'In the Deliveroo Hub go to Menu, Menu Manager, Bulk management and download the menu file. Open it here (the CSV, or the same file saved from Excel).'}
            actions={file && <Btn onClick={() => inputRef.current?.click()} disabled={reading}><Upload className="w-4 h-4" /> Another file</Btn>}>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden"
              onChange={e => { openFile(e.target.files?.[0]); e.target.value = '' }} />
            {!file ? (
              <button type="button" onClick={() => inputRef.current?.click()} disabled={reading || !venueId}
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); openFile(e.dataTransfer.files?.[0]) }}
                className="w-full min-h-[120px] rounded-xl border-2 border-dashed bg-background hover:bg-muted flex flex-col items-center justify-center gap-2 text-sm touch-manipulation disabled:opacity-50">
                <Upload className="w-6 h-6 text-muted-foreground" />
                {reading ? 'Reading...' : 'Choose the Deliveroo file, or drop it here'}
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium inline-flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-muted-foreground" />{file.file_name}</span>
                <span className="text-muted-foreground">{file.rows.length} items · {file.columns.length} columns · {file.format === 'xlsx' ? 'Excel' : 'CSV'}</span>
                <button type="button" onClick={closeFile} className="text-xs underline text-muted-foreground h-10 touch-manipulation">Close file</button>
              </div>
            )}
            <ErrorNote error={readError} />
            {file?.problems?.length > 0 && (
              <ul className="space-y-1">{file.problems.map((p, i) => <li key={i} className="text-xs rounded-lg px-3 py-2 border bg-red-50 border-red-200 text-red-800">{p}</li>)}</ul>
            )}
          </Section>

          {/* 2. How it's filled */}
          {setup && draft && (
            <Section title="How the file is filled"
              hint={settings.exists ? null : 'Not saved yet for this venue: these are the starting settings.'}
              actions={<>
                {settingsDirty && <span className="text-xs text-amber-700">Not saved</span>}
                <Btn variant="primary" disabled={!canEdit || !settingsDirty || saveSettings.isPending} onClick={() => saveSettings.mutate()}>
                  {saveSettings.isPending ? 'Saving...' : 'Save settings'}
                </Btn>
              </>}>
              <ErrorNote error={saveSettings.error} />
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Menus to match against</p>
                    <div className="flex flex-wrap gap-2">
                      {setup.menus.map(m => {
                        const on = draft.menu_ids.includes(m.id)
                        return (
                          <button key={m.id} type="button" disabled={!canEdit}
                            onClick={() => patch({ menu_ids: on ? draft.menu_ids.filter(x => x !== m.id) : [...draft.menu_ids, m.id] })}
                            className={cn('h-10 px-3 rounded-full border text-sm touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                            {m.name}{!m.is_live ? ' (never published)' : !m.live_published && ' (hidden from guests)'}
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {draft.menu_ids.length ? 'Only the menus picked.' : 'None picked: every published menu of this venue and the company.'}
                      {' '}Dishes and prices come from the live (published) version of each menu.
                      {settingsDirty && ' Save to load the dishes of a new pick.'}
                    </p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3" data-testid="deliveroo-tax">
                    <label className="block">
                      <span className="text-xs font-medium text-muted-foreground">VAT rate as order type</span>
                      <select value={draft.order_type_id || ''} disabled={!canEdit} aria-label="Order type for VAT"
                        onChange={e => patch({ order_type_id: e.target.value || null })}
                        className="mt-1 w-full border rounded-md px-3 min-h-[44px] bg-background text-sm touch-manipulation">
                        {!draft.order_type_id && <option value="">No order type</option>}
                        {(setup.order_types || []).filter(t => t.is_active || t.id === draft.order_type_id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                    {(setup.revenue_streams || []).length > 0 && (
                      <label className="block">
                        <span className="text-xs font-medium text-muted-foreground">Revenue stream</span>
                        <select value={draft.revenue_stream_id || ''} disabled={!canEdit} aria-label="Revenue stream for VAT"
                          onChange={e => patch({ revenue_stream_id: e.target.value || null })}
                          className="mt-1 w-full border rounded-md px-3 min-h-[44px] bg-background text-sm touch-manipulation">
                          <option value="">None</option>
                          {setup.revenue_streams.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </label>
                    )}
                    <p className="sm:col-span-2 text-[11px] text-muted-foreground">
                      Each dish's VAT rate is its tax setting (Menus, Tax rates) for this order type.{settingsDirty && ' Save to see the new rates.'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Delivery price: menu price plus</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <NumberBox value={draft.price_uplift_pct} decimals={2} max={200} ariaLabel="Uplift percent"
                        onChange={v => patch({ price_uplift_pct: v ?? 0 })} />
                      <span className="text-sm">%, rounded</span>
                      <Segmented value={draft.price_round_mode} onChange={v => patch({ price_round_mode: v })}
                        options={[{ value: 'up', label: 'Up' }, { value: 'nearest', label: 'Nearest' }]} disabled={!canEdit} />
                      <span className="text-sm">to</span>
                      <Segmented value={draft.price_round_pence} onChange={v => patch({ price_round_pence: v })} options={ROUND_OPTIONS} disabled={!canEdit} />
                    </div>
                    {exampleDish && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        e.g. {exampleDish.name}: {money(exampleDish.price_pence)} on the menu, {money(priceRule(exampleDish.price_pence, draft.price_uplift_pct, draft.price_round_pence, draft.price_round_mode))} on Deliveroo.
                        A dish priced only by its options uses its cheapest option.
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Columns filled from the menu</p>
                    <div className="grid sm:grid-cols-2 gap-x-4">
                      {FILL_FIELDS.map(f => (
                        <Toggle key={f.key} label={f.label} hint={f.hint} disabled={!canEdit}
                          checked={!!draft.fill?.[f.key]} onChange={v => patch({ fill: { ...draft.fill, [f.key]: v } })} />
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">An empty value on the menu never clears what Deliveroo has.</p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-4">
                    <Toggle label="List May contain allergens" checked={draft.include_may_contain} disabled={!canEdit} onChange={v => patch({ include_may_contain: v })} />
                    <Toggle label="List Can be removed allergens" checked={draft.include_removable} disabled={!canEdit} onChange={v => patch({ include_removable: v })} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Btn onClick={() => setCodesOpen(true)}><Tags className="w-4 h-4" /> Allergen and dietary codes</Btn>
                    {allergenGaps.length > 0 && (
                      <span className="text-xs text-red-700 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> {allergenGaps.map(t => t.label).join(', ')} need a Deliveroo code
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Section>
          )}

          {/* 3. Review */}
          {file && setup && (
            <Section title="Review" bodyClass="p-0 space-y-0"
              hint={`${counts.linked + counts.auto} matched (${counts.auto} automatically), ${counts.check} to check, ${counts.skipped} left as is · ${counts.changed} items change`}
              actions={<>
                {unsavedLinks.length > 0 && <span className="text-xs text-amber-700">{unsavedLinks.length} not saved</span>}
                <Btn variant="primary" disabled={!canEdit || !unsavedLinks.length || saveLinks.isPending} onClick={() => saveLinks.mutate()}>
                  {saveLinks.isPending ? 'Saving...' : 'Save matches'}
                </Btn>
              </>}>
              <div className="p-4 space-y-3 border-b">
                <ErrorNote error={saveLinks.error} />
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented value={filter} onChange={setFilter} options={[
                    { value: 'all', label: `All ${counts.all}` },
                    { value: 'changed', label: `Changes ${counts.changed}` },
                    { value: 'check', label: `To check ${counts.check}` },
                    { value: 'problems', label: `Problems ${counts.problems}` },
                  ]} />
                  <label className="relative flex-1 min-w-[12rem] max-w-sm">
                    <Search className="w-4 h-4 absolute left-3 top-3.5 text-muted-foreground" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search items" aria-label="Search items" className={cn(inputCls, 'pl-9')} />
                  </label>
                  <Btn onClick={() => setPriceOpen(true)} disabled={!shown.length}><Percent className="w-4 h-4" /> Change prices shown</Btn>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b bg-muted/40">
                      <th className="px-4 py-2 font-medium">Deliveroo item</th>
                      <th className="px-3 py-2 font-medium">Filled from</th>
                      <th className="px-3 py-2 font-medium text-right">Delivery price</th>
                      <th className="px-3 py-2 font-medium">Other changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(r => <ReviewRow key={r.row.item_id + ':' + r.index} r={r}
                      onPick={() => setPicking(r.row.item_id)} onEdit={() => setEditing(r.row.item_id)}
                      onUse={dish => setLink(r.row.item_id, r.row.item_name, { menu_item_id: dish.id, skip: false })} />)}
                    {!shown.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Nothing here.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* 4. Download */}
          {file && setup && (
            <Section title="Download">
              <div className="flex flex-wrap items-center gap-2">
                <Btn variant="primary" disabled={counts.errors > 0} onClick={downloadCsv}><Download className="w-4 h-4" /> CSV for Deliveroo</Btn>
                <Btn onClick={downloadXlsx}><FileSpreadsheet className="w-4 h-4" /> Excel, to edit</Btn>
                {counts.errors > 0 && (
                  <button type="button" onClick={() => setFilter('problems')} className="text-xs text-red-700 underline h-10 touch-manipulation">
                    Fix {counts.errors} problem{counts.errors === 1 ? '' : 's'} first
                  </button>
                )}
              </div>
              <ErrorNote error={xlsxError} />
              <p className="text-xs text-muted-foreground">
                The CSV keeps Deliveroo's columns, order and item ids; columns this page doesn't fill are left exactly as they were.
                Upload it in the Deliveroo Hub under Menu, Menu Manager, Bulk management. An upload can't be undone there, so keep the file you downloaded from Deliveroo.
                The Excel file can be edited and opened here again.
              </p>
              {downloaded && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Downloaded {downloaded}.{unsavedLinks.length > 0 && ' Save matches to keep this review for next time.'}</p>}
            </Section>
          )}
        </div>
      </div>

      {pickRow && (
        <DishPicker row={pickRow.row} match={pickRow.match} dishes={dishes} onClose={() => setPicking(null)}
          canAuto={!!(pickRow.link.menu_item_id || pickRow.link.skip)}
          onPick={d => { setLink(pickRow.row.item_id, pickRow.row.item_name, { menu_item_id: d.id, skip: false }); setPicking(null) }}
          onSkip={() => { setLink(pickRow.row.item_id, pickRow.row.item_name, { menu_item_id: null, skip: true }); setPicking(null) }}
          onAuto={() => { setLink(pickRow.row.item_id, pickRow.row.item_name, { menu_item_id: null, skip: false }); setPicking(null) }} />
      )}
      {editRow && !pickRow && (
        <ItemEditor row={editRow.row} built={editRow.built} ours={editRow.ours} link={editRow.link} match={editRow.match}
          columns={file.columns} fill={settings.fill || {}} problems={editRow.built.problems}
          onChange={change => setLink(editRow.row.item_id, editRow.row.item_name, change)}
          onMatch={() => setPicking(editRow.row.item_id)} onClose={() => setEditing(null)} />
      )}
      {codesOpen && setup && draft && (
        <CodesModal tags={setup.tags} settings={draft} usedCodes={usedCodes}
          onChange={next => canEdit && setDraft(pickSettings(next))} onClose={() => setCodesOpen(false)} />
      )}
      {priceOpen && (
        <PriceModal rows={shown} settings={settings} onClose={() => setPriceOpen(false)}
          onApply={fn => {
            for (const r of shown) {
              if (pricePence(r.values.delivery_price) == null) continue
              setLink(r.row.item_id, r.row.item_name, { overrides: { ...(r.link.overrides || {}), delivery_price: fn(r) } })
            }
            setPriceOpen(false)
          }}
          onUndo={() => {
            for (const r of shown) {
              if (!('delivery_price' in (r.link.overrides || {}))) continue
              const { delivery_price, ...rest } = r.link.overrides
              setLink(r.row.item_id, r.row.item_name, { overrides: rest })
            }
            setPriceOpen(false)
          }} />
      )}
    </div>
  )
}

const short = (field, v) => {
  const t = String(v ?? '').trim()
  if (!t) return 'empty'
  if (field === 'item_description') return t.length > 40 ? t.slice(0, 40) + '...' : t
  if (field === 'allergens' || field === 'dietary_information') return t.split(',').join(', ')
  return t
}

function ReviewRow({ r, onPick, onEdit, onUse }) {
  const price = r.built.changes.find(c => c.field === 'delivery_price')
  const others = r.built.changes.filter(c => c.field !== 'delivery_price' && c.changed)
  const kept = r.built.changes.filter(c => c.source === 'keep').length
  const typed = r.built.changes.filter(c => c.source === 'edit' && c.changed).length
  const best = r.match.suggestions?.[0]
  return (
    <tr className={cn('border-b align-top', r.errors ? 'bg-red-50/40' : r.changed ? '' : 'text-muted-foreground')}>
      <td className="px-4 py-3">
        <button type="button" onClick={onEdit} className="text-left min-h-[44px] touch-manipulation group">
          <span className="block font-medium text-foreground group-hover:underline">{r.row.item_name || '(no name)'}</span>
          <span className="block text-[11px] text-muted-foreground">{r.row.item_id}</span>
        </button>
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col items-start gap-1">
          <StateBadge state={r.match.state} />
          <button type="button" onClick={onPick} className="text-left min-h-[44px] touch-manipulation max-w-[280px]">
            {r.match.dish
              ? <><span className="block text-foreground">{r.match.dish.name}</span><span className="block text-[11px] text-muted-foreground truncate">{dishLine(r.match.dish)}</span></>
              : <span className="text-primary underline">{r.match.state === 'skipped' ? 'Change' : 'Choose dish'}</span>}
          </button>
        </div>
        {!r.match.dish && r.match.state !== 'skipped' && best && (
          <button type="button" onClick={() => onUse(best.dish)}
            className="mt-1 h-9 px-3 rounded-lg border bg-background hover:bg-muted text-xs touch-manipulation">
            Use {best.dish.name}
          </button>
        )}
      </td>
      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
        {price && price.changed
          ? <><span className="text-muted-foreground line-through mr-1">£{r.row.delivery_price}</span><span className="font-semibold text-foreground">£{price.to}</span>
              {price.source === 'edit' && <span className="block text-[11px] text-muted-foreground">typed</span>}
              {price.note && <span className="block text-[11px] text-muted-foreground">{price.note}</span>}</>
          : <span>£{r.values.delivery_price}</span>}
      </td>
      <td className="px-3 py-3">
        <button type="button" onClick={onEdit} className="text-left w-full min-h-[44px] touch-manipulation space-y-1">
          {others.map(c => (
            <span key={c.field} className="block text-xs">
              <span className="font-medium text-foreground">{FIELD_LABEL[c.field]}</span>{' '}
              {c.field === 'item_description'
                ? <span className="text-muted-foreground">{c.from ? 'replaced' : 'added'}{c.source === 'edit' ? ' (typed)' : ''}</span>
                : <span className="text-muted-foreground">{short(c.field, c.from)} {'->'} <span className="text-foreground">{short(c.field, c.to)}</span>{c.source === 'edit' ? ' (typed)' : ''}</span>}
            </span>
          ))}
          {!others.length && !kept && !typed && <span className="text-xs text-muted-foreground">{r.match.dish ? 'Nothing else changes' : '-'}</span>}
          {kept > 0 && <span className="block text-[11px] text-muted-foreground">Deliveroo's value kept for {kept} column{kept === 1 ? '' : 's'}</span>}
          {r.built.problems.map((p, i) => (
            <span key={i} className={cn('flex items-start gap-1 text-[11px]', p.level === 'error' ? 'text-red-700' : 'text-amber-800')}>
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {FIELD_LABEL[p.field] || p.field}: {p.text}
            </span>
          ))}
        </button>
      </td>
    </tr>
  )
}

