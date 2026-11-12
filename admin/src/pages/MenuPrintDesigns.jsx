// src/pages/MenuPrintDesigns.jsx
//
// Menus > Menu print designer (/menus/print-designs, its own main menu entry
// since migration 241). Every menu with its print designs: which one the
// print page uses, each design's paper and pages, and a way into the
// designer (/menus/print-designs/:menuId, MenuDesigner.jsx; ?design=<id>
// opens one design). A menu with no design prints in the automatic layout,
// and its button opens the designer's start screen.
//
// Read-only here: designs are made, copied, renamed and deleted in the
// designer itself. Menus view opens them, Menus manage saves there.
// Data: GET /api/menus (print_design_id, design_count) and
// GET /api/menus/print-designs (every design with its layout).

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpenText, BookOpen, Loader2, Pencil, Plus, Printer, Search, ArrowRight } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { PageHeader } from '@/components/staff/shared'
import { normalizeLayout } from '@shared/menuLayout.js'

// "A4 landscape · 2 pages · folded"
export function designSummary(layout) {
  const l = normalizeLayout(layout)
  const pages = l.pages.length
  return [
    `${l.paper_size} ${l.orientation}`,
    `${pages} page${pages === 1 ? '' : 's'}`,
    l.fold !== 'none' ? 'folded' : null,
  ].filter(Boolean).join(' · ')
}

const day = iso => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3 rounded-lg text-sm font-medium touch-manipulation shrink-0'

export default function MenuPrintDesigns() {
  const api = useApi()
  const { canManage } = usePermission('menus')
  const [q, setQ] = useState('')

  const menus = useQuery({ queryKey: ['menus'], queryFn: () => api.get('/menus') })
  const designs = useQuery({ queryKey: ['menu-print-designs'], queryFn: () => api.get('/menus/print-designs') })

  const byMenu = useMemo(() => {
    const m = new Map()
    for (const d of designs.data || []) {
      if (!m.has(d.menu_id)) m.set(d.menu_id, [])
      m.get(d.menu_id).push(d)
    }
    return m
  }, [designs.data])

  const words = q.trim().toLowerCase()
  const shown = (menus.data || []).filter(m => {
    if (!words) return true
    if (m.name.toLowerCase().includes(words)) return true
    return (byMenu.get(m.id) || []).some(d => d.name.toLowerCase().includes(words))
  })
  const loading = menus.isLoading || designs.isLoading
  const failed = menus.isError || designs.isError

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="menu-print-designs">
      <PageHeader icon={BookOpenText} title="Menu print designer" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Printed menus placed by hand: sections, dishes, pictures and notes on the page, with as many designs for a menu as you
            need. A menu with no design prints in the automatic layout.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <label className="relative flex-1 min-w-[12rem]">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a menu or a design" aria-label="Find a menu or a design"
                data-testid="mpd-search"
                className="w-full h-12 rounded-lg border bg-background pl-9 pr-3 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </label>
            <Link to="/menus" data-testid="mpd-menus-link" className={cn(BTN, 'border bg-background hover:bg-muted')}>
              <BookOpen className="w-4 h-4" /> Menus <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : failed ? (
            <p className="text-sm text-destructive" data-testid="mpd-error">The menus couldn't be loaded. Reload the page to try again.</p>
          ) : !(menus.data || []).length ? (
            <div className="rounded-xl border bg-background p-8 text-center space-y-3" data-testid="mpd-empty">
              <p className="text-sm text-muted-foreground">There are no menus yet. Make a menu first, then design how it prints.</p>
              <Link to="/menus" className={cn(BTN, 'bg-primary text-primary-foreground hover:bg-primary/90')}>Open Menus</Link>
            </div>
          ) : !shown.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center" data-testid="mpd-none">No menu or design matches "{q.trim()}".</p>
          ) : shown.map(m => {
            const list = byMenu.get(m.id) || []
            const to = '/menus/print-designs/' + m.id
            return (
              <section key={m.id} className="rounded-xl border bg-background overflow-hidden" data-testid="mpd-menu" data-menu={m.id}>
                <div className="px-4 py-3 section-head flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[10rem]">
                    <h2 className="text-sm font-semibold truncate" data-testid="mpd-menu-name">{m.name}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5" data-testid="mpd-menu-prints">
                      {m.venue_name || 'Every venue'} · {m.print_design_id
                        ? 'Prints with ' + (list.find(d => d.id === m.print_design_id)?.name || 'a design')
                        : 'Prints in the automatic layout'}
                    </p>
                  </div>
                  <Link to={to} data-testid="mpd-open-menu" className={cn(BTN, list.length ? 'border bg-background hover:bg-muted' : 'bg-primary text-primary-foreground hover:bg-primary/90')}>
                    {list.length
                      ? <><Pencil className="w-4 h-4" /> {canManage ? 'Open the designer' : 'Open'}</>
                      : <><Plus className="w-4 h-4" /> {canManage ? 'Start a design' : 'Open'}</>}
                  </Link>
                </div>
                {list.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="mpd-no-designs">No design yet.</p>
                ) : (
                  <ul className="divide-y">
                    {list.map(d => (
                      <li key={d.id} data-testid="mpd-design" data-design={d.id}>
                        <Link to={to + '?design=' + d.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 min-h-[56px] py-2 hover:bg-muted/50 touch-manipulation">
                          <span className="text-sm font-medium min-w-[8rem] flex-1 truncate" data-testid="mpd-design-name">{d.name}</span>
                          {m.print_design_id === d.id && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800" data-testid="mpd-printing">
                              <Printer className="w-3 h-3" /> Printing
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground" data-testid="mpd-design-summary">{designSummary(d.layout)}</span>
                          <span className="text-xs text-muted-foreground">{d.updated_at ? 'Changed ' + day(d.updated_at) : ''}</span>
                          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
