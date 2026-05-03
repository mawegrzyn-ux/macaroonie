// Editor for the FAQ block — repeatable Q/A list.
import { FormRow } from '../shared'
import { Plus, Trash2 } from 'lucide-react'

export function FaqEditor({ data, onChange }) {
  const items = Array.isArray(data.items) ? data.items : []
  const set = (next) => onChange({ ...data, ...next })
  return (
    <div className="space-y-3">
      <FormRow label="Heading">
        <input value={data.heading || ''} onChange={e => set({ heading: e.target.value })}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="border rounded-md p-2 space-y-1.5 bg-muted/20">
            <input value={it.q || ''} placeholder="Question"
              onChange={e => set({ items: items.map((x, j) => j === i ? { ...x, q: e.target.value } : x) })}
              className="w-full text-sm border rounded-md px-2 py-1.5 font-medium bg-background" />
            <textarea value={it.a || ''} placeholder="Answer" rows={2}
              onChange={e => set({ items: items.map((x, j) => j === i ? { ...x, a: e.target.value } : x) })}
              className="w-full text-sm border rounded-md px-2 py-1.5 bg-background" />
            <div className="flex justify-end">
              <button type="button" onClick={() => set({ items: items.filter((_, j) => j !== i) })}
                className="text-xs text-destructive inline-flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => set({ items: [...items, { q: '', a: '' }] })}
        className="inline-flex items-center gap-1 text-sm text-primary">
        <Plus className="w-3.5 h-3.5" /> Add Q&amp;A
      </button>
    </div>
  )
}
