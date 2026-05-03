// Editor for the rich-text block.
import { RichTextEditor } from '@/components/RichTextEditor'
import { FormRow } from '../shared'

export function TextEditor({ data, onChange, scope }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-3">
      <RichTextEditor value={data.html || ''} onChange={set('html')} scope={scope || 'website:text'} />
      <div className="grid grid-cols-3 gap-2">
        <FormRow label="Width">
          <select value={data.max_width || 'normal'} onChange={e => set('max_width')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="narrow">Narrow (700px)</option>
            <option value="normal">Normal (980px)</option>
            <option value="wide">Wide (1200px)</option>
          </select>
        </FormRow>
        <FormRow label="Align">
          <select value={data.align || 'left'} onChange={e => set('align')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="left">Left</option>
            <option value="center">Center</option>
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
    </div>
  )
}
