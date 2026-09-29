// Editor for the Promo block (migration 131): advertises one online
// ordering promotion with a button to the ordering page that has it
// ready. See api/src/views/site/blocks/promo_cta.eta.
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { FormRow } from '../shared'
import { ThemeColourPicker } from '../ThemeColourPicker'
import { promoSummary, promoLink } from '@shared/promotions.js'

const input = 'w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]'

function Check({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-2 text-sm min-h-[36px] cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}

export function usePromotions() {
  const api = useApi()
  return useQuery({ queryKey: ['promotions'], queryFn: () => api.get('/promotions'), staleTime: 30_000, retry: false })
}

export function PromoCtaEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const { data: promos = [], isError } = usePromotions()
  const promo = promos.find(p => p.id === data.promo_id)
  const style = data.style === 'card' ? 'card' : 'banner'
  return (
    <div className="space-y-3">
      <FormRow label="Promotion"
        hint="The block only shows while this promotion is running: switched on, within its dates and not used up.">
        <select value={data.promo_id || ''} onChange={e => set('promo_id')(e.target.value || null)} className={input}>
          <option value="">Choose a promotion</option>
          {promos.map(p => <option key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (off)'}</option>)}
        </select>
        {isError && <p className="text-xs text-destructive mt-1">Could not load promotions (you may not have access to them).</p>}
        <Link to="/promotions" className="text-xs text-primary underline mt-1 inline-block">Manage promotions</Link>
      </FormRow>
      {promo && (
        <p className="text-xs text-muted-foreground">
          {promoSummary(promo)}. Button goes to <span className="font-mono">{promoLink(promo)}</span>
          {promo.apply_mode === 'code' && ' — putting a code promotion here publishes its code.'}
        </p>
      )}
      <FormRow label="Heading" hint="Blank: the promotion's name.">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)} placeholder={promo?.name || ''} className={input} />
      </FormRow>
      <FormRow label="Text" hint="Blank: the promotion's description, or what it takes off.">
        <textarea rows={2} value={data.text || ''} onChange={e => set('text')(e.target.value)} className={input} />
      </FormRow>
      {promo?.apply_mode === 'code' && (
        <Check label="Show the code" checked={data.show_code !== false} onChange={set('show_code')}
          hint="The button applies the code either way." />
      )}
      <Check label="Show the small print" checked={data.show_terms !== false} onChange={set('show_terms')}
        hint="Minimum spend, times and dates." />
      <FormRow label="Button text">
        <input value={data.button_text || ''} onChange={e => set('button_text')(e.target.value)} placeholder="Order now" className={input} />
      </FormRow>
      <FormRow label="Button link" hint="Blank: the ordering page with this offer ready.">
        <input value={data.button_link || ''} onChange={e => set('button_link')(e.target.value)} placeholder="Automatic" className={input} />
      </FormRow>
      <FormRow label="Style">
        <div className="grid grid-cols-2 gap-1.5">
          {[['banner', 'Banner'], ['card', 'Voucher card']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => set('style')(k)}
              className={'text-sm border rounded-md px-2 py-2 min-h-[44px] touch-manipulation ' + (style === k ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent')}>
              {label}
            </button>
          ))}
        </div>
      </FormRow>
      <FormRow label="Background">
        <ThemeColourPicker value={data.bg || 'primary'} onChange={set('bg')} allowNone={false} />
      </FormRow>
      <FormRow label="Text colour" hint="Inherit: white, or the text colour on a light background.">
        <ThemeColourPicker value={data.fg || ''} onChange={v => set('fg')(v || '')} />
      </FormRow>
    </div>
  )
}
