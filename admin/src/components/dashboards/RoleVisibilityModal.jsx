// src/components/dashboards/RoleVisibilityModal.jsx
//
// "Who can see it": a tick per role, ticked = sees it. Saves the roles left
// unticked as hidden_role_ids (Overview tiles, dashboards). Roles come from
// GET /api/access/roles; a role made later sees it until someone unticks it.

import { useState } from 'react'
import { X } from 'lucide-react'

export function RoleVisibilityModal({ title = 'Visible to', hint, note, hiddenRoleIds, roles, onClose, onSave, isSaving }) {
  const [hidden, setHidden] = useState(hiddenRoleIds ?? [])

  function toggle(roleId) {
    setHidden(ids => ids.includes(roleId) ? ids.filter(x => x !== roleId) : [...ids, roleId])
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-sm max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}
        role="dialog" aria-label={title} data-testid="role-visibility">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded hover:bg-accent touch-manipulation"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">{hint ?? 'Untick a role to hide this from it.'}</p>
        <div className="border rounded-md divide-y mb-4">
          {roles.map(r => (
            <label key={r.id} className="flex items-center gap-2 px-3 py-2.5 text-sm touch-manipulation min-h-[44px]" data-testid="role-visibility-row" data-role-id={r.id}>
              <input type="checkbox" checked={!hidden.includes(r.id)} onChange={() => toggle(r.id)} className="w-4 h-4" />
              {r.label}
            </label>
          ))}
        </div>
        {note && <p className="text-xs text-muted-foreground mb-4">{note}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded text-sm min-h-[44px] touch-manipulation">Cancel</button>
          <button type="button" disabled={isSaving} onClick={() => onSave(hidden)} data-testid="role-visibility-save"
            className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-50 touch-manipulation">
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** "Everyone", or who it is hidden from: "Hidden from Viewer, Operator"
 *  ("Hidden from 2 roles" until the roles have loaded). */
export function visibilityText(hiddenRoleIds, roles) {
  const ids = hiddenRoleIds ?? []
  if (!ids.length) return 'Everyone'
  const names = ids.map(id => roles.find(r => r.id === id)?.label).filter(Boolean)
  if (names.length < ids.length) return 'Hidden from ' + ids.length + (ids.length === 1 ? ' role' : ' roles')
  return 'Hidden from ' + names.join(', ')
}
