// Editor for the Columns block — sets column count, gap, alignment,
// and stacking breakpoint. The actual column contents are edited
// inline on the canvas (each column is its own drop target).

import { FormRow } from '../shared'

export function ColumnsEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const cols = Array.isArray(data.columns) ? data.columns : []

  function setCount(n) {
    const next = cols.slice()
    while (next.length < n) next.push({ id: crypto.randomUUID(), blocks: [] })
    if (next.length > n) {
      // Merge dropped columns' blocks into the last surviving column so
      // nothing is silently lost when the operator shrinks the layout.
      const dropped = next.splice(n)
      const trailing = dropped.flatMap(c => c.blocks || [])
      if (trailing.length) {
        const last = next[next.length - 1]
        next[next.length - 1] = { ...last, blocks: [...(last.blocks || []), ...trailing] }
      }
    }
    onChange({ ...data, columns: next })
  }

  return (
    <div className="space-y-3">
      <FormRow label="Columns">
        <div className="grid grid-cols-3 gap-1.5">
          {[2, 3, 4].map(n => (
            <button key={n} type="button" onClick={() => setCount(n)}
              className={`text-sm border rounded-md py-2 min-h-[36px]
                ${cols.length === n ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent'}`}>
              {n} cols
            </button>
          ))}
        </div>
      </FormRow>

      <FormRow label="Gap" hint="Space between columns.">
        <select value={data.gap || 'normal'} onChange={e => set('gap')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          <option value="tight">Tight (16px)</option>
          <option value="normal">Normal (32px)</option>
          <option value="wide">Wide (56px)</option>
        </select>
      </FormRow>

      <FormRow label="Vertical align">
        <select value={data.align || 'top'} onChange={e => set('align')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          <option value="top">Top</option>
          <option value="center">Centre</option>
          <option value="bottom">Bottom</option>
          <option value="stretch">Stretch</option>
        </select>
      </FormRow>

      <FormRow label="Stack on" hint="When the screen narrows, when do columns become rows?">
        <select value={data.stackOn || 'mobile'} onChange={e => set('stackOn')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          <option value="mobile">Mobile (≤700px)</option>
          <option value="tablet">Mobile + tablet (≤900px)</option>
          <option value="never">Never (always side-by-side)</option>
        </select>
      </FormRow>

      <FormRow label="Background">
        <select value={data.background || 'default'} onChange={e => set('background')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          <option value="default">None</option>
          <option value="surface">Subtle</option>
          <option value="accent">Accent</option>
        </select>
      </FormRow>
    </div>
  )
}
