// Standalone Brand & theme card for container width + boxed inset.
// Render next to BrandThemeSection (see Website.jsx tenant-brand).

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { BrandLayoutFields } from './BrandLayoutFields'
import { DEFAULT_BOXED_STEP, DEFAULT_CONTAINER_MAX_PX } from './boxedLayout'

function mergeSpacing(existing) {
  return {
    container_max_px: existing?.container_max_px ?? DEFAULT_CONTAINER_MAX_PX,
    boxed_step:       existing?.boxed_step ?? DEFAULT_BOXED_STEP,
    section_y_px:     existing?.section_y_px ?? 72,
    section_y_mobile_px: existing?.section_y_mobile_px ?? 48,
    gap_px:           existing?.gap_px ?? 24,
  }
}

export function BrandLayoutSection() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: brand = {} } = useQuery({
    queryKey: ['brand-defaults'],
    queryFn:  () => api.get('/website/brand-defaults'),
  })
  const hasBrand = !!brand?.id
  const baseline = useMemo(() => mergeSpacing(brand.theme?.spacing), [brand.theme])
  const [spacing, setSpacing] = useState(baseline)
  useEffect(() => setSpacing(baseline), [baseline])
  const dirty = JSON.stringify(spacing) !== JSON.stringify(baseline)

  const save = useMutation({
    mutationFn: () => {
      const theme = { ...(brand.theme || {}), spacing: { ...(brand.theme?.spacing || {}), ...spacing } }
      return hasBrand
        ? api.patch('/website/brand-defaults', { theme })
        : api.post('/website/brand-defaults', { theme })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brand-defaults'] })
      qc.invalidateQueries({ queryKey: ['tenant-site'] })
    },
  })

  function setPath(_section, key, value) {
    setSpacing(s => ({ ...s, [key]: value }))
  }

  return (
    <div className="bg-background border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b bg-muted/40">
        <h2 className="text-sm font-semibold">Layout</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Container max width (boxed blocks) and side inset. Default width 1100px, inset step 2 (24px).
        </p>
      </div>
      <div className="p-5 space-y-5">
        <BrandLayoutFields theme={{ spacing }} setPath={setPath} />
        <div className="flex justify-end pt-2 border-t">
          <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
            className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save layout
          </button>
        </div>
      </div>
    </div>
  )
}
