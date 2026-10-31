// The till's order prompt (migration 226): takes over the screen to ask a new
// order's order type, the customer's name and the tent number, with keys of
// its own (letters for the name, digits for the tent number), so it works
// the same on every tablet and a keyboard plugged in still types.
//
// Two ways, per venue or per till (orderPromptOf() in lib/checkOps.js):
//   one  one screen: the order types, the name and the tent number together
//   two  two steps: the order type first (big buttons), then the name and
//        tent number that type asks for
// Tapping an order type that asks for nothing finishes straight away. Also
// used for one detail alone: a tab's name, the tent number.

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, ArrowLeft, Check } from 'lucide-react'
import { cx, Keyboard, Keypad } from './ui.jsx'

const NEEDED = { ask: '', required: ' (needed)' }
const NONE = { ask_name: 'off', ask_tent: 'off' }
const fieldsOf = a => [a.ask_name !== 'off' && 'name', a.ask_tent !== 'off' && 'tent'].filter(Boolean)
const TENT_MAX = 6

/**
 * types       [{ type, ask_name, ask_tent }]: the order types to pick from
 *             (none or one: no choice is asked)
 * typeId      the type picked to begin with
 * promptsOf   typeId => { ask_name, ask_tent } (off | ask | required)
 * style       'one' | 'two'
 * start       two steps: open on 'type' or 'details'
 * onDone      ({ typeId, name, tent }) => void
 * onClose     cancel
 * noteFor     typeId => words under the fields (or null)
 */
export default function OrderPrompt({
  title, types = [], typeId: typeId0 = null, promptsOf, name: name0 = '', tent: tent0 = '',
  style: styleAsked = 'one', start = 'type', doneLabel = 'Done', onDone, onClose, noteFor = null,
}) {
  // The way it opened with, kept if the setting changes while it is open.
  const [style] = useState(styleAsked === 'two' ? 'two' : 'one')
  const choose = types.length > 1
  const [typeId, setTypeId] = useState(typeId0 || types[0]?.type.id || null)
  const [step, setStep] = useState(style === 'two' && choose && start !== 'details' ? 'type' : 'details')
  const [name, setName] = useState(name0 || '')
  const [tent, setTent] = useState(tent0 || '')
  const asks = useMemo(() => promptsOf(typeId) || NONE, [promptsOf, typeId])
  const fields = fieldsOf(asks)
  // The field the keys type into: picked when the type is (its first empty
  // field) or when a field is tapped; never moved by typing.
  const firstEmpty = list => list.find(f => !(f === 'name' ? name : tent).trim()) || list[0] || null
  const [picked, setFocus] = useState(() => firstEmpty(fields))
  const focus = fields.includes(picked) ? picked : fields[0] || null
  const nameRef = useRef(null)
  const tentRef = useRef(null)

  // A keyboard plugged in types into the field the on-screen keys type into.
  useEffect(() => {
    const el = focus === 'name' ? nameRef.current : focus === 'tent' ? tentRef.current : null
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
  }, [focus, step, typeId])

  const problem = asks.ask_name === 'required' && !name.trim() ? 'Type a customer name'
    : asks.ask_tent === 'required' && !tent.trim() ? 'Type a tent number'
      : null
  const finish = (id = typeId, a = asks) => onDone({
    typeId: id,
    name: a.ask_name !== 'off' ? name.trim() : name0 || '',
    tent: a.ask_tent !== 'off' ? tent.trim() : tent0 || '',
  })
  const pickType = id => {
    const a = promptsOf(id) || NONE
    setTypeId(id)
    if (a.ask_name === 'off' && a.ask_tent === 'off') return finish(id, a)
    if (style === 'two') setStep('details')
    setFocus(firstEmpty(fieldsOf(a)))
  }
  const done = () => { if (!problem) finish() }

  // Nothing to choose and nothing to ask: there is no question.
  const nothing = !choose && !fields.length
  useEffect(() => { if (nothing) finish() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (nothing) return null

  const enter = e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = fields[fields.indexOf(focus) + 1]
    if (next && !(next === 'name' ? name : tent).trim()) setFocus(next)
    else done()
  }
  const typeName = types.find(t => t.type.id === typeId)?.type.name
  const note = noteFor ? noteFor(typeId) : null
  const showTypes = choose && (style === 'one' || step === 'type')
  const showDetails = style === 'one' || step === 'details'
  const twoStep = style === 'two' && choose

  return (
    <div className="fixed inset-0 z-50 bg-page flex flex-col" role="dialog" aria-modal="true" aria-label={title}
      data-testid="order-prompt" data-style={style} data-step={showTypes && !showDetails ? 'type' : 'details'}>
      <header className="h-16 shrink-0 bg-white border-b border-line flex items-center gap-2 px-3">
        {twoStep && step === 'details'
          ? <button className="btn btn-ghost w-14 px-0" onClick={() => setStep('type')} aria-label="Back to the order type" data-testid="prompt-back"><ArrowLeft size={24} /></button>
          : <div className="w-2" />}
        <div className="flex-1 min-w-0">
          <div className="text-xl font-bold truncate">{title}</div>
          {twoStep && <div className="text-xs text-muted" data-testid="prompt-step">Step {step === 'type' ? 1 : 2} of 2{step === 'details' && typeName ? ' · ' + typeName : ''}</div>}
        </div>
        {onClose && <button className="btn btn-ghost w-14 px-0" onClick={onClose} aria-label="Close" data-testid="prompt-close"><X size={26} /></button>}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className={cx('max-w-4xl mx-auto w-full p-4 space-y-5', !showDetails && 'min-h-full flex flex-col justify-center')}>
          {showTypes && !showDetails && <div className="text-center text-lg font-semibold text-muted">Which kind of order?</div>}
          {showTypes && (
            <div role="group" aria-label="Order type" className={cx('grid gap-3',
              !showDetails ? (types.length === 2 || types.length === 4 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3') : 'grid-cols-2 md:grid-cols-4')}>
              {types.map(({ type }) => (
                <button key={type.id} className={cx('btn rounded-2xl font-bold', !showDetails ? 'h-36 text-3xl' : 'h-16 text-lg', type.id === typeId && showDetails && 'btn-primary')}
                  aria-pressed={showDetails ? type.id === typeId : undefined}
                  style={!showDetails && type.colour ? { borderColor: type.colour, borderWidth: 3 } : undefined}
                  data-testid="prompt-type" data-name={type.name} onClick={() => pickType(type.id)}>
                  {type.name}
                </button>
              ))}
            </div>
          )}

          {showDetails && fields.length > 0 && (
            <div className="space-y-4">
              <div className={cx('grid gap-3', fields.length > 1 && 'sm:grid-cols-2')}>
                {fields.includes('name') && (
                  <label className="block" onPointerDown={() => setFocus('name')}>
                    <span className="label">Customer name{NEEDED[asks.ask_name] || ''}</span>
                    <input ref={nameRef} inputMode="none" autoComplete="off" spellCheck={false} maxLength={80}
                      className={cx('input mt-1 h-16 text-2xl font-semibold', focus === 'name' && 'border-brand ring-2 ring-brand')}
                      value={name} placeholder="Type with the keys below" data-testid="prompt-name"
                      onFocus={() => setFocus('name')} onChange={e => setName(e.target.value.slice(0, 80))} onKeyDown={enter} />
                  </label>
                )}
                {fields.includes('tent') && (
                  <label className="block" onPointerDown={() => setFocus('tent')}>
                    <span className="label">Tent number{NEEDED[asks.ask_tent] || ''}</span>
                    <input ref={tentRef} inputMode="none" autoComplete="off" maxLength={20}
                      className={cx('input mt-1 h-16 text-3xl font-bold tabular-nums', focus === 'tent' && 'border-brand ring-2 ring-brand')}
                      value={tent} placeholder="e.g. 14" data-testid="prompt-tent"
                      onFocus={() => setFocus('tent')} onChange={e => setTent(e.target.value.slice(0, 20))} onKeyDown={enter} />
                  </label>
                )}
              </div>
              {/* The keys never take the focus from the field (a keyboard plugged in keeps typing there). */}
              <div onMouseDown={e => e.preventDefault()}>
                {focus === 'name' && <Keyboard value={name} onChange={setName} />}
                {focus === 'tent' && (
                  <div className="max-w-sm mx-auto w-full" data-testid="tent-keypad">
                    <Keypad value={tent} onChange={v => setTent(v.slice(0, TENT_MAX))} max={TENT_MAX} big />
                  </div>
                )}
              </div>
            </div>
          )}
          {showDetails && !fields.length && typeName && (
            <div className="text-muted text-center py-6" data-testid="prompt-nothing">{typeName} asks for nothing more.</div>
          )}
          {showDetails && note && <div className="text-sm text-muted text-center" data-testid="prompt-note">{note}</div>}
        </div>
      </div>

      {showDetails && (
        <footer className="shrink-0 bg-white border-t border-line p-3 flex items-center gap-3 justify-end flex-wrap">
          {problem && <span className="text-bad font-semibold mr-auto" data-testid="prompt-problem">{problem}</span>}
          {fields.length > 1 && focus && fields.indexOf(focus) < fields.length - 1 && (
            <button className="btn h-16 min-w-[140px] text-lg" data-testid="prompt-next" onClick={() => setFocus(fields[fields.indexOf(focus) + 1])}>
              Next: {fields[fields.indexOf(focus) + 1] === 'tent' ? 'tent number' : 'name'}
            </button>
          )}
          <button className="btn btn-primary h-16 min-w-[200px] text-lg" disabled={!!problem} onClick={done} data-testid="prompt-done">
            <Check size={22} /> {doneLabel}
          </button>
        </footer>
      )}
    </div>
  )
}
