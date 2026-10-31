// src/hooks/usePermission.js
//
// The caller's access to a module, from /me: 'none' | 'view' | 'use' | 'manage'.
// View means the page can be opened and used to look things up; Manage is
// needed to change anything. Use (only on modules that offer it: checklists,
// food safety, the H&S action log) sits between them: the everyday work
// (ticking a checklist, logging a temperature) without changing the setup.
// Screens hide or disable their change controls when canManage (or, for the
// everyday work, canUse) is false, and the API refuses the change too, so
// this only decides what is shown. Platform admins always manage.
//
//   const { canManage } = usePermission('cash_recon')
//   const { canUse } = usePermission('checklists')

import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'

export function usePermission(moduleKey) {
  const api = useApi()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), staleTime: 60_000 })
  const level = me?.is_platform_admin ? 'manage' : (me?.permissions?.[moduleKey] ?? 'none')
  return {
    level,
    canView:   level !== 'none',
    canUse:    level === 'use' || level === 'manage',
    canManage: level === 'manage',
    // A few changes also stay owner / admin on the API (e.g. Cash Recon
    // settings, unsubmitting a day, deleting a booking).
    isOwnerOrAdmin: !!me?.is_platform_admin || ['owner', 'admin'].includes(me?.role),
    isOwner:   !!me?.is_platform_admin || me?.role === 'owner',
    loaded:    !!me,
  }
}
