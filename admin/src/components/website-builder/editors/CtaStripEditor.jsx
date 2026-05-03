// Editor for the CTA strip block.
import { FormRow } from '../shared'

export function CtaStripEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-3">
      <FormRow label="Heading">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      <FormRow label="Subheading (optional)">
        <input value={data.subheading || ''} onChange={e => set('subheading')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      <div className="grid grid-cols-2 gap-2">
        <FormRow label="Button label">
          <input value={data.cta_text || ''} onChange={e => set('cta_text')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5" />
        </FormRow>
        <FormRow label="Button link">
          <input value={data.cta_link || ''} onChange={e => set('cta_link')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 font-mono" />
        </FormRow>
      </div>
      <FormRow label="Background style">
        <select value={data.bg_style || 'primary'} onChange={e => set('bg_style')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          <option value="primary">Primary brand colour</option>
          <option value="accent">Accent colour</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </FormRow>
    </div>
  )
}
