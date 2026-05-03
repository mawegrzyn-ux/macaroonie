// Editor for the hero block.
import { ImageField, FormRow } from '../shared'

export function HeroEditor({ data, onChange, scope }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-3">
      <FormRow label="Background image">
        <ImageField url={data.image_url} onChange={set('image_url')} scope={scope || 'website:hero'} />
      </FormRow>
      <FormRow label="Heading">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5 min-h-[36px]" />
      </FormRow>
      <FormRow label="Subheading">
        <textarea value={data.subheading || ''} onChange={e => set('subheading')(e.target.value)}
          rows={2}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      <div className="grid grid-cols-2 gap-2">
        <FormRow label="CTA label">
          <input value={data.cta_text || ''} onChange={e => set('cta_text')(e.target.value)}
            placeholder="Book a table"
            className="w-full text-sm border rounded-md px-2 py-1.5" />
        </FormRow>
        <FormRow label="CTA link">
          <input value={data.cta_link || ''} onChange={e => set('cta_link')(e.target.value)}
            placeholder="#booking"
            className="w-full text-sm border rounded-md px-2 py-1.5 font-mono" />
        </FormRow>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <FormRow label="Height">
          <select value={data.height || 'medium'} onChange={e => set('height')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="full">Full screen</option>
          </select>
        </FormRow>
        <FormRow label="Align text">
          <select value={data.align || 'center'} onChange={e => set('align')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="left">Left</option>
            <option value="center">Center</option>
          </select>
        </FormRow>
        <FormRow label="Overlay">
          <input type="range" min={0} max={1} step={0.05}
            value={data.overlay_opacity ?? 0.4}
            onChange={e => set('overlay_opacity')(Number(e.target.value))}
            className="w-full" />
        </FormRow>
      </div>
    </div>
  )
}
