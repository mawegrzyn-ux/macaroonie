// src/components/reports/LayoutPick.jsx
//
// Which layout template a saved report or page prints with (docs/REPORTS.md
// 11): the group's default, or one of its layouts. Made and changed on the
// Layouts page (/reports/layouts, Manage); picked here by whoever may change
// the report (PUT /reports/:id/layout).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useApi } from '@/lib/api'
import { Modal } from '@/components/staff/shared'
import { Problems, retryUnlessRefused } from '@/components/reports/shared'
import { cn } from '@/lib/utils'

export const useLayouts = () => {
  const api = useApi()
  return useQuery({ queryKey: ['report-layouts'], queryFn: () => api.get('/reports/layouts'), retry: retryUnlessRefused })
}

export function LayoutPickWindow({ report, onSaved, onClose }) {
  const api = useApi()
  const q = useLayouts()
  const [state, setState] = useState({ busy: null, error: null })
  const layouts = q.data?.layouts || []
  const fallback = layouts.find(l => l.is_default)
  const pick = async layoutId => {
    setState({ busy: layoutId || 'default', error: null })
    try {
      await api.put('/reports/' + encodeURIComponent(report.id) + '/layout', { layout_id: layoutId })
      onSaved({ ...report, layout_id: layoutId })
    } catch (error) {
      setState({ busy: null, error })
    }
  }
  const row = (id, name, words) => {
    const on = (report.layout_id || null) === id
    return (
      <button key={id || 'default'} type="button" onClick={() => pick(id)} disabled={!!state.busy} data-testid="layout-pick" data-id={id || 'default'} aria-pressed={on}
        className={cn('w-full text-left flex items-start gap-3 min-h-[56px] px-3 py-2 rounded-lg border bg-background touch-manipulation hover:bg-muted disabled:opacity-50', on && 'border-primary')}>
        <span className="flex-1">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block text-[11px] text-muted-foreground">{words}</span>
        </span>
        {on && <Check className="w-4 h-4 text-primary mt-1 shrink-0" />}
      </button>
    )
  }
  return (
    <Modal title="How it looks on paper" onClose={onClose}>
      <Problems error={q.error || state.error} title={state.error ? 'The layout wasn\'t changed' : undefined} />
      <div className="space-y-2" data-testid="layout-pick-list">
        {row(null, 'The group\'s default', fallback ? fallback.name + ': ' + fallback.words : 'As reports print without a layout')}
        {layouts.map(l => row(l.id, l.name, l.words))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {q.data?.can_manage ? <>Layouts are made on the <Link to="/reports/layouts" className="underline">Layouts page</Link>.</> : 'Someone with Manage on Reports makes layouts.'}
      </p>
    </Modal>
  )
}
