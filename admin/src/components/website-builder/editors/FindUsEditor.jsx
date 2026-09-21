// Editor for the Find us block.
//
// Address / phone / email / map embed content itself lives in the venue's
// Find us + Contact admin sections (see FindUsSection/ContactSection in
// Website.jsx) — this block only controls DISPLAY: which of those fields
// to show, an optional "Get directions" button, and a rich-text field for
// directions/parking notes that isn't part of the shared config.
import { ExternalLink } from 'lucide-react'
import { FormRow } from '../shared'
import { RichTextEditor } from '@/components/RichTextEditor'

export function FindUsEditor({ data, onChange, onJumpTo }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-3">
      <FormRow label="Heading">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>

      {onJumpTo && (
        <button type="button" onClick={() => onJumpTo('find')}
          className="w-full inline-flex items-center justify-center gap-1.5 text-sm border rounded-md px-3 py-2 min-h-[36px] hover:bg-accent">
          <ExternalLink className="w-3.5 h-3.5" />
          Edit address & map
        </button>
      )}

      <div className="space-y-1.5 pt-1">
        <span className="text-xs font-medium block">Show on this block</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.hide_address !== true}
            onChange={e => set('hide_address')(!e.target.checked)} />
          Address
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.hide_phone !== true}
            onChange={e => set('hide_phone')(!e.target.checked)} />
          Phone
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.hide_email !== true}
            onChange={e => set('hide_email')(!e.target.checked)} />
          Email
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm pt-1">
        <input type="checkbox" checked={!!data.show_directions_button}
          onChange={e => set('show_directions_button')(e.target.checked)} />
        Show a "Get directions" button
      </label>
      {data.show_directions_button && (
        <FormRow label="Button label">
          <input value={data.directions_button_text || ''} onChange={e => set('directions_button_text')(e.target.value)}
            placeholder="Get directions"
            className="w-full text-sm border rounded-md px-2 py-1.5" />
        </FormRow>
      )}

      <FormRow label="Directions / parking info (optional)"
        hint="Extra text shown under the address — bus routes, parking, which entrance to use, etc.">
        <RichTextEditor value={data.directions_html || ''} onChange={set('directions_html')}
          scope="website:find-us" placeholder="e.g. Parking available on Baldock Street after 6pm…" />
      </FormRow>
    </div>
  )
}
