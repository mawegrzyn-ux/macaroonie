// src/components/forms/CustomFields.jsx
//
// A group's own fields (Pepper-first step 8B1, migration 285): fields an
// owner adds to customers, staff members, suppliers and inventory items in
// Settings, filled on each one's page, drawn on the plain forms, offered in
// reports and taken by Pepper's tools by their names. The rules of a
// definition and a value are shared/customFields.js; the API checks again.
//
//   CustomFieldSettings              the Settings section: each object's fields,
//                                    add, rename, choices, required, delete
//                                    (double confirm); Manage on the object's module
//   CustomFieldsCard({ objectKey, values, canEdit, onSave })
//                                    one row's own fields with its own Save
//                                    (onSave(custom) -> the route's PATCH)
//   useCustomFields(objectKey)       the group's definitions for one object
//   CustomFieldInputs({ defs, form, onChange, problems, showProblems })
//                                    the fields themselves, for a form that makes
//                                    a row (the Inventory page's New item, step 9d)
//                                    and for the card; required ones are marked
//   newRowCustom(defs, form)         -> { custom, problems }: what a new row sends
//                                    (only filled fields; the API needs the
//                                    required ones) and what is wrong

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/api'
import {
  CUSTOM_TYPES, TYPE_LABELS, MAX_FIELDS, valueProblem, cleanValue, definitionProblem,
} from '@shared/customFields.js'

const inputCls = 'w-full h-12 rounded-lg border bg-background px-3 text-sm touch-manipulation disabled:opacity-60'
const btnCls = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-lg text-sm font-medium touch-manipulation disabled:opacity-50'

export function useCustomFields(objectKey) {
  const api = useApi()
  return useQuery({
    queryKey: ['custom-fields', objectKey || 'all'],
    queryFn: () => api.get('/custom-fields' + (objectKey ? '?object=' + encodeURIComponent(objectKey) : '')),
    staleTime: 30_000,
  })
}

// ── One value ───────────────────────────────────────────────────

function ValueInput({ def, value, onChange, disabled }) {
  const id = 'cf-' + def.field_key
  const test = { 'data-testid': 'custom-input-' + def.field_key }
  if (def.type === 'yesno') {
    return (
      <div className="flex gap-1.5" role="radiogroup" aria-label={def.label} {...test}>
        {[['', 'Not set'], [true, 'Yes'], [false, 'No']].map(([v, label]) => (
          <button key={label} type="button" disabled={disabled} aria-pressed={value === v} onClick={() => onChange(v)}
            className={cn('min-h-[48px] px-3 rounded-lg border text-sm touch-manipulation disabled:opacity-60',
              value === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
            {label}
          </button>
        ))}
      </div>
    )
  }
  if (def.type === 'choice') {
    return (
      <select id={id} className={inputCls} value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)} {...test}>
        <option value="">{def.required ? 'Pick one' : 'Not set'}</option>
        {def.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (def.type === 'date') {
    return (
      <span className={cn('relative flex items-center gap-2 h-12 px-3 rounded-lg border bg-background text-sm touch-manipulation', disabled && 'opacity-60')}>
        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className={cn('tabular-nums truncate', !value && 'text-muted-foreground')}>
          {value ? format(parseISO(value), 'EEE d MMM yyyy') : 'Pick a date'}
        </span>
        <input id={id} type="date" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} {...test}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer touch-manipulation" />
      </span>
    )
  }
  return (
    <input id={id} className={inputCls} value={value ?? ''} disabled={disabled}
      inputMode={def.type === 'number' ? 'decimal' : undefined}
      onChange={e => onChange(def.type === 'number' ? e.target.value.replace(/[^0-9.,-]/g, '') : e.target.value)} {...test} />
  )
}

const NO_FIELDS = []

/** The group's own fields as inputs: label (required marked), the value's control, help, a problem. */
export function CustomFieldInputs({ defs, form, onChange, disabled, problems = {}, showProblems = true }) {
  return defs.map(d => (
    <div key={d.id} data-testid={'custom-field-' + d.field_key}>
      <label htmlFor={'cf-' + d.field_key} className="text-sm font-medium mb-1.5 flex items-center gap-1">
        {d.label}{d.required && <span className="text-destructive" aria-hidden="true">*</span>}
      </label>
      <ValueInput def={d} value={form[d.field_key] ?? ''} disabled={disabled} onChange={v => onChange(d.field_key, v)} />
      {d.help && <p className="text-xs text-muted-foreground mt-1">{d.help}</p>}
      {problems[d.field_key] && showProblems && <p className="text-xs text-destructive mt-1">{problems[d.field_key]}</p>}
    </div>
  ))
}

/** A new row's own fields: the filled ones as the API takes them, and each field's problem (a required one left empty). */
export function newRowCustom(defs, form) {
  const custom = {}
  const problems = {}
  for (const d of defs) {
    const v = form[d.field_key]
    const p = valueProblem(d, v ?? '')
    if (p) problems[d.field_key] = p
    if (v !== undefined && v !== '') custom[d.field_key] = cleanValue(d, v) ?? v
  }
  return { custom, problems }
}
const startOf = (def, v) => (v === undefined || v === null ? '' : def.type === 'yesno' ? !!v : String(v))

/**
 * One row's own fields, with its own Save: only what changed is sent (an
 * emptied field as null, which takes it off). Nothing when the group has none.
 */
export function CustomFieldsCard({ objectKey, values, canEdit, onSave, className }) {
  const { data } = useCustomFields(objectKey)
  const defs = data?.fields || NO_FIELDS
  // Keyed by what the values are, so a parent's new object with the same values doesn't reset what is being typed.
  const valuesKey = JSON.stringify(values || {})
  const start = useMemo(() => Object.fromEntries(defs.map(d => [d.field_key, startOf(d, values?.[d.field_key])])), [defs, valuesKey])
  const [form, setForm] = useState(start)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setForm(start) }, [start])
  const save = useMutation({
    mutationFn: changed => onSave(changed),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) },
  })
  if (!defs.length) return null
  const problems = Object.fromEntries(defs.map(d => [d.field_key, valueProblem(d, form[d.field_key])]).filter(([, p]) => p))
  const changed = Object.fromEntries(defs.filter(d => form[d.field_key] !== start[d.field_key]).map(d => {
    const v = form[d.field_key]
    return [d.field_key, v === '' ? null : (cleanValue(d, v) ?? v)]
  }))
  const dirty = Object.keys(changed).length > 0
  return (
    <div className={cn('bg-background border rounded-xl overflow-hidden', className)} data-testid="custom-fields-card">
      <div className="px-4 py-3 section-head flex items-center gap-2">
        <h3 className="text-sm font-semibold flex-1">Your own fields</h3>
        {canEdit && (
          <button type="button" data-testid="custom-save" disabled={!dirty || Object.keys(problems).length > 0 || save.isPending}
            onClick={() => save.mutate(changed)} className={cn(btnCls, 'bg-primary text-primary-foreground px-5')}>
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null} Save
          </button>
        )}
      </div>
      <div className="p-4 space-y-3">
        <CustomFieldInputs defs={defs} form={form} disabled={!canEdit || save.isPending} problems={problems} showProblems={dirty}
          onChange={(k, v) => setForm(f => ({ ...f, [k]: v }))} />
        {save.error && <p className="text-sm text-destructive" data-testid="custom-error">{save.error.message}</p>}
      </div>
    </div>
  )
}

// ── Settings ────────────────────────────────────────────────────

function DefinitionRow({ def, canManage }) {
  const api = useApi()
  const qc = useQueryClient()
  const [label, setLabel] = useState(def.label)
  const [options, setOptions] = useState((def.options || []).join(', '))
  const [required, setRequired] = useState(!!def.required)
  const [help, setHelp] = useState(def.help || '')
  const [sure, setSure] = useState(false)
  const opts = options.split(',').map(s => s.trim()).filter(Boolean)
  const next = { label: label.trim(), required, help: help.trim() || null, ...(def.type === 'choice' ? { options: opts } : {}) }
  const dirty = next.label !== def.label || required !== !!def.required || (next.help || '') !== (def.help || '')
    || (def.type === 'choice' && opts.join('|') !== (def.options || []).join('|'))
  const problem = definitionProblem({ ...next, type: def.type, options: def.type === 'choice' ? opts : [] })
  const done = () => {
    qc.invalidateQueries({ queryKey: ['custom-fields'] })
    qc.invalidateQueries({ queryKey: ['plain-form'] })
    qc.invalidateQueries({ queryKey: ['report-catalogue'] })
  }
  const save = useMutation({ mutationFn: () => api.patch('/custom-fields/' + def.id, next), onSuccess: done })
  const del = useMutation({ mutationFn: () => api.delete('/custom-fields/' + def.id), onSuccess: done })
  return (
    <div className="py-3 space-y-2" data-testid={'custom-def-' + def.field_key}>
      <div className="flex flex-wrap items-center gap-2">
        <input className={cn(inputCls, 'flex-1 min-w-[160px]')} value={label} disabled={!canManage} aria-label="Name"
          onChange={e => setLabel(e.target.value)} data-testid="custom-def-label" />
        <span className="text-xs rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{TYPE_LABELS[def.type]}</span>
      </div>
      {def.type === 'choice' && (
        <input className={inputCls} value={options} disabled={!canManage} aria-label="Choices, separated by commas"
          placeholder="Choices, separated by commas" onChange={e => setOptions(e.target.value)} />
      )}
      <input className={inputCls} value={help} disabled={!canManage} placeholder="Help (optional)" aria-label="Help"
        onChange={e => setHelp(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 min-h-[48px] px-1 text-sm touch-manipulation">
          <input type="checkbox" className="w-5 h-5" checked={required} disabled={!canManage} onChange={e => setRequired(e.target.checked)} />
          Needed on a new one
        </label>
        <span className="flex-1" />
        {canManage && (
          <>
            <button type="button" className={cn(btnCls, 'bg-primary text-primary-foreground')} disabled={!dirty || !!problem || save.isPending}
              onClick={() => save.mutate()} data-testid="custom-def-save">Save</button>
            {!sure ? (
              <button type="button" className={cn(btnCls, 'border text-destructive')} onClick={() => setSure(true)} data-testid="custom-def-delete">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-xs text-destructive">Its value goes from every row. Sure?</span>
                <button type="button" className={cn(btnCls, 'bg-destructive text-destructive-foreground')} disabled={del.isPending}
                  onClick={() => del.mutate()} data-testid="custom-def-delete-yes">Delete</button>
                <button type="button" className={cn(btnCls, 'border')} onClick={() => setSure(false)}>Keep</button>
              </span>
            )}
          </>
        )}
      </div>
      {dirty && problem && <p className="text-xs text-destructive">{problem}</p>}
      {(save.error || del.error) && <p className="text-sm text-destructive">{(save.error || del.error).message}</p>}
    </div>
  )
}

function NewDefinition({ objectKey, onDone }) {
  const api = useApi()
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [type, setType] = useState('text')
  const [options, setOptions] = useState('')
  const opts = options.split(',').map(s => s.trim()).filter(Boolean)
  const body = { object_key: objectKey, label: label.trim(), type, ...(type === 'choice' ? { options: opts } : {}) }
  const problem = label.trim() ? definitionProblem({ ...body, options: type === 'choice' ? opts : [] }) : 'A field needs a name'
  const add = useMutation({
    mutationFn: () => api.post('/custom-fields', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields'] })
      qc.invalidateQueries({ queryKey: ['plain-form'] })
      qc.invalidateQueries({ queryKey: ['report-catalogue'] })
      setLabel(''); setOptions(''); setType('text'); onDone?.()
    },
  })
  return (
    <div className="pt-3 space-y-2 border-t" data-testid={'custom-new-' + objectKey}>
      <input className={inputCls} value={label} placeholder="A new field's name, e.g. Payment terms" aria-label="New field's name"
        onChange={e => setLabel(e.target.value)} data-testid="custom-new-label" />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
        {CUSTOM_TYPES.map(t => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} data-value={t}
            className={cn('min-h-[48px] px-3 rounded-lg border text-sm touch-manipulation',
              type === t ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent')}>
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {type === 'choice' && (
        <input className={inputCls} value={options} placeholder="Choices, separated by commas" aria-label="Choices"
          onChange={e => setOptions(e.target.value)} data-testid="custom-new-options" />
      )}
      <div className="flex items-center gap-2">
        <button type="button" className={cn(btnCls, 'bg-primary text-primary-foreground')} disabled={!!problem || add.isPending}
          onClick={() => add.mutate()} data-testid="custom-new-add">
          {add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add field
        </button>
        {label.trim() && problem && <span className="text-xs text-destructive">{problem}</span>}
      </div>
      {add.error && <p className="text-sm text-destructive">{add.error.message}</p>}
    </div>
  )
}

/** The Settings section: each object the person can see, its fields, and (with Manage) changes. */
export function CustomFieldSettings() {
  const { data, isLoading, error } = useCustomFields(null)
  if (isLoading) return <div className="p-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  if (error) return <p className="text-sm text-destructive">{error.message}</p>
  if (!data?.objects?.length) return null
  return (
    <div className="space-y-3" data-testid="custom-field-settings">
      {data.objects.map(o => {
        const defs = data.fields.filter(f => f.object_key === o.key)
        return (
          <div key={o.key} className="bg-background border rounded-xl overflow-hidden" data-testid={'custom-object-' + o.key}>
            <div className="px-5 py-3 section-head">
              <h3 className="text-sm font-semibold">{o.plural}</h3>
            </div>
            <div className="px-5 pb-4">
              {!defs.length && <p className="py-3 text-sm text-muted-foreground">No fields of your own yet.</p>}
              <div className="divide-y">
                {defs.map(d => <DefinitionRow key={d.id + d.updated_at} def={d} canManage={o.can_manage} />)}
              </div>
              {o.can_manage && defs.length < (data.max || MAX_FIELDS) && <NewDefinition objectKey={o.key} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default CustomFieldSettings
