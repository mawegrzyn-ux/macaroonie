// Generic editor for blocks that pull content from elsewhere
// (gallery, hours, contact, etc). Just exposes a heading + a hint
// pointing the user at the source.
import { FormRow } from '../shared'
import { ExternalLink } from 'lucide-react'

const SOURCE_HINT = {
  gallery:        'Manage images on the dedicated Gallery section. Layout style + size are set there too.',
  opening_hours:  'Manage hours on the Opening hours section. Toggle between manual and venue-derived there.',
  find_us:        'Address + map embed live in the Find us section.',
  contact:        'Phone, email, social links live in the Contact section.',
  booking_widget: 'Pick which venue\'s widget to embed in the Booking widget section.',
  menu_pdfs:      'Upload PDFs in the Menus section.',
  allergens:      'Manage allergen info in the Allergens section.',
}

export function DataBlockEditor({ blockType, data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  return (
    <div className="space-y-3">
      <FormRow label="Heading"
        hint={SOURCE_HINT[blockType] || 'Content for this block lives in another section.'}>
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <ExternalLink className="w-3 h-3" />
        Content for this block is managed elsewhere — it pulls automatically.
      </p>
    </div>
  )
}
