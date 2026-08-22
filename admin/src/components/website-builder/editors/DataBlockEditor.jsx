// Generic editor for blocks that pull content from elsewhere
// (gallery, hours, contact, etc). Heading + a jump to the section
// that owns the data.
import { FormRow } from '../shared'
import { ExternalLink } from 'lucide-react'

const SOURCE_HINT = {
  gallery:        'Manage images on the dedicated Gallery section. Layout style + size are set there too.',
  opening_hours:  'Uses the venue Schedule by default. Open Opening hours to advertise different times.',
  find_us:        'Address + map embed live in the Find us section.',
  contact:        'Phone, email, social links live in the Contact section.',
  reservations_widget: 'Pick which venue\'s widget to embed in the Reservations widget section.',
  menu_pdfs:      'Upload PDFs in the Menus section.',
  allergens:      'Manage allergen info in the Allergens section.',
}

const JUMP = {
  opening_hours: { key: 'hours', label: 'Edit opening hours' },
}

export function DataBlockEditor({ blockType, data, onChange, onJumpTo }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const jump = JUMP[blockType]
  return (
    <div className="space-y-3">
      <FormRow label="Heading"
        hint={SOURCE_HINT[blockType] || 'Content for this block lives in another section.'}>
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)}
          className="w-full text-sm border rounded-md px-2 py-1.5" />
      </FormRow>
      {jump && onJumpTo ? (
        <button type="button" onClick={() => onJumpTo(jump.key)}
          className="w-full inline-flex items-center justify-center gap-1.5 text-sm border rounded-md px-3 py-2 min-h-[36px] hover:bg-accent">
          <ExternalLink className="w-3.5 h-3.5" />
          {jump.label}
        </button>
      ) : (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <ExternalLink className="w-3 h-3" />
          Content for this block is managed elsewhere — it pulls automatically.
        </p>
      )}
    </div>
  )
}
