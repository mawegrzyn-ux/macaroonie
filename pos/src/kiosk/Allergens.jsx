// The kiosk's allergens screen (from the start screen, or Change on the
// menu): the restaurant's allergen notice (Menus > Allergens & dietary), the
// allergens the guest avoids and the diets they follow as big toggles, and
// how many dishes on the menu suit them. See the menu keeps the picks for the
// order: the menu and meal deal choices mark what to check (fit.jsx,
// guestFit() in shared/kiosk.js). Start again clears them.

import { useMemo } from 'react'
import { ShieldAlert, Check, UtensilsCrossed, X } from 'lucide-react'
import { noticeOf } from '@shared/menuTags.js'
import { TK, prefsOn } from '@shared/kiosk.js'
import { configItem } from '@shared/pos/offers.js'
import { useKiosk, textsFor, go, startOrder, setPrefs, countFor, kioskItemIds } from './store.js'
import { cx, BackButton, Sheet, TypeIcon, guessTypeIcon } from './parts.jsx'
import { tagName } from './fit.jsx'
import { typeLabelOf, typeQuestion, orderingClosed } from './Start.jsx'
import { useJourneyState } from './journey.js'

function TagPicks({ tags, picked, onToggle, config, texts, testId }) {
  return (
    <div className="k-picks" data-testid={testId}>
      {tags.map(tag => {
        const on = picked.includes(tag.code)
        return (
          <button key={tag.code} className={cx('k-pick', on && 'k-pick-on')} onClick={() => onToggle(tag.code)} aria-pressed={on} data-code={tag.code}>
            <span className="k-pick-box">{on && <Check size={20} strokeWidth={3} />}</span>
            {tag.kind !== 'allergen' && tag.glyph && <span className="k-pick-glyph" style={{ background: tag.colour || 'var(--k-primary)' }} aria-hidden="true">{tag.glyph}</span>}
            <span className="k-pick-name">{tagName(config, texts, tag.code)}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function Allergens() {
  const s = useKiosk()
  const { config, prefs } = s
  const texts = textsFor(s)
  const { ui, t } = texts
  const d = config.design
  const [askType, setAskType] = useJourneyState('allergens.ask', false)
  const notice = noticeOf(config.allergen_notice)
  const allergens = (config.dietary_tags || []).filter(x => x.kind === 'allergen')
  // Diets: only ones a dish on this kiosk's menu carries.
  const diets = useMemo(() => {
    const used = new Set(kioskItemIds(config).flatMap(id => configItem(config, id)?.dietary || []))
    return (config.dietary_tags || []).filter(x => x.kind !== 'allergen' && used.has(x.code))
  }, [config])
  const count = useMemo(() => countFor(config, prefs), [config, prefs])
  const on = prefsOn(prefs)
  const toggle = key => code => setPrefs({ ...prefs, [key]: prefs[key].includes(code) ? prefs[key].filter(x => x !== code) : [...prefs[key], code] })
  const types = config.order_types || []
  const closed = orderingClosed(s)
  const seeMenu = () => {
    if (s.orderType) go('menu')
    else if (types.length > 1) setAskType(true)
    else startOrder(types[0]?.id || null)
  }
  const result = !on ? ui('pick_prompt')
    : count.fits === 0 ? ui('suits_none')
      : count.fits === 1 ? ui('suits_one', { total: count.total }) : ui('suits_count', { n: count.fits, total: count.total })
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="k-allergens-screen">
      {d.layout.header && (
        <div className="shrink-0 flex items-center gap-[var(--k-gap)] px-[var(--k-pad)] py-[var(--k-gap)] bg-[var(--k-surface)] border-b-2 border-[var(--k-line)]">
          <div className="k-head text-[1.5em] flex-1 text-center flex items-center justify-center gap-[.4em] min-h-[max(56px,3.2em)]"><ShieldAlert /> {ui('allergens')}</div>
        </div>
      )}
      <div className="flex-1 min-h-0 k-scroll p-[var(--k-pad)] flex flex-col gap-[calc(var(--k-pad)*1.1)]">
        {!d.layout.header && <h2 className="k-head text-[2em] m-0 flex items-center gap-[.4em]"><ShieldAlert /> {ui('allergens')}</h2>}
        <div className="k-card p-[var(--k-pad)] flex flex-col gap-[.4em]" data-testid="k-allergen-notice">
          <div className="k-head text-[1.3em]">{t(TK.notice('title'), notice.title)}</div>
          <div>{t(TK.notice('body'), notice.body)}</div>
          <div className="k-muted text-[.9em]">{ui('ask_staff')}</div>
        </div>
        <section className="flex flex-col gap-[var(--k-gap)]">
          <div>
            <h3 className="k-head text-[1.5em] m-0">{ui('avoid_title')}</h3>
            <div className="k-muted">{ui('tap_all')}</div>
          </div>
          <TagPicks tags={allergens} picked={prefs.avoid} onToggle={toggle('avoid')} config={config} texts={texts} testId="k-avoid" />
        </section>
        {diets.length > 0 && (
          <section className="flex flex-col gap-[var(--k-gap)]">
            <h3 className="k-head text-[1.5em] m-0">{ui('diet_title')}</h3>
            <TagPicks tags={diets} picked={prefs.diet} onToggle={toggle('diet')} config={config} texts={texts} testId="k-diet" />
          </section>
        )}
      </div>
      <div className={cx('shrink-0 k-fit-result px-[var(--k-pad)] py-[var(--k-gap)] flex items-center gap-[.8em]', on && count.fits === 0 && 'k-fit-result-none')} data-testid="k-fit-result" aria-live="polite"
        data-fits={on ? count.fits : undefined} data-total={count.total}>
        <UtensilsCrossed className="shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col">
          <span className={on ? 'k-head text-[1.4em]' : 'font-semibold'}>{result}</span>
          {on && count.fits > 0 && <span className="k-muted text-[.9em]">{ui('marked_note')}</span>}
        </div>
      </div>
      <div className="k-bar shrink-0">
        <BackButton onClick={() => go(s.orderType ? 'menu' : 'start')} label={ui('back')} />
        {on && (
          <button className="k-btn k-btn-big k-btn-onbar" onClick={() => setPrefs({ avoid: [], diet: [] })} data-testid="k-prefs-clear">
            <X /> {ui('clear_all')}
          </button>
        )}
        <span className="flex-1" />
        {!closed && (
          <button className="k-btn k-btn-accent k-btn-big" onClick={seeMenu} data-testid="k-see-menu">{ui('see_menu')}</button>
        )}
      </div>
      {askType && (
        <Sheet onClose={() => setAskType(false)}>
          <div className="flex flex-col gap-[var(--k-pad)] items-center text-center" data-testid="k-type-sheet">
            <div className="k-head text-[1.8em]">{typeQuestion(d, texts)}</div>
            <div className="grid gap-[var(--k-gap)] w-full" style={{ gridTemplateColumns: 'repeat(' + Math.min(types.length, 3) + ', minmax(0, 1fr))' }}>
              {types.map(ty => {
                const card = d.start.type_cards[ty.id] || {}
                const icon = card.icon && card.icon !== 'none' ? card.icon : guessTypeIcon(ty.name)
                return (
                  <button key={ty.id} className="k-btn k-btn-primary k-btn-big flex-col !h-auto py-[1em]" onClick={() => { setAskType(false); startOrder(ty.id) }} data-testid="k-type" data-type={ty.id}>
                    <TypeIcon icon={icon} size={40} />
                    <span>{typeLabelOf(d, ty, t)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}
