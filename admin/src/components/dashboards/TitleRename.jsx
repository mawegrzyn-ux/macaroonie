// src/components/dashboards/TitleRename.jsx
//
// Edit-layout rename row shared by the H&S/Cash dashboard widget cards
// (HSDashboard.jsx WidgetCard) and the Overview tiles (Dashboard.jsx
// TileCard). Explicit Save; an empty name, or "Use default", clears the
// custom title (title_override = null) so the built-in name shows again.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TitleRename({ title, defaultTitle, isCustom, maxLength = 100, onSave, isSaving }) {
  const [value, setValue] = useState(title ?? '')
  useEffect(() => setValue(title ?? ''), [title])

  const trimmed = value.trim()
  const changed = trimmed !== (title ?? '').trim()

  function save() {
    if (!changed) return
    onSave(trimmed && trimmed !== defaultTitle ? trimmed : null)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-muted/10 text-xs">
      <label className="text-muted-foreground shrink-0">Name</label>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={defaultTitle}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save() }}
        aria-label="Name"
        className="h-9 flex-1 min-w-[8rem] rounded-lg border bg-background px-2.5 text-sm touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <button type="button" onClick={save} disabled={!changed || isSaving}
        className={cn(
          'h-9 px-3 rounded-lg text-xs font-medium touch-manipulation disabled:opacity-40 flex items-center gap-1',
          changed ? 'bg-primary text-primary-foreground' : 'border',
        )}>
        {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
      </button>
      {isCustom && !changed && (
        <button type="button" onClick={() => onSave(null)} disabled={isSaving}
          className="h-9 px-3 rounded-lg border text-xs touch-manipulation hover:bg-accent disabled:opacity-40">
          Use default
        </button>
      )}
    </div>
  )
}
