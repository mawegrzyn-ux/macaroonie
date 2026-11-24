// src/components/forms/PlainForm.jsx
//
// The plain renderer (Pepper-first step 8A3; docs/PEPPER_FIRST.md 13
// decision 3): one component that draws a flat set-up form (a new supplier,
// staff member, expense or closure: shared/forms.js plain: true) from the
// field list the API derives from the schema its route validates with
// (GET /api/forms/:key, api/src/forms/plain.js). Deterministic: the same
// list and role draw the same form; nothing here adds a field, a rule or a
// layout of its own. The route checks everything again on Save.
//
// Pepper's values (open_form, step 3) come through ./fill.jsx: each field
// starts from fill.values and is marked "Filled by Pepper" until the person
// changes it or presses OK. A field that picks from the group's list (a role,
// a category) gets Pepper's name and finds the row here. Every change goes to
// fill.change() (the sheet's draft) and Save to fill.saved() (the chat's line).
//
// Props: formKey; venueId (':venue' in its routes); date (the sheet's day, for
// a field the form takes from it); onSaved(row, line); onCancel (shows Cancel).

import { useMemo, useRef, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Camera, Check, Loader2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'
import { ReadOnlyNotice } from '@/components/ReadOnlyNotice'
import { useFormFill, FilledMark, filledClass } from './fill'
import {
  NUMBER_TYPES, controlOf, layoutOf, shown, startOf, problemOf, bodyOf, savedLine,
} from '@shared/plainForm.js'

const inputCls = 'w-full h-12 rounded-lg border bg-background px-3 text-sm touch-manipulation disabled:opacity-60'

const withVenue = (path, venueId) => path.replace(':venue', venueId || '')

function DateField({ id, value, onChange, disabled, className }) {
  return (
    <span className={cn('relative flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm touch-manipulation', className, disabled && 'opacity-60')}>
      <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className={cn('tabular-nums truncate', !value && 'text-muted-foreground')}>
        {value ? format(parseISO(value), 'EEE d MMM yyyy') : 'Pick a date'}
      </span>
      <input id={id} type="date" value={value || ''} disabled={disabled} data-testid={'plain-input-' + id.replace(/^plain-/, '')}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer touch-manipulation" />
    </span>
  )
}

/** One field, drawn with the control shared/plainForm.js gives it. */
function FieldInput({ field, value, onChange, options, disabled, filled }) {
  const id = 'plain-' + field.key
  const cls = cn(inputCls, filled)
  const test = { 'data-testid': 'plain-input-' + field.key }
  const control = controlOf(field)
  if (control === 'checkbox') {
    return (
      <label className={cn('flex items-center gap-3 min-h-[48px] px-3 rounded-lg border touch-manipulation', filled)}>
        <input id={id} type="checkbox" className="w-6 h-6" checked={!!value} disabled={disabled} {...test}
          onChange={e => onChange(e.target.checked)} />
        <span className="text-sm">{field.label}</span>
      </label>
    )
  }
  if (control === 'buttons') {
    return (
      <div className={cn('flex flex-wrap gap-1.5 rounded-lg', filled)} role="radiogroup" aria-label={field.label} {...test}>
        {field.choices.map(c => (
          <button key={c.value} type="button" disabled={disabled} onClick={() => onChange(value === c.value && !field.required ? '' : c.value)}
            aria-pressed={value === c.value} data-value={c.value}
            className={cn('min-h-[48px] px-3 rounded-lg border text-sm touch-manipulation disabled:opacity-60',
              value === c.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
            {c.label}
          </button>
        ))}
      </div>
    )
  }
  if (control === 'select') {
    const list = field.options ? options || [] : field.choices
    return (
      <select id={id} className={cls} value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)} {...test}>
        <option value="">{field.required ? 'Pick one' : 'None'}</option>
        {list.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    )
  }
  if (control === 'date') return <DateField id={id} value={value} onChange={onChange} disabled={disabled} className={filled} />
  if (control === 'textarea') {
    return <textarea id={id} rows={3} className={cn(cls, 'h-auto py-2')} value={value ?? ''} disabled={disabled}
      maxLength={field.maxLength} onChange={e => onChange(e.target.value)} {...test} />
  }
  const type = control.slice('input:'.length)
  const mode = { email: 'email', tel: 'tel', url: 'url' }[type]
    || (field.type === 'int' ? 'numeric' : NUMBER_TYPES.includes(field.type) ? 'decimal' : undefined)
  return <input id={id} type={type} inputMode={mode} className={cls} value={value ?? ''} disabled={disabled} maxLength={field.maxLength}
    placeholder={field.examples?.[0] ? 'e.g. ' + field.examples[0] : field.type === 'money' ? '0.00' : undefined}
    onChange={e => onChange(NUMBER_TYPES.includes(field.type) ? e.target.value.replace(/[^0-9.-]/g, '') : e.target.value)}
    {...test} />
}

export function PlainForm({ formKey, venueId, date = null, onSaved, onCancel, className }) {
  const api = useApi()
  const qc = useQueryClient()
  const fill = useFormFill()
  const { data: form, isLoading, error } = useQuery({
    queryKey: ['plain-form', formKey],
    queryFn: () => api.get('/forms/' + formKey),
    staleTime: Infinity,
  })
  const fields = form?.fields || []
  // The group's own lists a field picks from (a role, a category), one query each.
  const listed = fields.filter(f => f.options)
  const lists = useQueries({
    queries: listed.map(f => ({
      queryKey: ['plain-form-options', formKey, f.key, venueId],
      queryFn: () => api.get(withVenue(f.options.path, venueId)),
      enabled: !!form && (!f.options.path.includes(':venue') || !!venueId),
    })),
  })
  const options = useMemo(() => Object.fromEntries(listed.map((f, i) => {
    const data = lists[i]?.data
    const rows = (f.options.list ? data?.[f.options.list] : data) || []
    return [f.key, rows.filter(r => !f.options.only || r[f.options.only]).map(r => ({ value: r.id, label: String(r[f.options.label] ?? '') }))]
  })), [listed, lists])
  const optionsReady = lists.every(q => !q.isLoading)

  if (isLoading || (form && !optionsReady)) {
    return <div className="p-6 flex justify-center" data-testid="plain-form-loading"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }
  if (error || !form) return <p className="text-sm text-destructive p-3" data-testid="plain-error">{error?.message || 'This form can\'t open.'}</p>
  return <PlainFields form={form} fill={fill} options={options} venueId={venueId} date={date} api={api} qc={qc}
    onSaved={onSaved} onCancel={onCancel} className={className} />
}

function PlainFields({ form, fill, options, venueId, date, api, qc, onSaved, onCancel, className }) {
  const fields = form.fields
  const start = () => Object.fromEntries(fields.map(f => [f.key, startOf(f, fill?.values?.[f.key], options[f.key] || [])]))
  const [values, setValues] = useState(start)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(null)
  const [done, setDone] = useState(null)
  const [file, setFile] = useState(null)
  const fileRef = useRef(null)
  const readOnly = !!form.read_only

  const change = key => v => {
    setValues(p => ({ ...p, [key]: v }))
    setDone(null)
    fill?.clear(key)
    // The draft keeps a pick from the group's list by its name, as Pepper gives it.
    const f = fields.find(x => x.key === key)
    fill?.change(key, f?.options ? (options[key]?.find(o => o.value === v)?.label ?? '') : v)
  }
  // What is drawn: the shared rules' layout, in its order (deterministic).
  const layout = layoutOf(fields, values)
  const visible = layout.map(l => fields.find(f => f.key === l.key))
  const problems = Object.fromEntries(visible.map(f => [f.key, problemOf(f, values[f.key])]).filter(([, p]) => p))

  async function save() {
    setTouched(true)
    if (Object.keys(problems).length || readOnly) return
    setSaving(true)
    setFailed(null)
    try {
      const body = bodyOf(fields, values, form.from, date)
      const path = withVenue(form.save.path, venueId)
      const method = form.save.method.toLowerCase()
      const row = await api[method](path, body)
      if (file && form.attach && row?.id) {
        await api.upload(withVenue(form.attach.path, venueId).replace(':id', row.id), file).catch(() => null)
      }
      const line = savedLine(form.saved, fields, values, options)
      // What the form changed shows wherever it is listed.
      qc.invalidateQueries()
      fill?.saved(line)
      onSaved?.(row, line)
      setDone(line)
      setValues(Object.fromEntries(fields.map(f => [f.key, startOf(f, null, [])])))
      setFile(null)
      setTouched(false)
    } catch (err) {
      setFailed(err?.message || 'It couldn\'t be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn('space-y-4', className)} data-testid="plain-form" data-form={form.key}>
      {readOnly && <ReadOnlyNotice what="this form" />}
      {done && (
        <p className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800" data-testid="plain-saved">
          <Check className="w-4 h-4 shrink-0" /> Saved: {done}
        </p>
      )}
      {visible.map(f => {
        const has = fill?.values?.[f.key] !== undefined && fill?.values?.[f.key] !== null && fill?.values?.[f.key] !== ''
        const mark = has ? filledClass(fill, f.key) : ''
        return (
          <div key={f.key} data-testid={'plain-field-' + f.key} data-type={f.type}>
            {f.type !== 'bool' && (
              <label htmlFor={'plain-' + f.key} className="flex flex-wrap items-center gap-2 text-sm font-medium mb-1.5">
                {f.label}{f.required && <span className="text-destructive" aria-hidden="true">*</span>}
                <FilledMark fill={fill} k={f.key} has={has} />
              </label>
            )}
            {f.type === 'bool' && has && <FilledMark fill={fill} k={f.key} has={has} className="mb-1" />}
            <FieldInput field={f} value={values[f.key]} onChange={change(f.key)} options={options[f.key]} disabled={readOnly || saving} filled={mark} />
            {f.help && <p className="text-xs text-muted-foreground mt-1">{f.help}</p>}
            {touched && problems[f.key] && <p className="text-xs text-destructive mt-1" data-testid={'plain-problem-' + f.key}>{problems[f.key]}</p>}
          </div>
        )
      })}
      {form.attach && !readOnly && (
        <div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="plain-attach-input"
            onChange={e => setFile(e.target.files?.[0] || null)} />
          <button type="button" onClick={() => fileRef.current?.click()} data-testid="plain-attach"
            className="inline-flex items-center gap-2 min-h-[48px] px-4 rounded-lg border text-sm touch-manipulation hover:bg-accent">
            <Camera className="w-4 h-4" /> {file ? file.name : form.attach.label}
          </button>
        </div>
      )}
      {failed && <p className="text-sm text-destructive" data-testid="plain-error">{failed}</p>}
      {!readOnly && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={save} disabled={saving} data-testid="plain-save"
            className="min-h-[48px] px-6 rounded-lg bg-primary text-primary-foreground text-sm font-medium touch-manipulation disabled:opacity-50 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} data-testid="plain-cancel"
              className="min-h-[48px] px-5 rounded-lg border text-sm touch-manipulation hover:bg-accent">Cancel</button>
          )}
        </div>
      )}
    </div>
  )
}

export default PlainForm
