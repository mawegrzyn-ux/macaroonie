// The order's allergy flag (shared/pos/allergy.js): the allergens to keep
// out, the diets to keep to and a note, for the whole order. Opened from
// More, the allergy bar on the check, or a Buttons zone button (till layouts,
// action 'allergy'). Saving sends check.allergy_set; the kitchen screens show
// the change at once and kitchen printers that already printed the order
// print an allergy update (shared/pos/kitchenPrint.js).
//
// Tags come from the menu's allergens and dietary tags (config.dietary_tags);
// one the flag holds that the menu no longer lists stays, with its name, so
// it can still be taken off. The dishes on the order that clash with the
// flag as it stands are listed under it (pos/src/lib/allergyFit.js).

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cleanAllergy, allergyText, ALLERGY_NOTE_MAX } from '@shared/pos/allergy.js'
import { Modal, cx } from './ui.jsx'
import { dispatch, toast } from '../lib/store.js'
import { lineClash, clashWords } from '../lib/allergyFit.js'

// Its own component (not made inside AllergyModal's render): a component made
// in a render is a new type every render, so the till's background updates
// would swap the buttons under a finger and lose the tap.
function Chips({ list, codes, onToggle, testid }) {
  return (
    <div className="flex flex-wrap gap-2">
      {list.map(t => {
        const on = codes.includes(t.code)
        return (
          <button key={t.code} type="button" data-testid={testid} data-code={t.code} aria-pressed={on}
            className={cx('chip min-h-[48px] px-4', on && 'chip-on bg-bad border-bad text-white')} onClick={() => onToggle(t.code)}>
            {t.name}
          </button>
        )
      })}
    </div>
  )
}

export default function AllergyModal({ check, config, onClose }) {
  const tags = config.dietary_tags || []
  const was = cleanAllergy(check.allergy)
  const [avoid, setAvoid] = useState(() => (was?.allergens || []).map(t => t.code))
  const [diet, setDiet] = useState(() => (was?.diets || []).map(t => t.code))
  const [note, setNote] = useState(was?.note || '')
  const [takingOff, setTakingOff] = useState(false)

  // The menu's tags, then any the flag holds that the menu no longer lists.
  const listOf = (kindOk, held) => [
    ...tags.filter(t => kindOk(t.kind)).map(t => ({ code: t.code, name: t.label })),
    ...(held || []).filter(h => !tags.some(t => t.code === h.code)),
  ]
  const allergenTags = listOf(k => k === 'allergen', was?.allergens)
  const dietTags = listOf(k => k !== 'allergen', was?.diets)
  const pick = (list, codes) => list.filter(t => codes.includes(t.code))
  const draft = cleanAllergy({ allergens: pick(allergenTags, avoid), diets: pick(dietTags, diet), note })
  const changed = JSON.stringify(draft) !== JSON.stringify(was)
  const sent = check.lines.some(l => l.status === 'sent')
  const clashes = check.lines
    .map(line => ({ line, words: clashWords(lineClash(config, line, draft), draft) }))
    .filter(x => x.words.length)

  const toggle = (codes, setCodes, code) => setCodes(codes.includes(code) ? codes.filter(c => c !== code) : [...codes, code])
  const send = allergy => {
    const r = dispatch('check.allergy_set', { allergy }, { check_id: check.id })
    if (!r.ok) return toast(r.error, 'bad')
    toast(allergy ? 'Allergy flag saved' : 'Allergy flag taken off', 'ok')
    onClose()
  }
  const save = () => (changed ? send(draft) : onClose())

  return (
    <Modal title="Allergies on this order" onClose={onClose} wide
      footer={takingOff ? (
        <>
          <span className="text-sm font-semibold self-center mr-auto">Take the allergy flag off this order?</span>
          <button className="btn" onClick={() => setTakingOff(false)}>Keep it</button>
          <button className="btn btn-bad" onClick={() => send(null)} data-testid="allergy-off-yes">Take it off</button>
        </>
      ) : (
        <>
          {was && <button className="btn mr-auto" onClick={() => setTakingOff(true)} data-testid="allergy-off">Take the flag off</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!changed && !was} data-testid="allergy-save">Save</button>
        </>
      )}>
      <div className="space-y-5" data-testid="allergy-modal">
        <p className="text-sm text-muted">For the whole order: the kitchen sees it on every ticket. A single dish's allergy stays on the dish (tap it on the order).</p>
        <section>
          <div className="font-bold mb-2">Keep these out</div>
          {allergenTags.length ? <Chips list={allergenTags} codes={avoid} onToggle={code => toggle(avoid, setAvoid, code)} testid="allergy-allergen" />
            : <div className="text-sm text-muted">The menu has no allergens set up (Menus, Allergens and dietary).</div>}
        </section>
        {dietTags.length > 0 && (
          <section>
            <div className="font-bold mb-2">Diets</div>
            <Chips list={dietTags} codes={diet} onToggle={code => toggle(diet, setDiet, code)} testid="allergy-diet" />
          </section>
        )}
        <section>
          <label className="font-bold block mb-2" htmlFor="allergy-note">Note for the kitchen</label>
          <input id="allergy-note" className="input w-full" value={note} maxLength={ALLERGY_NOTE_MAX} onChange={e => setNote(e.target.value)}
            placeholder="e.g. Coeliac: no shared fryer" data-testid="allergy-note" />
        </section>
        {draft && (
          <div className="rounded-xl bg-bad text-white px-4 py-3 font-bold flex gap-2 items-start" data-testid="allergy-preview">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <span>Allergy: {allergyText(draft)}</span>
          </div>
        )}
        {draft && (
          <section data-testid="allergy-clashes">
            <div className="font-bold mb-2">On this order</div>
            {clashes.length ? (
              <ul className="space-y-1.5">
                {clashes.map(({ line, words }) => (
                  <li key={line.id} className="flex gap-2 items-baseline" data-testid="allergy-clash">
                    <span className="font-semibold">{line.qty} x {line.name}</span>
                    <span className="text-bad font-semibold text-sm">{words.join(', ')}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="text-sm text-muted">Nothing on the order clashes with this, from what the menu says.</div>}
          </section>
        )}
        {sent && changed && (
          <p className="text-sm text-muted">Some dishes have gone to the kitchen: the kitchen screens show the change at once, and kitchen printers that printed this order print an allergy update.</p>
        )}
      </div>
    </Modal>
  )
}
