// src/pages/MenuTimes.jsx
//
// Menus > Menu times (/menus/times, migration 230): one table per location
// of when each menu is on, for the website (online ordering), the
// self-order kiosks and the tills. Each menu has its own times (days, times
// of day and dates; none = any time); each channel follows them, is on at
// any time, has its own times, or is off. The rules are shared/menuTimes.js,
// the same the API, the tills and the kiosks use. Menus view reads, Menus
// manage saves (one Save for the table).

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Clock, Loader2, AlertTriangle, Info, Globe, Monitor, ShoppingCart } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { Card } from '@/components/menus/shared'
import { Modal } from '@/components/staff/shared'
import { ScheduleEditor } from '@/components/orders/ScheduleEditor'
import {
  CHANNELS, CHANNEL_LABELS, USES, USE_LABELS, cleanRow, channelLabel, timesLabel, menuTimesProblems, menuTimesWarnings,
} from '@shared/menuTimes.js'

const errText = e => e?.body?.error || e?.message || 'Something went wrong'
const ICONS = { web: Globe, kiosk: Monitor, till: ShoppingCart }
const VENUE_KEY = 'maca_menu_times_venue'

// What a row sends: the menu, its times and the three channels.
const bodyOf = r => ({ menu_id: r.menu_id, times: r.times, web: r.web, kiosk: r.kiosk, till: r.till })

/** The window for a schedule: the menu's own times, or a channel's own times. */
function TimesWindow({ title, hint, value, onDone, onClose, readOnly }) {
  const [sched, setSched] = useState(value || null)
  return (
    <Modal title={title} onClose={onClose}
      footer={readOnly ? null : <>
        <button type="button" onClick={() => onDone(sched)} data-testid="mt-times-done"
          className="min-h-[44px] px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold touch-manipulation">Done</button>
        <button type="button" onClick={onClose}
          className="min-h-[44px] px-4 rounded-md border text-sm touch-manipulation">Cancel</button>
      </>}>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <p className="text-sm font-medium flex items-center gap-1.5" data-testid="mt-times-label"><Clock className="w-4 h-4 text-primary" /> {timesLabel(sched)}</p>
      <ReadOnlyFieldset disabled={readOnly}>
        <ScheduleEditor alwaysOpen value={sched} onChange={setSched} alwaysLabel="Any time" resetLabel="Clear: any time" />
      </ReadOnlyFieldset>
    </Modal>
  )
}

/** A channel's cell: Off / Menu's times / Any time / Own times, and what that means. */
function ChannelCell({ row, ch, name, onChange, onEditOwn, problem }) {
  const cell = row[ch]
  return (
    <div className="space-y-1" data-testid="mt-cell" data-channel={ch} data-use={cell.use}>
      <select value={cell.use} aria-label={name + ' on ' + CHANNEL_LABELS[ch].toLowerCase()}
        onChange={e => {
          const use = e.target.value
          if (use === 'own') return onEditOwn(cell.times || row.times || null)
          onChange({ use, times: null })
        }}
        className={cn('w-full text-sm border rounded-md px-2 bg-background min-h-[44px] touch-manipulation', cell.use === 'off' && 'text-muted-foreground')}>
        {USES.map(u => <option key={u} value={u}>{USE_LABELS[u]}</option>)}
      </select>
      {cell.use !== 'off' && (
        <p className="text-xs text-muted-foreground leading-snug" data-testid="mt-cell-label">{channelLabel(row, ch)}</p>
      )}
      {cell.use === 'own' && (
        <button type="button" onClick={() => onEditOwn(cell.times)} data-testid="mt-cell-edit"
          className="text-xs text-primary underline underline-offset-2 min-h-[32px] touch-manipulation">Change times</button>
      )}
      {problem && <p className="text-xs text-destructive" data-testid="mt-cell-problem">{problem}</p>}
    </div>
  )
}

/** The menu's own times. */
function TimesCell({ row, onEdit, problem }) {
  return (
    <div className="space-y-1" data-testid="mt-times">
      <p className="text-sm leading-snug" data-testid="mt-times-text">{timesLabel(row.times)}</p>
      <button type="button" onClick={onEdit} data-testid="mt-times-edit"
        className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2 min-h-[32px] touch-manipulation">
        <Clock className="w-3.5 h-3.5" /> {row.times ? 'Change' : 'Set times'}
      </button>
      {problem && <p className="text-xs text-destructive" data-testid="mt-times-problem">{problem}</p>}
    </div>
  )
}

function MenuName({ menu }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium break-words">{menu.name}</p>
      <p className="text-[11px] text-muted-foreground">{menu.own ? 'This location only' : 'Shared menu'}</p>
      {!menu.live && <p className="text-[11px] text-amber-700" data-testid="mt-not-live">Not published yet: nobody sees it until it is.</p>}
    </div>
  )
}

export default function MenuTimes() {
  const api = useApi()
  const qc = useQueryClient()
  const { canManage } = usePermission('menus')
  const { data: venues = [] } = useQuery({ queryKey: ['venues'], queryFn: () => api.get('/venues') })
  const [venueId, setVenueId] = useState(() => { try { return localStorage.getItem(VENUE_KEY) || '' } catch { return '' } })
  useEffect(() => {
    if (venues.length && !venues.some(v => v.id === venueId)) setVenueId(venues[0].id)
  }, [venues, venueId])
  const pickVenue = id => { setVenueId(id); try { localStorage.setItem(VENUE_KEY, id) } catch { /* private mode */ } }

  const key = ['menu-times', venueId]
  const q = useQuery({ queryKey: key, queryFn: () => api.get(`/menu-times/venues/${venueId}`), enabled: !!venueId })
  const saved = useMemo(() => (q.data?.rows || []).map(r => cleanRow(r)), [q.data])
  const [draft, setDraft] = useState(null)
  useEffect(() => { setDraft(saved.map(r => structuredClone(r))) }, [saved])
  const [editing, setEditing] = useState(null)   // { menuId, ch (null = the menu's times), value }

  const save = useMutation({
    mutationFn: rows => api.put(`/menu-times/venues/${venueId}`, { rows: rows.map(bodyOf) }),
    onSuccess: view => {
      qc.setQueryData(key, view)
      qc.invalidateQueries({ queryKey: ['ordering-settings', venueId] })
    },
  })

  const data = q.data
  const menus = data?.menus || []
  const byId = Object.fromEntries(menus.map(m => [m.id, m]))
  const names = Object.fromEntries(menus.map(m => [m.id, m.name]))
  const today = data ? new Date().toLocaleDateString('en-CA', { timeZone: data.venue.timezone }) : null
  const rows = draft || []
  const problems = menuTimesProblems(rows, names)
  const warnings = menuTimesWarnings(rows, names, today)
  const problemOf = (menuId, ch) => problems.find(p => p.menu_id === menuId && p.channel === ch)?.message || null
  const dirty = draft && JSON.stringify(draft.map(bodyOf)) !== JSON.stringify(saved.map(bodyOf))

  const setRow = (menuId, patch) => setDraft(d => d.map(r => (r.menu_id === menuId ? cleanRow({ ...r, ...patch }) : r)))
  const setCell = (menuId, ch, cell) => setRow(menuId, { [ch]: cell })
  const openTimes = (menuId, ch, value) => setEditing({ menuId, ch, value })
  const doneTimes = sched => {
    const { menuId, ch } = editing
    if (ch) setCell(menuId, ch, { use: 'own', times: sched })
    else setRow(menuId, { times: sched })
    setEditing(null)
  }

  const streams = (data?.streams || []).filter(s => s.menu_ids.length)
  const tills = data?.devices?.till || 0
  const kiosks = data?.devices?.kiosk || 0
  const venue = venues.find(v => v.id === venueId)

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-6 max-lg:notouch:pl-14 max-w-6xl mx-auto space-y-4 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <Link to="/menus" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 min-h-[32px]">
              <ChevronLeft className="w-3.5 h-3.5" /> All menus
            </Link>
            <h1 className="text-xl font-semibold mt-1 flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> Menu times</h1>
          </div>
          {venues.length > 1 && (
            <select value={venueId} onChange={e => pickVenue(e.target.value)} aria-label="Location" data-testid="mt-venue"
              className="border rounded-md px-3 min-h-[44px] text-sm bg-background touch-manipulation">
              {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          When each menu is on at {venue ? venue.name : 'this location'}: on the website, the self-order kiosks and the tills.
          Give a menu its times (days, times of day and dates, e.g. lunch Monday to Friday 11:00 to 15:00); each place follows them,
          or is on at any time, has its own times, or is off. Several menus can be on at once: each place shows them all.
          A till with no menu on shows every menu (staff can pick in More &gt; Menus); a kiosk with no menu on doesn't take orders.
        </p>

        {!canManage && <ReadOnlyNotice what="menu times" />}
        {(q.isLoading || !draft) && venueId && <Loader2 className="w-5 h-5 animate-spin" />}
        {q.error && <p className="text-sm text-destructive">{errText(q.error)}</p>}

        {data && draft && (
          <>
            <div className="space-y-2 text-sm" data-testid="mt-notes">
              {data.ordering && !data.ordering.is_enabled && (
                <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2" data-testid="mt-note-ordering">
                  <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <span>Online ordering is switched off at this location: the Website column counts once it's on in <Link to="/orders/settings" className="underline">Ordering setup</Link>.</span>
                </p>
              )}
              <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2" data-testid="mt-note-devices">
                <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <span>
                  {tills + ' till' + (tills === 1 ? '' : 's') + ' and ' + kiosks + ' kiosk' + (kiosks === 1 ? '' : 's') + ' here. '}
                  {streams.length
                    ? 'Tills and kiosks show the menus their revenue stream offers: ' + streams.map(s => s.name + ' (' + s.menu_ids.map(id => names[id]).filter(Boolean).join(', ') + ')').join('; ') + '.'
                    : 'They show every menu here, at its times.'}
                </span>
              </p>
            </div>

            {!menus.length && <p className="text-sm text-muted-foreground">No menus yet. Build one on the <Link to="/menus" className="underline">Menus</Link> page.</p>}

            {menus.length > 0 && (
              <Card title="When each menu is on" description="Menu's times: the place follows the menu's own times. Changes reach the tills and kiosks within a minute; the website at once.">
                <ReadOnlyFieldset disabled={!canManage}>
                  {/* The table from medium screens; a card per menu on a phone. */}
                  <div className="hidden md:block">
                    <table className="w-full table-fixed text-left" data-testid="mt-table">
                      <thead>
                        <tr className="text-xs text-muted-foreground border-b">
                          <th className="py-2 pr-3 font-medium w-[22%]">Menu</th>
                          <th className="py-2 pr-3 font-medium w-[21%]">Times</th>
                          {CHANNELS.map(ch => {
                            const Icon = ICONS[ch]
                            return <th key={ch} className="py-2 pr-3 font-medium"><span className="inline-flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {CHANNEL_LABELS[ch]}</span></th>
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => byId[r.menu_id] && (
                          <tr key={r.menu_id} className="border-b last:border-0 align-top" data-testid="mt-row" data-menu={r.menu_id}>
                            <td className="py-3 pr-3"><MenuName menu={byId[r.menu_id]} /></td>
                            <td className="py-3 pr-3"><TimesCell row={r} problem={problemOf(r.menu_id, null)} onEdit={() => openTimes(r.menu_id, null, r.times)} /></td>
                            {CHANNELS.map(ch => (
                              <td key={ch} className="py-3 pr-3">
                                <ChannelCell row={r} ch={ch} name={names[r.menu_id]} problem={problemOf(r.menu_id, ch)}
                                  onChange={cell => setCell(r.menu_id, ch, cell)} onEditOwn={v => openTimes(r.menu_id, ch, v)} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="md:hidden space-y-3" data-testid="mt-cards">
                    {rows.map(r => byId[r.menu_id] && (
                      <div key={r.menu_id} className="rounded-lg border p-3 space-y-3" data-testid="mt-card" data-menu={r.menu_id}>
                        <MenuName menu={byId[r.menu_id]} />
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Times</p>
                          <TimesCell row={r} problem={problemOf(r.menu_id, null)} onEdit={() => openTimes(r.menu_id, null, r.times)} />
                        </div>
                        <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3">
                          {CHANNELS.map(ch => (
                            <div key={ch}>
                              <p className="text-xs font-medium text-muted-foreground mb-1">{CHANNEL_LABELS[ch]}</p>
                              <ChannelCell row={r} ch={ch} name={names[r.menu_id]} problem={problemOf(r.menu_id, ch)}
                                onChange={cell => setCell(r.menu_id, ch, cell)} onEditOwn={v => openTimes(r.menu_id, ch, v)} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </ReadOnlyFieldset>

                {warnings.length > 0 && (
                  <ul className="space-y-1" data-testid="mt-warnings">
                    {warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-800 bg-amber-50 rounded-md px-3 py-2 flex items-start gap-2" data-testid="mt-warning">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w.message}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {canManage && (
              <div className="sticky bottom-0 z-30 bg-background/95 border-t -mx-4 sm:mx-0 p-3 flex flex-wrap items-center justify-end gap-3" data-testid="mt-save-bar">
                {problems.length > 0 && <span className="text-sm text-destructive" data-testid="mt-problem">{problems[0].message}</span>}
                {save.error && <span className="text-sm text-destructive" data-testid="mt-save-error">{errText(save.error)}</span>}
                {save.isSuccess && !dirty && <span className="text-sm text-emerald-700" data-testid="mt-saved">Saved</span>}
                <button type="button" onClick={() => setDraft(saved.map(r => structuredClone(r)))} disabled={!dirty}
                  className="min-h-[48px] px-4 rounded-md border text-sm touch-manipulation disabled:opacity-40" data-testid="mt-discard">Discard</button>
                <button type="button" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending || problems.length > 0} data-testid="mt-save"
                  className="min-h-[48px] px-6 rounded-md bg-primary text-primary-foreground text-sm font-semibold touch-manipulation disabled:opacity-40">
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </>
        )}

        {editing && (
          <TimesWindow
            title={editing.ch ? `${names[editing.menuId]} on ${CHANNEL_LABELS[editing.ch].toLowerCase()}: own times` : `${names[editing.menuId]}: times`}
            hint={editing.ch
              ? `Only ${CHANNEL_LABELS[editing.ch].toLowerCase()} use these; the other places keep their own setting. Clear them to have it on at any time there.`
              : 'The menu\'s own times: every place set to Menu\'s times follows them. None set: on at any time.'}
            value={editing.value} readOnly={!canManage}
            onDone={doneTimes} onClose={() => setEditing(null)} />
        )}
      </div>
    </div>
  )
}
