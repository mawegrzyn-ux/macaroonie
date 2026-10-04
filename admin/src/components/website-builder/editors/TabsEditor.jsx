// Editor for the Tabs block: the tab list (name, optional link anchor,
// drag to reorder, add, remove) and how the tab strip looks. What goes in
// each tab is edited on the canvas: pick a tab there and add blocks to it.

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { FormRow } from '../shared'
import { ThemeColourPicker } from '../ThemeColourPicker'
import { sanitizeAnchorId } from '../blockRegistry'
import { SortableRows } from '@/components/staff/shared'

const STYLES = [
  { v: 'underline', label: 'Underline' },
  { v: 'pills',     label: 'Pills' },
  { v: 'boxed',     label: 'Boxed' },
]
const ALIGNS = [
  { v: 'left',    label: 'Left' },
  { v: 'center',  label: 'Centre' },
  { v: 'stretch', label: 'Full width' },
]

function Choice({ options, value, onChange }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(o => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          className={`text-sm border rounded-md min-h-[40px] touch-manipulation
            ${value === o.v ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function TabsEditor({ data, onChange }) {
  const tabs = Array.isArray(data.tabs) ? data.tabs : []
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const [confirmId, setConfirmId] = useState(null)

  const patchTab = (id, patch) => set('tabs')(tabs.map(t => (t.id === id ? { ...t, ...patch } : t)))
  const addTab = () => set('tabs')([...tabs, { id: crypto.randomUUID(), label: `Tab ${tabs.length + 1}`, anchor: '', blocks: [] }])
  const removeTab = (id) => { set('tabs')(tabs.filter(t => t.id !== id)); setConfirmId(null) }
  const reorder = (ids) => set('tabs')(ids.map(id => tabs.find(t => t.id === id)).filter(Boolean))

  return (
    <div className="space-y-3">
      <FormRow label="Tabs" hint="Drag to reorder. Pick a tab on the page to add blocks to it.">
        <SortableRows items={tabs} onReorder={reorder} renderItem={t => {
          const count = (t.blocks || []).length
          return (
            <div className="space-y-1.5 py-1">
              <div className="flex items-center gap-1.5">
                <input value={t.label ?? ''} onChange={e => patchTab(t.id, { label: e.target.value })}
                  placeholder="Tab name" aria-label="Tab name"
                  className="flex-1 min-w-0 text-sm border rounded-md px-2 h-10 bg-background touch-manipulation" />
                {tabs.length > 1 && (confirmId === t.id ? (
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => removeTab(t.id)}
                      className="h-10 px-2 rounded-md bg-destructive text-destructive-foreground text-xs touch-manipulation">
                      Remove{count ? ` + ${count} block${count === 1 ? '' : 's'}` : ''}
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)}
                      className="h-10 px-2 rounded-md border text-xs touch-manipulation">Cancel</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmId(t.id)} aria-label={`Remove ${t.label || 'tab'}`}
                    className="w-10 h-10 shrink-0 flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 touch-manipulation">
                    <Trash2 className="w-4 h-4" />
                  </button>
                ))}
              </div>
              <input value={t.anchor ?? ''} onChange={e => patchTab(t.id, { anchor: sanitizeAnchorId(e.target.value) })}
                placeholder="Link anchor (optional), e.g. lunch" aria-label="Tab link anchor"
                className="w-full text-xs border rounded-md px-2 h-9 bg-background touch-manipulation" />
              <p className="text-[11px] text-muted-foreground">{count} block{count === 1 ? '' : 's'}</p>
            </div>
          )
        }} />
        <button type="button" onClick={addTab} disabled={tabs.length >= 10}
          className="mt-2 w-full h-10 rounded-md border text-sm flex items-center justify-center gap-1.5 hover:bg-accent touch-manipulation disabled:opacity-50">
          <Plus className="w-4 h-4" /> Add tab
        </button>
      </FormRow>

      <FormRow label="Tab style">
        <Choice options={STYLES} value={data.style || 'underline'} onChange={set('style')} />
      </FormRow>

      <FormRow label="Tab alignment">
        <Choice options={ALIGNS} value={data.align || 'center'} onChange={set('align')} />
      </FormRow>

      <FormRow label="Active tab colour">
        <ThemeColourPicker value={data.active_colour || ''} onChange={set('active_colour')} noneLabel="Primary" />
      </FormRow>

      <FormRow label="On phones" hint="Phones can keep the tab strip (it scrolls sideways) or show each tab as a drop-down section.">
        <Choice options={[{ v: 'tabs', label: 'Tabs' }, { v: 'accordion', label: 'Drop-down sections' }]}
          value={data.mobile || 'tabs'} onChange={set('mobile')} />
      </FormRow>

      <FormRow label="Background">
        <select value={data.background || 'default'} onChange={e => set('background')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[40px]">
          <option value="default">None</option>
          <option value="surface">Subtle</option>
          <option value="accent">Accent</option>
        </select>
      </FormRow>
    </div>
  )
}
