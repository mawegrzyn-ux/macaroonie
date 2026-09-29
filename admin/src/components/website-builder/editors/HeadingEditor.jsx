// Editor for the Heading block (api/src/views/site/blocks/heading.eta).
// Styles come from shared/headingBlock.js, shared with the canvas preview.
import { cn } from '@/lib/utils'
import { FormRow } from '../shared'
import { FontPicker } from '../FontPicker'
import { ThemeColourPicker } from '../ThemeColourPicker'
import { FONT_OPTIONS } from '@shared/fonts.js'

const input = 'w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]'

function Pills({ value, options, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          className={cn('text-sm border rounded-md px-3 min-h-[36px] touch-manipulation',
            value === k ? 'bg-primary/10 border-primary text-primary font-medium' : 'bg-background hover:bg-accent')}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm min-h-[36px] cursor-pointer touch-manipulation">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4" />
      {label}
    </label>
  )
}

export function HeadingEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const fontMode = !data.font_family ? 'heading' : data.font_family === '@body' ? 'body' : 'custom'
  return (
    <div className="space-y-3">
      <FormRow label="Heading">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)} className={input} />
      </FormRow>
      <FormRow label="Small line above (optional)" hint="e.g. OUR MENU. Shown in capitals in the decoration colour.">
        <input value={data.eyebrow || ''} onChange={e => set('eyebrow')(e.target.value)} className={input} />
      </FormRow>
      <FormRow label="Line below (optional)">
        <textarea rows={2} value={data.subheading || ''} onChange={e => set('subheading')(e.target.value)} className={input} />
      </FormRow>

      <FormRow label="Heading level" hint="For search engines and screen readers. Use one H1 per page, usually the page's main title.">
        <Pills value={data.level || 'h2'} onChange={set('level')}
          options={[['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3'], ['h4', 'H4']]} />
      </FormRow>
      <FormRow label="Size" hint="Automatic follows the level. Large sizes shrink to fit on phones.">
        <select value={data.size || 'auto'} onChange={e => set('size')(e.target.value)} className={input}>
          <option value="auto">Automatic</option>
          <option value="sm">Small</option>
          <option value="md">Medium</option>
          <option value="lg">Large</option>
          <option value="xl">Extra large</option>
          <option value="xxl">Huge</option>
        </select>
      </FormRow>
      <FormRow label="Alignment">
        <Pills value={data.align || 'center'} onChange={set('align')}
          options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} />
      </FormRow>

      <FormRow label="Font">
        <Pills value={fontMode} onChange={m => set('font_family')(m === 'heading' ? '' : m === 'body' ? '@body' : (FONT_OPTIONS[0] || 'Inter'))}
          options={[['heading', 'Theme heading'], ['body', 'Theme body'], ['custom', 'Pick a font']]} />
        {fontMode === 'custom' && (
          <div className="mt-2">
            <FontPicker fonts={FONT_OPTIONS} value={data.font_family} onChange={set('font_family')} />
          </div>
        )}
      </FormRow>
      <FormRow label="Weight">
        <select value={String(data.font_weight || '')} onChange={e => set('font_weight')(e.target.value)} className={input}>
          <option value="">Theme heading weight</option>
          <option value="300">Light (300)</option>
          <option value="400">Regular (400)</option>
          <option value="500">Medium (500)</option>
          <option value="600">Semi-bold (600)</option>
          <option value="700">Bold (700)</option>
          <option value="800">Extra bold (800)</option>
        </select>
      </FormRow>
      <div className="flex flex-wrap gap-x-4">
        <Check label="Italic" checked={data.italic} onChange={set('italic')} />
        <Check label="Capitals" checked={data.uppercase} onChange={set('uppercase')} />
      </div>

      <FormRow label="Decoration">
        <Pills value={data.decoration || 'none'} onChange={set('decoration')}
          options={[['none', 'None'], ['bar', 'Short bar'], ['rules', 'Lines either side']]} />
      </FormRow>

      <FormRow label="Heading colour" hint="Default: primary.">
        <ThemeColourPicker value={data.colour || ''} onChange={set('colour')} noneLabel="Default" />
      </FormRow>
      <FormRow label="Line below colour" hint="Default: muted.">
        <ThemeColourPicker value={data.sub_colour || ''} onChange={set('sub_colour')} noneLabel="Default" />
      </FormRow>
      <FormRow label="Small line and decoration colour" hint="Default: accent.">
        <ThemeColourPicker value={data.decoration_colour || ''} onChange={set('decoration_colour')} noneLabel="Default" />
      </FormRow>
      <FormRow label="Background">
        <ThemeColourPicker value={data.background || ''} onChange={set('background')} noneLabel="None" />
      </FormRow>
      <FormRow label="Space above and below">
        <Pills value={data.spacing || 'md'} onChange={set('spacing')}
          options={[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']]} />
      </FormRow>
    </div>
  )
}
