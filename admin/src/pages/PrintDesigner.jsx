// src/pages/PrintDesigner.jsx
//
// A print design (/pos/print-designs/:id, migration 190): the blocks of a
// kitchen ticket or receipt in order (drag to reorder, add, remove), each
// block's options, and a preview laid out in the printer's columns with a
// made-up order. "All locations" edits the design itself; picking a venue
// edits only what that venue changes (its words and the blocks it leaves
// out). Explicit Save. shared/pos/ticketLayout.js, tickets.js, ticketHtml.js.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Plus, Printer, Save } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import {
  PageHeader, Section, Field, Btn, Toggle, Segmented, ErrorNote, ConfirmDelete, SortableRows, inputCls,
  usePosVenue, usePosSetup,
} from '@/components/pos/shared'
import {
  BLOCK_TYPES, KITCHEN_FIELDS, RECEIPT_FIELDS, TEXT_KEYS, SAMPLES, TITLE_MAINS,
  normaliseVariation, applyVariation, blockSummary, sampleTicket, canRemove,
} from '@shared/pos/ticketLayout.js'
import { kitchenTicket, receipt } from '@shared/pos/tickets.js'
import { previewHtml, PREVIEW_CSS } from '@shared/pos/ticketHtml.js'

const SIZE_OPTIONS = [{ value: 'normal', label: 'Normal' }, { value: 'tall', label: 'Tall' }, { value: 'big', label: 'Big' }]
const ALIGN_OPTIONS = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]
const PAPERS = [{ value: 32, label: '58 mm' }, { value: 42, label: '80 mm' }, { value: 48, label: '80 mm small type' }]
const TITLE_LABELS = {
  kitchen: { auto: 'Table, or order number and name', number: 'Order number', tent: 'Tent number', table: 'Table', name: 'Customer name' },
  receipt: { auto: 'Order number, or the table', number: 'Order number', tent: 'Tent number', table: 'Table', name: 'Customer name' },
}
const TEXT_LABELS = { text: 'Words', receipt_text: 'On receipts', bill_text: 'On bills (before payment)' }
const EMPTY_VARIATION = { texts: {}, hidden: [] }

function newBlockId(blocks) {
  let n = blocks.length + 1
  const ids = new Set(blocks.map(b => b.id))
  while (ids.has('b' + n)) n++
  return 'b' + n
}

export default function PrintDesigner() {
  const { id } = useParams()
  const api = useApi()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { canManage } = usePermission('pos_setup')
  const { venues } = usePosVenue()
  const { data: design, error, isLoading } = useQuery({ queryKey: ['print-design', id], queryFn: () => api.get('/pos/print-designs/' + id) })
  const [draft, setDraft] = useState(null)
  const [where, setWhere] = useState('')
  const [variation, setVariation] = useState(EMPTY_VARIATION)
  const [selId, setSelId] = useState(null)
  const [sample, setSample] = useState(null)
  const [cols, setCols] = useState(() => { try { return Number(localStorage.getItem('maca_print_cols')) || 42 } catch { return 42 } })
  const [leaving, setLeaving] = useState(false)
  const { data: venueSetup } = usePosSetup(where || null)

  useEffect(() => { if (design) setDraft({ name: design.name, layout: design.layout }) }, [design])
  const savedVariation = useMemo(() => (where && design?.variations?.[where]) || EMPTY_VARIATION, [design, where])
  useEffect(() => setVariation({ texts: savedVariation.texts || {}, hidden: savedVariation.hidden || [] }), [savedVariation])

  const kind = design?.kind
  const companyDirty = !!draft && !!design && JSON.stringify({ name: draft.name, layout: draft.layout }) !== JSON.stringify({ name: design.name, layout: design.layout })
  const venueDirty = !!where && JSON.stringify({ texts: variation.texts, hidden: variation.hidden }) !== JSON.stringify({ texts: savedVariation.texts || {}, hidden: savedVariation.hidden || [] })
  const dirty = companyDirty || venueDirty

  const save = useMutation({
    mutationFn: () => (where
      ? api.put(`/pos/print-designs/${id}/variations/${where}`, { texts: variation.texts, hidden: variation.hidden })
      : api.put('/pos/print-designs/' + id, { name: draft.name.trim() || design.name, layout: draft.layout })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['print-design', id] })
      qc.invalidateQueries({ queryKey: ['print-designs'] })
    },
  })

  if (isLoading || !draft) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader icon={Printer} title="Print design" />
        <div className="p-6"><ErrorNote error={error} />{!error && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}</div>
      </div>
    )
  }

  const blocks = draft.layout.blocks
  const sel = blocks.find(b => b.id === selId) || null
  const setBlocks = next => setDraft(d => ({ ...d, layout: { blocks: next } }))
  const patchBlock = (bid, opts) => setBlocks(blocks.map(b => (b.id === bid ? { ...b, opts: { ...b.opts, ...opts } } : b)))
  const addBlock = type => {
    const b = { id: newBlockId(blocks), type, opts: { ...BLOCK_TYPES[kind][type].opts } }
    setBlocks([...blocks, b])
    setSelId(b.id)
  }
  const removeBlock = bid => { setBlocks(blocks.filter(b => b.id !== bid)); setSelId(null) }
  const hidden = new Set(variation.hidden)
  const toggleHidden = bid => setVariation(v => ({ ...v, hidden: hidden.has(bid) ? v.hidden.filter(x => x !== bid) : [...v.hidden, bid] }))
  const setVenueText = (bid, key, value) => setVariation(v => {
    const texts = { ...v.texts, [bid]: { ...(v.texts[bid] || {}), [key]: value } }
    return { ...v, texts }
  })
  const clearVenueText = bid => setVariation(v => {
    const texts = { ...v.texts }
    delete texts[bid]
    return { ...v, texts }
  })

  // The preview: the design (with this venue's changes when one is picked) and a made-up order.
  const sampleKey = sample && SAMPLES[kind].some(s => s.key === sample) ? sample : SAMPLES[kind][0].key
  const s = venueSetup?.settings
  const venue = where ? venues.find(v => v.id === where) : null
  const venueInfo = where ? { name: s?.receipt_name || venue?.name, address: s?.receipt_address || [], vatNumber: s?.vat_number || null } : {}
  const shown = where ? applyVariation(draft.layout, normaliseVariation(draft.layout, variation)) : draft.layout
  const ticket = sampleTicket(kind, sampleKey, venueInfo, new Date())
  const ops = kind === 'kitchen' ? kitchenTicket(ticket, shown) : receipt(ticket, shown)
  const html = previewHtml(ops, cols)
  const pickCols = n => { setCols(n); try { localStorage.setItem('maca_print_cols', String(n)) } catch { /* private mode */ } }

  const back = () => (dirty ? setLeaving(true) : navigate('/pos?tab=printing'))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader icon={Printer} title={(kind === 'kitchen' ? 'Kitchen ticket: ' : 'Receipt: ') + design.name}>
        <Btn onClick={back} data-testid="pd-back"><ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Printing</span></Btn>
        <select value={where} onChange={e => { setWhere(e.target.value); setSelId(null) }} disabled={dirty}
          title={dirty ? 'Save or discard first' : 'Where the changes apply'} aria-label="Where the changes apply" data-testid="pd-where"
          className="h-10 rounded-xl border bg-background px-3 text-sm touch-manipulation max-w-[220px]">
          <option value="">All locations (the design)</option>
          {venues.map(v => <option key={v.id} value={v.id}>Only at {v.name}</option>)}
        </select>
        {canManage && (
          <>
            <Btn disabled={!dirty || save.isPending} onClick={() => { setDraft({ name: design.name, layout: design.layout }); setVariation({ texts: savedVariation.texts || {}, hidden: savedVariation.hidden || [] }) }} data-testid="pd-discard">Discard</Btn>
            <Btn variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="pd-save">
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {dirty ? 'Save' : 'Saved'}
            </Btn>
          </>
        )}
      </PageHeader>
      {leaving && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-amber-50 text-amber-900 text-sm" role="alert" data-testid="pd-leave">
          <span className="flex-1 min-w-[200px]">Leave without saving your changes?</span>
          <Btn variant="danger" onClick={() => navigate('/pos?tab=printing')}>Leave</Btn>
          <Btn onClick={() => setLeaving(false)}>Stay</Btn>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] items-start">
          <div className="space-y-4 min-w-0">
            {!canManage && <ReadOnlyNotice what="print designs" />}
            <ErrorNote error={save.error} />
            {where && (
              <p className="rounded-lg border border-sky-200 bg-sky-50 text-sky-900 px-3 py-2 text-sm" data-testid="pd-where-note">
                Changes here apply only at {venue?.name}: change its words, or leave a part out. The rest of the design is set for all locations.
              </p>
            )}
            {/* Only the fields are locked for View: the parts stay tappable to see their options. */}
            <div className="space-y-4">
                {!where && (
                  <ReadOnlyFieldset disabled={!canManage}>
                    <Section title="Name">
                      <input className={inputCls} value={draft.name} maxLength={80} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} aria-label="Design name" data-testid="pd-name" />
                    </Section>
                  </ReadOnlyFieldset>
                )}
                <Section title={kind === 'kitchen' ? 'The ticket, top to bottom' : 'The receipt, top to bottom'}
                  hint={where ? 'Untick a part to leave it out at this venue.' : 'Drag to change the order. Tap a part to change it.'}>
                  <div data-testid="pd-blocks">
                    <SortableRows items={blocks} locked={!!where || !canManage} onReorder={ids => setBlocks(ids.map(x => blocks.find(b => b.id === x)))}
                      renderItem={b => (
                        <div className={cn('flex items-center gap-2', hidden.has(b.id) && where && 'opacity-50')} data-testid="pd-block" data-type={b.type} data-id={b.id}>
                          {where && canRemove(kind, b) && (
                            <input type="checkbox" className="w-5 h-5 shrink-0" checked={!hidden.has(b.id)} onChange={() => toggleHidden(b.id)} disabled={!canManage}
                              aria-label={'Print ' + BLOCK_TYPES[kind][b.type].label + ' here'} data-testid="pd-shown" />
                          )}
                          <button type="button" onClick={() => setSelId(b.id)} aria-pressed={selId === b.id}
                            className={cn('flex-1 min-w-0 text-left min-h-[44px] px-2 py-1 rounded-lg touch-manipulation', selId === b.id ? 'bg-primary/10 ring-2 ring-primary/40' : 'hover:bg-muted')}>
                            <span className="block text-sm font-medium">{BLOCK_TYPES[kind][b.type].label}</span>
                            <span className="block text-xs text-muted-foreground truncate">{blockSummary(kind, { ...b, opts: { ...b.opts, ...(where ? variation.texts[b.id] || {} : {}) } })}</span>
                          </button>
                        </div>
                      )} />
                  </div>
                  {!where && canManage && (
                    <label className="flex items-center gap-2">
                      <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                      <select className={cn(inputCls, 'flex-1')} value="" onChange={e => e.target.value && addBlock(e.target.value)} aria-label="Add a part" data-testid="pd-add">
                        <option value="">Add a part…</option>
                        {Object.entries(BLOCK_TYPES[kind]).map(([type, t]) => <option key={type} value={type}>{t.label}</option>)}
                      </select>
                    </label>
                  )}
                </Section>
                {sel && (
                  <Section title={BLOCK_TYPES[kind][sel.type].label} hint={BLOCK_TYPES[kind][sel.type].hint}
                    actions={!where && canManage && canRemove(kind, sel) && <ConfirmDelete label={'Take out ' + BLOCK_TYPES[kind][sel.type].label} confirmLabel="Yes, take it out" onConfirm={() => removeBlock(sel.id)} />}>
                    <ReadOnlyFieldset disabled={!canManage}>
                      <div data-testid="pd-options" data-type={sel.type}>
                        {where
                          ? <VenueOptions kind={kind} block={sel} words={variation.texts[sel.id] || {}} onText={(k, v) => setVenueText(sel.id, k, v)} onReset={() => clearVenueText(sel.id)} venueName={venue?.name} />
                          : <BlockOptions kind={kind} block={sel} onChange={opts => patchBlock(sel.id, opts)} />}
                      </div>
                    </ReadOnlyFieldset>
                  </Section>
                )}
            </div>
          </div>

          <div className="md:sticky md:top-0 space-y-3 min-w-0" data-testid="pd-preview-panel">
            <div className="flex flex-wrap gap-2">
              <select value={sampleKey} onChange={e => setSample(e.target.value)} aria-label="Example order" data-testid="pd-sample"
                className="h-10 rounded-xl border bg-background px-3 text-sm touch-manipulation">
                {SAMPLES[kind].map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
              <select value={cols} onChange={e => pickCols(Number(e.target.value))} aria-label="Paper" data-testid="pd-paper"
                className="h-10 rounded-xl border bg-background px-3 text-sm touch-manipulation">
                {PAPERS.map(p => <option key={p.value} value={p.value}>{p.label} ({p.value} letters)</option>)}
              </select>
            </div>
            <div className="rounded-xl border bg-muted/40 p-3 overflow-x-auto">
              <style>{PREVIEW_CSS}</style>
              <div className="tk shadow-sm mx-auto" style={{ width: 'calc(' + cols + 'ch + 20px)' }} data-testid="pd-preview" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
            <p className="text-xs text-muted-foreground max-w-[380px]">
              Laid out as the receipt printer prints it. Venue name, address and VAT number come from Till setup → Receipts and payments
              {where ? '' : ' (pick a venue above to see its own)'}.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function FieldPicker({ list, value, onChange }) {
  const on = new Set(value || [])
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="pd-fields">
      {list.map(f => (
        <button key={f.key} type="button" aria-pressed={on.has(f.key)} data-k={f.key}
          onClick={() => onChange(list.map(x => x.key).filter(k => (k === f.key ? !on.has(k) : on.has(k))))}
          className={cn('min-h-[44px] px-3 rounded-lg border text-sm touch-manipulation', on.has(f.key) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
          {f.label}
        </button>
      ))}
    </div>
  )
}

function BlockOptions({ kind, block, onChange }) {
  const o = block.opts || {}
  switch (block.type) {
    case 'station':
      return <Field group label="Size"><Segmented value={o.size} options={SIZE_OPTIONS} onChange={v => onChange({ size: v })} /></Field>
    case 'title':
      return (
        <div className="space-y-3">
          <Field label="Shows" hint={o.main === 'auto' ? null : 'An order without one prints the usual title instead.'}>
            <select className={inputCls} value={o.main} onChange={e => onChange({ main: e.target.value })} data-testid="pd-title-main">
              {TITLE_MAINS.map(k => <option key={k} value={k}>{TITLE_LABELS[kind][k]}</option>)}
            </select>
          </Field>
          <Field group label="Size"><Segmented value={o.size} options={SIZE_OPTIONS} onChange={v => onChange({ size: v })} /></Field>
          <Toggle label="White on black" checked={o.invert} onChange={v => onChange({ invert: v })} />
        </div>
      )
    case 'details':
      return (
        <div className="space-y-3">
          <Field group label="Shows" hint="Only what the order has prints.">
            <FieldPicker list={kind === 'kitchen' ? KITCHEN_FIELDS : RECEIPT_FIELDS} value={o.fields} onChange={fields => onChange({ fields })} />
          </Field>
          {kind === 'kitchen' && (
            <>
              <Field group label="Style">
                <Segmented value={o.style} options={[{ value: 'plain', label: 'Plain' }, { value: 'band', label: 'White on black, capitals' }]} onChange={v => onChange({ style: v })} />
              </Field>
              <Field group label="Size"><Segmented value={o.size} options={SIZE_OPTIONS} onChange={v => onChange({ size: v })} /></Field>
            </>
          )}
        </div>
      )
    case 'items':
      return kind === 'kitchen'
        ? (
          <div className="space-y-3">
            <Field group label="Dish size">
              <Segmented value={o.size} options={[{ value: 'normal', label: 'Normal' }, { value: 'tall', label: 'Tall' }]} onChange={v => onChange({ size: v })} />
            </Field>
            <Toggle label="Seat numbers" checked={o.seats} onChange={v => onChange({ seats: v })} />
          </div>
        )
        : <Toggle label="Options and meal parts under each dish" hint="With their prices. Off: one line per dish with its full price." checked={o.extras} onChange={v => onChange({ extras: v })} />
    case 'text':
      return (
        <div className="space-y-3">
          <Field label="Words" hint="New lines print as new lines.">
            <textarea className={cn(inputCls, 'h-auto py-2')} rows={3} maxLength={300} value={o.text} onChange={e => onChange({ text: e.target.value })} data-testid="pd-text" />
          </Field>
          <Field group label="Line up"><Segmented value={o.align} options={ALIGN_OPTIONS} onChange={v => onChange({ align: v })} /></Field>
          <Field group label="Size"><Segmented value={o.size} options={SIZE_OPTIONS} onChange={v => onChange({ size: v })} /></Field>
          <Toggle label="Bold" checked={o.bold} onChange={v => onChange({ bold: v })} />
        </div>
      )
    case 'rule':
      return <Field group label="Line"><Segmented value={o.char} options={[{ value: '-', label: 'Single' }, { value: '=', label: 'Double' }]} onChange={v => onChange({ char: v })} /></Field>
    case 'space':
      return <Field group label="Blank lines"><Segmented value={o.lines} options={[1, 2, 3, 4, 5].map(n => ({ value: n, label: String(n) }))} onChange={v => onChange({ lines: v })} /></Field>
    case 'venue':
      return (
        <div className="space-y-1">
          <Toggle label="Name" checked={o.name} onChange={v => onChange({ name: v })} />
          <Toggle label="Address" checked={o.address} onChange={v => onChange({ address: v })} />
          <Toggle label="VAT number" checked={o.vat} onChange={v => onChange({ vat: v })} />
          <Field group label="Name size"><Segmented value={o.size} options={SIZE_OPTIONS} onChange={v => onChange({ size: v })} /></Field>
        </div>
      )
    case 'heading':
    case 'footer':
      return (
        <div className="space-y-3">
          {TEXT_KEYS[block.type].map(k => (
            <Field key={k} label={TEXT_LABELS[k]} hint={k === 'bill_text' ? 'A bill is printed before payment.' : null}>
              <textarea className={cn(inputCls, 'h-auto py-2')} rows={2} maxLength={300} value={o[k] || ''} onChange={e => onChange({ [k]: e.target.value })} data-testid={'pd-' + k} />
            </Field>
          ))}
          {block.type === 'heading' && <Field group label="Size"><Segmented value={o.size} options={SIZE_OPTIONS} onChange={v => onChange({ size: v })} /></Field>}
        </div>
      )
    case 'totals':
      return (
        <div className="space-y-3">
          <Toggle label="Subtotal" checked={o.subtotal} onChange={v => onChange({ subtotal: v })} />
          <Field group label="Total size">
            <Segmented value={o.size} options={[{ value: 'normal', label: 'Normal' }, { value: 'tall', label: 'Tall' }]} onChange={v => onChange({ size: v })} />
          </Field>
        </div>
      )
    default:
      return <p className="text-sm text-muted-foreground">Nothing to set.</p>
  }
}

function VenueOptions({ kind, block, words, onText, onReset, venueName }) {
  const keys = TEXT_KEYS[block.type]
  if (!keys) {
    return (
      <p className="text-sm text-muted-foreground">
        Set for all locations: pick All locations above to change it.{canRemove(kind, block) ? ' Untick it in the list to leave it out at ' + venueName + '.' : ''}
      </p>
    )
  }
  const own = keys.some(k => typeof words[k] === 'string')
  return (
    <div className="space-y-3">
      {keys.map(k => (
        <Field key={k} label={TEXT_LABELS[k] + ' at ' + venueName} hint={'Everywhere else: ' + (block.opts[k] || 'nothing')}>
          <textarea className={cn(inputCls, 'h-auto py-2')} rows={2} maxLength={300} value={typeof words[k] === 'string' ? words[k] : block.opts[k] || ''}
            onChange={e => onText(k, e.target.value)} data-testid={'pd-venue-' + k} />
        </Field>
      ))}
      {own && <Btn onClick={onReset} data-testid="pd-venue-reset">Use the words for all locations</Btn>}
    </div>
  )
}
