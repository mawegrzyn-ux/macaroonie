// src/components/ReadOnlyNotice.jsx
//
// A thin bar telling someone with View access that they can look but not
// change: shown at the top of a page (or a section) whose change controls
// are hidden or disabled for them. See hooks/usePermission.js.

import { Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ReadOnlyNotice({ what = 'this page', className }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 text-sky-900 px-3 py-2 text-sm', className)}>
      <Eye className="w-4 h-4 shrink-0" />
      <span>View only: your role can see {what} but not change it.</span>
    </div>
  )
}

// Wraps a block of form controls and disables every input, select, textarea
// and button inside it when `disabled` (a native <fieldset disabled>), so a
// settings form reads as-is without its controls working. Looks like a plain
// block: no border, margin or padding.
export function ReadOnlyFieldset({ disabled, className, children }) {
  return (
    <fieldset disabled={disabled} className={cn('min-w-0 m-0 p-0 border-0', className)}>
      {children}
    </fieldset>
  )
}
