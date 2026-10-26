// Editor for the Loyalty block (migration 211): promotes the loyalty
// programme with a button to its web app (/loyalty). See
// api/src/views/site/blocks/loyalty_cta.eta.
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { FormRow } from '../shared'
import { ThemeColourPicker } from '../ThemeColourPicker'

const input = 'w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]'

/** What the block shows: null while loyalty or its web app is off. */
export function useLoyaltyTeaser() {
  const api = useApi()
  return useQuery({ queryKey: ['loyalty-teaser'], queryFn: () => api.get('/loyalty/teaser'), staleTime: 30_000, retry: false })
}

/** How points and stamps are earned, in words (the block's text when left blank). */
export function teaserText(t) {
  if (!t) return ''
  const points = t.how || ''
  const stamps = t.stamp_cards.map(c => c.name + ': ' + c.stamps_needed + ' stamps fill a card.').join(' ')
  return [points, stamps].filter(Boolean).join(' ')
}

export function LoyaltyCtaEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const { data: res, isError } = useLoyaltyTeaser()
  const t = res?.teaser || null
  const style = data.style === 'card' ? 'card' : 'banner'
  return (
    <div className="space-y-3" data-testid="loyalty-cta-editor">
      {res && !t && (
        <p className="text-xs rounded-md bg-amber-50 text-amber-900 border border-amber-200 p-2" data-testid="loyalty-cta-off">
          Hidden on the website: loyalty or its web app is switched off.
        </p>
      )}
      {isError && <p className="text-xs text-destructive">Could not load the loyalty programme.</p>}
      <Link to="/loyalty?tab=programme" className="text-xs text-primary underline inline-block">Loyalty programme settings</Link>
      <FormRow label="Heading" hint="Blank: Join and the programme's name.">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)} placeholder={t ? 'Join ' + t.name : ''} className={input} />
      </FormRow>
      <FormRow label="Text" hint="Blank: how points and stamps are earned.">
        <textarea rows={2} value={data.text || ''} onChange={e => set('text')(e.target.value)} placeholder={teaserText(t)} className={input} />
      </FormRow>
      <label className="flex items-start gap-2 text-sm min-h-[36px] cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={data.show_rewards !== false} onChange={e => set('show_rewards')(e.target.checked)} />
        <span>Show rewards<span className="block text-xs text-muted-foreground mt-0.5">The three cheapest rewards for points.</span></span>
      </label>
      <FormRow label="Button text">
        <input value={data.button_text || ''} onChange={e => set('button_text')(e.target.value)} placeholder="Join or sign in" className={input} />
      </FormRow>
      <FormRow label="Style">
        <div className="grid grid-cols-2 gap-1.5">
          {[['banner', 'Banner'], ['card', 'Card']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => set('style')(k)} aria-pressed={style === k}
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
