// Editor for the Online ordering block (migration 126): the ordering app
// (menu, basket, checkout) as a page block. See
// api/src/views/site/blocks/online_ordering.eta for how the venue is chosen.
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { FormRow } from '../shared'

export function OnlineOrderingEditor({ data, onChange }) {
  const api = useApi()
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
    staleTime: 60_000,
  })
  return (
    <div className="space-y-3">
      <FormRow label="Venue"
        hint="Automatic: on /order the venue the guest chose; on a location page that location; with one venue taking online orders, that venue; otherwise guests pick a location. Only venues with online ordering switched on (Online orders, Setup) show anything.">
        <select value={data.venue_id || ''} onChange={e => set('venue_id')(e.target.value || null)}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]">
          <option value="">Automatic</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </FormRow>
      <FormRow label="Heading (optional)" hint="Shown above the menu.">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={!!data.hide_title}
          onChange={e => set('hide_title')(e.target.checked)} />
        <span>
          Hide the venue name
          <span className="block text-xs text-muted-foreground mt-0.5">
            Useful when a hero or heading above already says where the order is from.
          </span>
        </span>
      </label>
    </div>
  )
}
