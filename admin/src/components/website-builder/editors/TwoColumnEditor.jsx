// Editor for the two-column (image + text) block.
import { RichTextEditor } from '@/components/RichTextEditor'
import { ImageField, FormRow } from '../shared'

export function TwoColumnEditor({ data, onChange, scope }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-3">
      <FormRow label="Image">
        <ImageField url={data.image_url} onChange={set('image_url')} scope={scope || 'website:two_column'} />
      </FormRow>
      <FormRow label="Image alt text">
        <input value={data.image_alt || ''} onChange={e => set('image_alt')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      <FormRow label="Heading">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      <FormRow label="Body">
        <RichTextEditor value={data.body_html || ''} onChange={set('body_html')} scope={scope || 'website:two_column'} />
      </FormRow>
      <div className="grid grid-cols-2 gap-2">
        <FormRow label="CTA label">
          <input value={data.cta_text || ''} onChange={e => set('cta_text')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5" />
        </FormRow>
        <FormRow label="CTA link">
          <input value={data.cta_link || ''} onChange={e => set('cta_link')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 font-mono" />
        </FormRow>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <FormRow label="Image side">
          <select value={data.image_side || 'left'} onChange={e => set('image_side')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </FormRow>
        <FormRow label="Gap">
          <select value={data.gap || 'normal'} onChange={e => set('gap')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="tight">Tight</option>
            <option value="normal">Normal</option>
            <option value="wide">Wide</option>
          </select>
        </FormRow>
        <FormRow label="Background">
          <select value={data.background || 'default'} onChange={e => set('background')(e.target.value)}
            className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
            <option value="default">None</option>
            <option value="surface">Subtle</option>
          </select>
        </FormRow>
      </div>
    </div>
  )
}
