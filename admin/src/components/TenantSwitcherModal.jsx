// src/components/TenantSwitcherModal.jsx
// Shared tenant-picker modal used both for the mandatory first-choice
// screen (TenantGate, no `onClose` — nothing to dismiss to) and the
// voluntary "Change tenant" action from the sidebar (AppShell, dismissible).
// Replaces the old sidebar <select> dropdown per Standard Design Rule #2
// (no hover-only affordances) — a dropdown option list is also awkward to
// tap accurately on a tablet; a full-width button list is not.

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function TenantSwitcherModal({
  tenants,
  currentTenantId,
  onPick,
  onClose,
  title = 'Choose a restaurant',
  subtitle,
  footer,
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded hover:bg-accent touch-manipulation shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {subtitle && <p className="text-sm text-muted-foreground mb-4">{subtitle}</p>}
        <ul className="space-y-2">
          {tenants.map(t => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onPick(t.id)}
                className={cn(
                  'w-full text-left text-sm rounded border px-3 py-2.5 min-h-[48px] touch-manipulation',
                  t.id === currentTenantId ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                )}
              >
                <span className="font-medium">{t.name}</span>
                {t.slug && (
                  <span className="block text-xs text-muted-foreground">{t.slug}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {footer}
      </div>
    </div>
  )
}
