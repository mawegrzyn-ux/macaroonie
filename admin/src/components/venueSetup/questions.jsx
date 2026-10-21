// src/components/venueSetup/questions.jsx
//
// Pepper's questions about a new venue (when the venue setup wizard asked
// Pepper to fill it in): answer each, leave any to Pepper, or skip them all.

import { useEffect, useMemo, useState } from 'react'
import { Check, MessageSquareText } from 'lucide-react'
import { cn, openPicker } from '@/lib/utils'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { areaLabel } from '@shared/storeOpening.js'
import { Card, primary, outline, inp } from './ui'

function initialAnswers(questions) {
  return Object.fromEntries(questions.map(q => [q.id, q.suggested || '']))
}

function QuestionInput({ q, value, onChange, disabled }) {
  if (q.kind === 'choice' || q.kind === 'yesno') {
    const options = q.kind === 'yesno' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : q.options
    return (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.text}>
        {options.map(o => {
          const on = value === o.value
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(on ? '' : o.value)}
              className={cn('min-h-[44px] px-3 rounded-lg border text-sm text-left touch-manipulation', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
              {o.label}{q.suggested === o.value && <span className={cn('ml-1.5 text-[10px] uppercase tracking-wide', on ? 'opacity-80' : 'text-primary')}>Suggested</span>}
            </button>
          )
        })}
      </div>
    )
  }
  if (q.kind === 'multi') {
    const picked = value ? value.split(' | ') : []
    return (
      <div className="flex flex-wrap gap-2">
        {q.options.map(o => {
          const on = picked.includes(o.value)
          return (
            <button key={o.value} type="button" aria-pressed={on} disabled={disabled}
              onClick={() => onChange((on ? picked.filter(x => x !== o.value) : [...picked, o.value]).join(' | '))}
              className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation inline-flex items-center gap-1.5', on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background')}>
              {on && <Check className="w-3.5 h-3.5" />}{o.label}
            </button>
          )
        })}
      </div>
    )
  }
  if (q.kind === 'date') {
    return (
      <span className="relative inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg border bg-background text-sm touch-manipulation">
        {value || 'Pick a date'}
        <input type="date" value={value || ''} onClick={openPicker} onChange={e => onChange(e.target.value)} disabled={disabled}
          aria-label={q.text} className="absolute inset-0 opacity-0 cursor-pointer" />
      </span>
    )
  }
  if (q.kind === 'time') {
    return <input type="time" value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} aria-label={q.text} className={cn(inp, 'w-40')} />
  }
  if (q.kind === 'number') {
    return <input type="text" inputMode="decimal" value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} aria-label={q.text} placeholder={q.suggested || ''} className={cn(inp, 'w-40')} />
  }
  return <textarea value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} aria-label={q.text} rows={2} placeholder={q.suggested || ''}
    className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/40" />
}

export function QuestionsCard({ opening, onAnswer, readOnly }) {
  const [answers, setAnswers] = useState(() => initialAnswers(opening.questions))
  const [leave, setLeave] = useState({})
  useEffect(() => { setAnswers(initialAnswers(opening.questions)); setLeave({}) }, [opening.questions])
  const byArea = useMemo(() => {
    const m = new Map()
    for (const q of opening.questions) (m.get(q.area) || m.set(q.area, []).get(q.area)).push(q)
    return [...m.entries()]
  }, [opening.questions])
  const send = all => onAnswer(Object.fromEntries(opening.questions.map(q => [q.id, all || leave[q.id] ? '' : (answers[q.id] || '')])))
  return (
    <Card title={ASSISTANT_NAME + '\'s questions'} icon={MessageSquareText}
      extra={<span className="text-xs text-muted-foreground">Round {Math.max(1, opening.rounds)} of {opening.max_rounds}</span>}>
      <div className="space-y-5" data-testid="nl-questions">
        {byArea.map(([area, qs]) => (
          <div key={area} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{areaLabel(area)}</h3>
            {qs.map(q => (
              <div key={q.id} className="rounded-lg border p-3 space-y-2" data-testid="nl-question" data-kind={q.kind}>
                <p className="font-medium text-sm">{q.text}</p>
                {q.why && <p className="text-xs text-muted-foreground">{q.why}</p>}
                <div className={cn(leave[q.id] && 'opacity-40 pointer-events-none')}>
                  <QuestionInput q={q} value={answers[q.id]} onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))} disabled={readOnly} />
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground min-h-[32px] touch-manipulation">
                  <input type="checkbox" checked={!!leave[q.id]} disabled={readOnly} onChange={e => setLeave(l => ({ ...l, [q.id]: e.target.checked }))} className="w-4 h-4" />
                  Leave it to {ASSISTANT_NAME}
                </label>
              </div>
            ))}
          </div>
        ))}
        {!readOnly && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button className={primary} onClick={() => send(false)} data-testid="nl-send-answers"><Check className="w-4 h-4" />Send answers</button>
            <button className={outline} onClick={() => send(true)} data-testid="nl-skip-questions">Skip these</button>
          </div>
        )}
      </div>
    </Card>
  )
}
