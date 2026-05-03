// Editor for the divider block.
import { FormRow } from '../shared'

export function DividerEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <FormRow label="Style">
          <select value={data.style || 'line'} onChange={e => set('style')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="line">Thin line</option>
            <option value="thick">Thick line</option>
            <option value="space">Space only</option>
          </select>
        </FormRow>
        <FormRow label="Size">
          <select value={data.size || 'medium'} onChange={e => set('size')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </FormRow>
        <FormRow label="Colour">
          <select value={data.color || 'auto'} onChange={e => set('color')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="auto">Auto (theme border)</option>
            <option value="muted">Muted</option>
            <option value="accent">Accent</option>
          </select>
        </FormRow>
      </div>
    </div>
  )
}
