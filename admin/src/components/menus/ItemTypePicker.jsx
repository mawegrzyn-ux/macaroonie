// What a menu, section or dish is (migration 267, shared/catalogue.js):
// food and drink, retail goods or services. The menu always has one; a
// section or dish can follow the level above ("Same as ...") or set its own,
// the most specific winning, as tax does.
import { ITEM_TYPES, TYPE_LABELS } from '@shared/catalogue.js'

export function ItemTypePicker({ value, onChange, inherit = null, inheritLabel = '', readOnly = false, title, hint }) {
  const own = ITEM_TYPES.includes(value) ? value : ''
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{title}</span>
      <select value={own} disabled={readOnly} data-testid="item-type"
        onChange={e => onChange(e.target.value || null)}
        className="w-full min-h-[44px] rounded-md border bg-background px-2 text-sm touch-manipulation">
        {inherit && <option value="">{inheritLabel} ({TYPE_LABELS[inherit]})</option>}
        {ITEM_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
      </select>
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** A small label for a section or dish whose own type isn't food, or null. */
export function ItemTypeBadge({ type }) {
  if (!type || type === 'food') return null
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 shrink-0" data-testid="item-type-badge"
      title={'Sold as ' + TYPE_LABELS[type].toLowerCase()}>
      {type === 'goods' ? 'Retail' : 'Service'}
    </span>
  )
}
