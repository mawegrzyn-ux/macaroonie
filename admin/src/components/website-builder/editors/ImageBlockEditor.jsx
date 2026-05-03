// Editor for the single-image block.
import { ImageField, FormRow } from '../shared'

export function ImageBlockEditor({ data, onChange, scope }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-3">
      <FormRow label="Image">
        <ImageField url={data.url} onChange={set('url')} scope={scope || 'website:content'} />
      </FormRow>
      <div className="grid grid-cols-2 gap-2">
        <FormRow label="Alt text" hint="For screen readers + SEO.">
          <input value={data.alt || ''} onChange={e => set('alt')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5" />
        </FormRow>
        <FormRow label="Caption">
          <input value={data.caption || ''} onChange={e => set('caption')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5" />
        </FormRow>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FormRow label="Width">
          <select value={data.max_width || 'normal'} onChange={e => set('max_width')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="narrow">Narrow</option>
            <option value="normal">Normal</option>
            <option value="wide">Wide</option>
            <option value="full">Full bleed</option>
          </select>
        </FormRow>
        <FormRow label="Align">
          <select value={data.align || 'center'} onChange={e => set('align')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </FormRow>
      </div>
    </div>
  )
}
