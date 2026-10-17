// The kiosk's allergen list (from the start screen): tap allergens to hide
// the dishes that have them (contains or may contain; "can be removed" stays
// with a note), every dish with its allergens in the guest's language, and
// the restaurant's allergen notice.

import { useMemo, useState } from 'react'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { noticeOf } from '@shared/menuTags.js'
import { TK, allergenName } from '@shared/kiosk.js'
import { configItem } from '@shared/pos/offers.js'
import { useKiosk, textsFor, go, kioskSections, itemLevels } from './store.js'
import { cx } from './parts.jsx'

export default function Allergens() {
  const s = useKiosk()
  const { config } = s
  const texts = textsFor(s)
  const { ui, t } = texts
  const [free, setFree] = useState([])
  const tags = (config.dietary_tags || []).filter(x => x.kind === 'allergen')
  const notice = noticeOf(config.allergen_notice)
  const dishes = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const sec of kioskSections(config)) {
      for (const id of sec.item_ids) {
        if (seen.has(id)) continue
        seen.add(id)
        const it = configItem(config, id)
        if (it) out.push(it)
      }
    }
    return out
  }, [config])
  // A combo counts every dish it can hold (store.js itemLevels()).
  const levels = useMemo(() => Object.fromEntries(dishes.map(it => [it.id, itemLevels(config, it)])), [dishes, config])
  const levelOf = (it, code) => levels[it.id]?.[code] || null
  const shown = dishes.filter(it => free.every(code => { const lv = levelOf(it, code); return !lv || lv === 'removable' }))
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="k-allergen-list">
      <div className="shrink-0 flex items-center gap-[var(--k-gap)] px-[var(--k-pad)] py-[var(--k-gap)] bg-[var(--k-surface)] border-b-2 border-[var(--k-line)]">
        <button className="k-btn k-btn-ghost" onClick={() => go(s.orderType ? 'menu' : 'start')}><ArrowLeft /> {ui('back')}</button>
        <div className="k-head text-[1.5em] flex-1 text-center flex items-center justify-center gap-[.4em]"><ShieldAlert /> {ui('allergens')}</div>
        <span className="min-w-[6em]" />
      </div>
      <div className="flex-1 min-h-0 k-scroll p-[var(--k-pad)] flex flex-col gap-[var(--k-gap)]">
        <div className="k-card p-[var(--k-pad)] flex flex-col gap-[.4em]">
          <div className="k-head text-[1.3em]">{t(TK.notice('title'), notice.title)}</div>
          <div>{t(TK.notice('body'), notice.body)}</div>
          <div className="k-muted text-[.9em]">{ui('ask_staff')}</div>
        </div>
        <div className="font-semibold">{ui('free_from')}</div>
        <div className="flex flex-wrap gap-[.5em]" data-testid="k-free-from">
          {tags.map(tag => {
            const on = free.includes(tag.code)
            return (
              <button key={tag.code} className={cx('k-chip', on && 'k-chip-on')} onClick={() => setFree(f => (on ? f.filter(x => x !== tag.code) : [...f, tag.code]))} data-code={tag.code}>
                {allergenName(tag, texts.lang, texts.dict)}
              </button>
            )
          })}
          {free.length > 0 && <button className="k-chip" onClick={() => setFree([])}>{ui('show_all')}</button>}
        </div>
        {!shown.length && <div className="k-card p-[var(--k-pad)] text-center k-muted">{ui('no_dishes')}</div>}
        <div className="flex flex-col gap-[.5em]">
          {shown.map(it => {
            const groups = { contains: [], may_contain: [], removable: [] }
            for (const tag of tags) { const lv = levelOf(it, tag.code); if (lv) groups[lv].push(allergenName(tag, texts.lang, texts.dict)) }
            const any = groups.contains.length + groups.may_contain.length + groups.removable.length
            return (
              <div key={it.id} className="k-card p-[.8em] flex flex-col gap-[.2em]" data-testid="k-allergen-dish">
                <div className="k-head">{texts.itemName(it)}</div>
                <div className="text-[.85em]">
                  {!any && <span className="k-muted">{ui('no_allergens')}</span>}
                  {any > 0 && it.kind === 'combo' && <div className="k-muted">{ui('depends_on_choice')}</div>}
                  {groups.contains.length > 0 && <div><b>{ui('contains')}:</b> {groups.contains.join(', ')}</div>}
                  {groups.may_contain.length > 0 && <div><b>{ui('may_contain')}:</b> {groups.may_contain.join(', ')}</div>}
                  {groups.removable.length > 0 && <div><b>{ui('can_be_removed')}:</b> {groups.removable.join(', ')}</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
