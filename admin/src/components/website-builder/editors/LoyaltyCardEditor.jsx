// Editor for the Loyalty card block: the guest's own loyalty card on the
// website (join or sign in, QR card, points, stamps, rewards, history). It
// sits on the built-in Loyalty page (/loyalty) and can go on any page.
// See api/src/views/site/blocks/loyalty_card.eta.
import { Link } from 'react-router-dom'
import { FormRow } from '../shared'
import { ThemeColourPicker } from '../ThemeColourPicker'
import { useLoyaltyTeaser, teaserText } from './LoyaltyCtaEditor'

const input = 'w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]'

export const LOYALTY_CARD_PARTS = [
  ['show_how', 'How it works', 'Shown above the sign-in, unless you write your own words.'],
  ['show_stamps', 'Stamp cards', 'Each stamp card with its stamps.'],
  ['show_rewards', 'Rewards', 'Rewards ready to use and rewards for points.'],
  ['show_wallet', 'Wallet buttons', 'Add to Apple Wallet / Google Wallet, when set up.'],
  ['show_history', 'History tab', 'Points and stamps earned and spent.'],
  ['show_settings', 'Settings tab', 'Name, phone, newsletter, new card code, download my data, leave.'],
]

export function LoyaltyCardEditor({ data, onChange }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const { data: res, isError } = useLoyaltyTeaser()
  const t = res?.teaser || null
  const container = ['narrow', 'boxed', 'wide'].includes(data.container) ? data.container : 'narrow'
  return (
    <div className="space-y-3" data-testid="loyalty-card-editor">
      {res && !t && (
        <p className="text-xs rounded-md bg-amber-50 text-amber-900 border border-amber-200 p-2" data-testid="loyalty-card-off">
          Hidden on the website: loyalty or its web app is switched off.
        </p>
      )}
      {isError && <p className="text-xs text-destructive">Could not load the loyalty programme.</p>}
      <Link to="/loyalty?tab=programme" className="text-xs text-primary underline inline-block">Loyalty programme settings</Link>
      <FormRow label="Heading" hint="Blank: the programme's name, shown until the guest signs in. With a heading, it shows on the card too.">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)} placeholder={t ? t.name : ''} className={input} data-testid="loyalty-card-heading" />
      </FormRow>
      <FormRow label="Words above the sign-in" hint="Blank: how points and stamps are earned (when How it works is on).">
        <textarea rows={2} value={data.intro || ''} onChange={e => set('intro')(e.target.value)} placeholder={teaserText(t)} className={input} />
      </FormRow>
      <div className="space-y-1">
        <p className="text-xs font-medium">Show</p>
        {LOYALTY_CARD_PARTS.map(([k, label, hint]) => (
          <label key={k} className="flex items-start gap-2 text-sm min-h-[36px] cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={data[k] !== false} onChange={e => set(k)(e.target.checked)} data-testid={'loyalty-card-' + k} />
            <span>{label}<span className="block text-xs text-muted-foreground mt-0.5">{hint}</span></span>
          </label>
        ))}
      </div>
      <FormRow label="Width">
        <div className="grid grid-cols-3 gap-1.5">
          {[['narrow', 'Narrow'], ['boxed', 'Boxed'], ['wide', 'Wide']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => set('container')(k)} aria-pressed={container === k}
              className={'text-sm border rounded-md px-2 py-2 min-h-[44px] touch-manipulation ' + (container === k ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent')}>
              {label}
            </button>
          ))}
        </div>
      </FormRow>
      <FormRow label="Buttons">
        <ThemeColourPicker value={data.accent || 'primary'} onChange={set('accent')} allowNone={false} />
      </FormRow>
      <FormRow label="Boxes" hint="The background of the sign-in, stamps and rewards boxes.">
        <ThemeColourPicker value={data.panel || 'surface'} onChange={set('panel')} allowNone={false} />
      </FormRow>
      <FormRow label="Card" hint="Inherit: the card colours set in Loyalty, Programme.">
        <ThemeColourPicker value={data.card_bg || ''} onChange={v => set('card_bg')(v || '')} />
      </FormRow>
      <FormRow label="Card text" hint="Inherit: readable on the card.">
        <ThemeColourPicker value={data.card_text || ''} onChange={v => set('card_text')(v || '')} />
      </FormRow>
    </div>
  )
}
