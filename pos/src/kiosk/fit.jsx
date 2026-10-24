// What the kiosk shows for the allergens and diets a guest picked on the
// allergens screen (store.js prefs; the rules are guestFit() in
// shared/kiosk.js): a friendly mark on a dish or choice to check, a line
// naming the guest's allergens on it (highlighted), and the strip at the top
// of the menu saying what is being marked.

import { AlertCircle, ShieldCheck } from 'lucide-react'
import { TK, allergenName, prefsOn } from '@shared/kiosk.js'
import { go } from './store.js'
import { cx } from './parts.jsx'

/** A tag's name in the guest's language: an allergen's built-in name, a diet's translation. */
export function tagName(config, texts, code) {
  const tag = (config.dietary_tags || []).find(x => x.code === code)
  if (!tag) return code
  return tag.kind === 'allergen' ? allergenName(tag, texts.lang, texts.dict) : texts.t(TK.tag(tag.code), tag.label)
}

/** Something on it to check: it doesn't suit, has an allergen on request, or some of a meal deal's choices have one. */
export const needsCheck = fit => !!fit && (!fit.ok || fit.removable.length > 0 || fit.some)

/** The friendly mark on a dish or choice to check. */
export function FitMark({ fit, texts, className }) {
  if (!needsCheck(fit)) return null
  return (
    <span className={cx('k-fit-mark', className)} role="img" aria-label={texts.ui('check_this')} title={texts.ui('check_this')} data-testid="k-fit-mark">
      <AlertCircle strokeWidth={2.6} />
    </span>
  )
}

/** Names with the guest's ones highlighted. */
export function Names({ names }) {
  return names.map((n, i) => (
    <span key={i}>{i > 0 && ', '}<mark className="k-fit-hl">{n}</mark></span>
  ))
}

/**
 * Why a dish or choice needs checking, the guest's allergens and diets
 * highlighted: "Contains: Milk · Not marked: Vegan". Nothing when it suits.
 */
export function FitNote({ fit, config, texts, className }) {
  if (!needsCheck(fit)) return null
  const { ui } = texts
  const name = code => tagName(config, texts, code)
  const parts = []
  if (fit.some) parts.push([ui('some_choices_contain'), fit.avoid.map(a => name(a.code))])
  else {
    const has = fit.avoid.filter(a => a.level === 'contains').map(a => name(a.code))
    const may = fit.avoid.filter(a => a.level === 'may_contain').map(a => name(a.code))
    if (has.length) parts.push([ui('contains'), has])
    if (may.length) parts.push([ui('may_contain'), may])
  }
  if (fit.removable.length) parts.push([ui('can_be_removed'), fit.removable.map(name)])
  if (fit.missing.length) parts.push([ui('not_marked'), fit.missing.map(name)])
  return (
    <span className={cx('k-fit-note', className)} data-testid="k-fit-note">
      {parts.map(([label, names], i) => (
        <span key={label} className="inline">
          {i > 0 && <span aria-hidden="true"> · </span>}
          <span className="font-semibold">{label}:</span> <Names names={names} />
        </span>
      ))}
    </span>
  )
}

/**
 * The top of the menu while the guest has picked something: what is marked,
 * how many dishes suit, and Change (back to the allergens screen).
 */
export function PrefsStrip({ prefs, count, config, texts }) {
  if (!prefsOn(prefs)) return null
  const { ui } = texts
  const parts = [[ui('avoid_title'), prefs.avoid], [ui('diet_title'), prefs.diet]].filter(([, codes]) => codes.length)
  const words = count.fits === 0 ? ui('suits_none')
    : count.fits === 1 ? ui('suits_one', { total: count.total }) : ui('suits_count', { n: count.fits, total: count.total })
  return (
    <div className="k-fit-strip flex items-center gap-[.8em] px-[.9em] py-[.6em]" data-testid="k-prefs-strip" role="group" aria-label={ui('marked_for_you')}>
      <ShieldCheck className="shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col">
        <span>
          {parts.map(([label, codes], i) => (
            <span key={label}>{i > 0 && <span aria-hidden="true"> · </span>}<span className="font-semibold">{label}:</span> <Names names={codes.map(code => tagName(config, texts, code))} /></span>
          ))}
        </span>
        <span className="k-muted text-[.85em]" data-testid="k-prefs-count">{words}</span>
      </div>
      <button className="k-btn shrink-0" onClick={() => go('allergens')} data-testid="k-prefs-change">{ui('change')}</button>
    </div>
  )
}
