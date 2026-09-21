// Editor for the CTA strip block.
//
// `ctas[]` mirrors the Hero block's CTA shape ({ text, link, style }) so
// the two "multiple buttons" implementations stay consistent — see
// HeroEditor.jsx for the same pattern.
import { Plus, X } from 'lucide-react'
import { FormRow } from '../shared'
import { LinkPicker } from '../LinkPicker'

export function CtaStripEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const ctas = Array.isArray(data.ctas) ? data.ctas : []

  function patchCta(i, patch) {
    const next = ctas.slice(); next[i] = { ...next[i], ...patch }
    set('ctas')(next)
  }
  function addCta() {
    set('ctas')([...ctas, { text: 'New button', link: '#reservations', style: 'primary' }])
  }
  function removeCta(i) {
    set('ctas')(ctas.filter((_, j) => j !== i))
  }

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
      <FormRow label="Background style">
        <select value={data.bg_style || 'primary'} onChange={e => set('bg_style')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5 bg-background">
          <option value="primary">Primary brand colour</option>
          <option value="accent">Accent colour</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </FormRow>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium">Buttons</span>
          {ctas.length < 3 && (
            <button type="button" onClick={addCta}
              className="text-xs inline-flex items-center gap-1 bg-primary/10 text-primary rounded px-2 py-1 font-medium">
              <Plus className="w-3 h-3" /> Add button
            </button>
          )}
        </div>
        {ctas.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No buttons yet — add one above.</p>
        )}
        <div className="space-y-2">
          {ctas.map((cta, i) => (
            <div key={i} className="border rounded p-2 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2">
                <input value={cta.text || ''} onChange={e => patchCta(i, { text: e.target.value })}
                  placeholder="Button text"
                  className="flex-1 text-sm border rounded-md px-2 py-1.5" />
                <button type="button" onClick={() => removeCta(i)}
                  className="text-destructive hover:bg-destructive/10 p-1.5 rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <LinkPicker value={cta.link || ''} onChange={v => patchCta(i, { link: v })} className="flex-1" />
                <select value={cta.style || 'primary'} onChange={e => patchCta(i, { style: e.target.value })}
                  className="text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px] w-32">
                  <option value="primary">Primary</option>
                  <option value="secondary">Secondary</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
