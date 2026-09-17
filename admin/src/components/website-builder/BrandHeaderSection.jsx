// Shared site-wide header default — admin/src/pages/Website.jsx > Site > Header.
//
// Every page uses this (tenant_site.header_config) unless that specific
// page's own header mode is set to "Custom here" (adds its own override
// block) or "Off" (see PageBuilder's Header/Footer mode picker).

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useApi } from '@/lib/api'
import { HeaderBlockEditor } from './editors/SiteBlockEditors'
import { LinkCatalogProvider } from './LinkPicker'

export function BrandHeaderSection() {
  const api = useApi()
  const qc  = useQueryClient()
  const { data: tenantSite = {}, isLoading } = useQuery({
    queryKey: ['tenant-site'],
    queryFn:  () => api.get('/website/tenant-site'),
  })
  const baseline = useMemo(() => tenantSite.header_config || {}, [tenantSite.header_config])
  const [data, setData] = useState(baseline)
  useEffect(() => setData(baseline), [baseline])
  const dirty = JSON.stringify(data) !== JSON.stringify(baseline)

  const save = useMutation({
    mutationFn: () => api.patch('/website/tenant-site', { header_config: data }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['tenant-site'] }),
  })

  const catalogValue = useMemo(() => ({
    currentBlocks: [],
    currentLabel:  'Header (shared)',
    homeBlocks:    tenantSite.home_blocks || [],
    venueSlug:     null,
    venueId:       null,
  }), [tenantSite.home_blocks])

  return (
    <LinkCatalogProvider value={catalogValue}>
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/40">
          <h2 className="text-sm font-semibold">Header</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            The shared header every page uses by default. A specific page can still override
            this or turn its header off in its own page builder (Header/Footer mode picker).
          </p>
        </div>
        <div className="p-5 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <HeaderBlockEditor data={data} onChange={setData} />
          )}
          <div className="flex justify-end pt-2 border-t">
            <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
              className="bg-primary text-primary-foreground text-sm font-medium rounded-md px-4 py-2 min-h-[40px] inline-flex items-center gap-2 disabled:opacity-50">
              {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save header
            </button>
          </div>
          {save.isError && (
            <p className="text-xs text-destructive">{save.error?.body?.error || 'Save failed'}</p>
          )}
        </div>
      </div>
    </LinkCatalogProvider>
  )
}
