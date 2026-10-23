// src/pages/MenuTranslations.jsx
//
// Menus > Translations (/menus/translations, migration 172): every word a
// self-order kiosk can show (sections, dishes, combo steps, option groups,
// order types, allergens and dietary tags, the allergen notice, words typed
// in kiosk designs, the kiosk's own words) next to its translation in the
// language picked. A word with no translation shows on the kiosk as written;
// the kiosk's own words and the 14 allergens already come in every language
// (shown as hints) and can be changed. Claude can fill a first draft of the
// missing ones (POST /menus/translations/ai): suggestions are marked and
// nothing is saved until Save (PUT /menus/translations sends only the words
// changed; an emptied box removes the translation). Changes need Menus
// manage; reading is open.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronDown, Languages, Loader2, Search, Sparkles, Square } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { ReadOnlyNotice, ReadOnlyFieldset } from '@/components/ReadOnlyNotice'
import { Card, Btn } from '@/components/menus/shared'

const errText = e => e?.body?.error || e?.message || 'Something went wrong'
const BIG = 250 // rows: with more, only the first group starts open

const Row = memo(function Row({ s, value, hint, suggested, changed, onChange }) {
  const long = s.text.length > 60
  const Box = long ? 'textarea' : 'input'
  return (
    <div className={cn('grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1 px-4 py-2.5', !value && !hint && 'bg-amber-50/40')}
      data-testid="tr-row" data-key={s.key}>
      <div className="min-w-0">
        <p className="text-sm break-words">{s.text}</p>
        <p className="text-[11px] text-muted-foreground truncate">{s.context}</p>
      </div>
      <div className="min-w-0 flex items-start gap-2">
        <Box value={value} onChange={e => onChange(s.key, e.target.value)} placeholder={hint || 'Not translated: shows as written'}
          aria-label={'Translation of ' + s.text} rows={long ? 2 : undefined} maxLength={2000}
          className={cn('w-full text-sm border rounded-md px-2 py-1.5 min-h-[40px] bg-background touch-manipulation',
            suggested && 'border-amber-400 bg-amber-50', long && 'resize-y')} />
        {(suggested || changed) && (
          <span className={cn('shrink-0 mt-2 text-[10px] font-semibold uppercase tracking-wide', suggested ? 'text-amber-700' : 'text-primary')}>
            {suggested ? 'Check' : 'Changed'}
          </span>
        )}
      </div>
    </div>
  )
})

export default function MenuTranslations() {
  const api = useApi()
  const qc = useQueryClient()
  const { canManage } = usePermission('menus')
  const [params, setParams] = useSearchParams()
  const wanted = params.get('lang') || ''
  const { data, isLoading, error } = useQuery({
    queryKey: ['menu-translations', wanted],
    queryFn: () => api.get('/menus/translations' + (wanted ? '?lang=' + wanted : '')),
  })
  const lang = data?.lang
  const saved = data?.texts || {}

  // Edits for this language: key -> text ('' = remove). Suggested: filled by Claude, not edited yet.
  const [draft, setDraft] = useState({})
  const [suggested, setSuggested] = useState(() => new Set())
  useEffect(() => { setDraft({}); setSuggested(new Set()) }, [lang])
  const onChange = useCallback((key, text) => {
    setDraft(d => ({ ...d, [key]: text }))
    setSuggested(s => { if (!s.has(key)) return s; const n = new Set(s); n.delete(key); return n })
  }, [])
  const changes = useMemo(() => Object.fromEntries(Object.entries(draft)
    .filter(([k, v]) => (v || '').trim() !== (saved[k] || ''))), [draft, saved])
  const dirty = Object.keys(changes).length > 0

  const [search, setSearch] = useState('')
  const [missingOnly, setMissingOnly] = useState(false)
  const [group, setGroup] = useState('')
  const [closed, setClosed] = useState(null) // Set of closed groups (null = the default)

  const sources = data?.sources || []
  const valueOf = k => draft[k] ?? saved[k] ?? ''
  const groups = useMemo(() => {
    const out = new Map()
    for (const s of sources) {
      if (!out.has(s.group)) out.set(s.group, [])
      out.get(s.group).push(s)
    }
    return [...out.entries()].map(([name, rows]) => ({ name, rows }))
  }, [sources])
  const done = s => !!(valueOf(s.key).trim() || data?.builtin?.[s.key])
  const total = sources.length
  const translated = sources.filter(done).length
  const q = search.trim().toLowerCase()
  const shown = groups
    .filter(g => !group || g.name === group)
    .map(g => ({
      ...g,
      rows: g.rows.filter(s => (!missingOnly || !done(s))
        && (!q || s.text.toLowerCase().includes(q) || s.context.toLowerCase().includes(q) || valueOf(s.key).toLowerCase().includes(q))),
    }))
    .filter(g => g.rows.length)
  const isClosed = name => !q && (closed ? closed.has(name) : total > BIG && name !== groups[0]?.name)
  const toggleGroup = name => setClosed(c => {
    const n = new Set(c || groups.filter(g => total > BIG && g.name !== groups[0]?.name).map(g => g.name))
    if (n.has(name)) n.delete(name); else n.add(name)
    return n
  })

  const save = useMutation({
    mutationFn: texts => api.put('/menus/translations', { lang, texts }),
    onSuccess: (_, texts) => {
      // Show the saved words straight away, then reload.
      qc.setQueryData(['menu-translations', wanted], old => {
        if (!old) return old
        const next = { ...old.texts }
        for (const [k, v] of Object.entries(texts)) { if ((v || '').trim()) next[k] = v.trim(); else delete next[k] }
        return { ...old, texts: next }
      })
      setDraft({})
      setSuggested(new Set())
      qc.invalidateQueries({ queryKey: ['menu-translations'] })
    },
  })

  // Claude's first draft of the missing words, a batch at a time, into the draft.
  const [ai, setAi] = useState(null) // { running, filled, left, error }
  const stop = useRef(false)
  async function suggest() {
    stop.current = false
    setAi({ running: true, filled: 0, left: null, error: null })
    const skip = new Set(Object.entries(draft).filter(([, v]) => (v || '').trim()).map(([k]) => k))
    let filled = 0
    try {
      for (let round = 0; round < 25 && !stop.current; round++) {
        const res = await api.post('/menus/translations/ai', { lang, source: data.source, skip: [...skip] })
        const got = Object.entries(res.texts || {}).filter(([k, v]) => v && !skip.has(k))
        if (got.length) {
          setDraft(d => ({ ...d, ...Object.fromEntries(got) }))
          setSuggested(s => new Set([...s, ...got.map(([k]) => k)]))
        }
        got.forEach(([k]) => skip.add(k))
        filled += got.length
        setAi({ running: true, filled, left: res.left, error: null })
        if (!res.left || !got.length) break
      }
      setAi(a => ({ ...a, running: false }))
    } catch (e) {
      setAi({ running: false, filled, left: null, error: errText(e) })
    }
  }

  function pickLang(code) {
    if (dirty || code === lang) return
    setParams({ lang: code }, { replace: true })
  }

  const langName = code => data?.languages?.find(l => l.code === code)?.name || code
  const missingCount = total - translated

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 sm:p-6 max-lg:notouch:pl-14 max-w-5xl mx-auto space-y-4">
        <div>
          <Link to="/menus" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5" /> All menus
          </Link>
          <h1 className="text-xl font-semibold mt-1 flex items-center gap-2"><Languages className="w-5 h-5 text-primary" /> Translations</h1>
          <p className="text-sm text-muted-foreground">
            Self-order kiosks show your menu in the guest's language. Words without a translation show as written.
            The kiosk's own words (Pay, Add to order...) and the 14 allergens already come in every language; type here only to change them.
          </p>
        </div>
        {!canManage && <ReadOnlyNotice what="the translations" />}
        {error && <p className="text-sm text-destructive">{errText(error)}</p>}
        {isLoading || !data ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            <Card title="Language" description={'Your menu is written in ' + langName(data.source) + (data.designs ? ' (set on each kiosk design).' : '.')}>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Translate into">
                {data.languages.filter(l => l.code !== data.source).map(l => (
                  <button key={l.code} type="button" onClick={() => pickLang(l.code)} aria-pressed={l.code === lang} disabled={dirty && l.code !== lang}
                    data-testid="tr-lang" data-lang={l.code}
                    className={cn('h-11 px-3 rounded-lg border text-sm inline-flex items-center gap-2 touch-manipulation disabled:opacity-50',
                      l.code === lang ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted')}>
                    {l.name}
                    {l.on_a_kiosk && <span className={cn('w-2 h-2 rounded-full', l.code === lang ? 'bg-primary-foreground' : 'bg-green-600')} title="Offered on a kiosk" />}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-full bg-green-600 mr-1" />Offered on a kiosk (Store tech &gt; Kiosks &gt; a design &gt; Languages).
                {dirty && ' Save or discard your changes to switch language.'}
                {!data.designs && ' No kiosk designs yet: kiosks use English until a design picks other languages.'}
              </p>
            </Card>

            <div className="sticky top-0 z-10 bg-page py-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search words" aria-label="Search words"
                    className="w-full h-11 rounded-lg border bg-background pl-9 pr-3 text-sm touch-manipulation" />
                </div>
                <label className="h-11 px-3 rounded-lg border bg-background text-sm inline-flex items-center gap-2 cursor-pointer touch-manipulation">
                  <input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)} className="w-4 h-4" />
                  Only missing
                </label>
                <select value={group} onChange={e => setGroup(e.target.value)} aria-label="Group"
                  className="h-11 rounded-lg border bg-background px-2 text-sm touch-manipulation max-w-[220px]">
                  <option value="">Everything</option>
                  {groups.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm flex-1 min-w-[200px]" data-testid="tr-progress">
                  <span className="font-semibold">{translated}</span> of {total} in {langName(lang)}
                  {missingCount > 0 && <span className="text-muted-foreground"> · {missingCount} show as written</span>}
                </p>
                {canManage && data.ai && (
                  ai?.running
                    ? <Btn variant="secondary" onClick={() => { stop.current = true }}><Square className="w-3.5 h-3.5" /> Stop ({ai.filled} so far)</Btn>
                    : <Btn variant="secondary" onClick={suggest} disabled={!missingCount} data-testid="tr-ai"><Sparkles className="w-3.5 h-3.5" /> Suggest the missing ones</Btn>
                )}
                {canManage && dirty && <Btn variant="secondary" onClick={() => { setDraft({}); setSuggested(new Set()) }}>Discard</Btn>}
                {canManage && (
                  <Btn disabled={!dirty || save.isPending || ai?.running} onClick={() => save.mutate(changes)} data-testid="tr-save">
                    {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {dirty ? 'Save ' + Object.keys(changes).length + ' change' + (Object.keys(changes).length === 1 ? '' : 's') : 'Saved'}
                  </Btn>
                )}
              </div>
              {ai && !ai.running && !ai.error && ai.filled > 0 && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="tr-ai-note">
                  Claude suggested {ai.filled} translation{ai.filled === 1 ? '' : 's'}, marked Check. Read them, change any that are wrong, then Save.
                  {ai.left ? ' ' + ai.left + ' more are left: press Suggest again.' : ''}
                </p>
              )}
              {ai?.error && <p className="text-xs text-destructive">{ai.error}</p>}
              {save.isError && <p className="text-xs text-destructive">{errText(save.error)}</p>}
              {canManage && !data.ai && <p className="text-[11px] text-muted-foreground">AI suggestions need the assistant switched on (Platform page).</p>}
            </div>

            {!total && <p className="text-sm text-muted-foreground">Nothing to translate yet: add dishes on the Menus page.</p>}
            <div className="space-y-3">
                {shown.map(g => {
                  const gDone = g.rows.filter(done).length
                  const open = !isClosed(g.name)
                  return (
                    <section key={g.name} className="rounded-xl border bg-background overflow-hidden" data-testid="tr-group">
                      <button type="button" onClick={() => toggleGroup(g.name)} aria-expanded={open}
                        className="w-full flex items-center gap-3 px-4 min-h-[48px] section-head text-left touch-manipulation">
                        <span className="flex-1 min-w-0 text-sm font-semibold truncate">{g.name}</span>
                        <span className={cn('text-xs shrink-0', gDone < g.rows.length ? 'text-amber-800' : 'text-green-700')}>{gDone} / {g.rows.length}</span>
                        <ChevronDown className={cn('w-4 h-4 shrink-0 transition-transform', open && 'rotate-180')} />
                      </button>
                      {open && (
                        <ReadOnlyFieldset disabled={!canManage}>
                          <div className="divide-y">
                            {g.rows.map(s => (
                              <Row key={s.key} s={s} value={valueOf(s.key)} hint={data.builtin?.[s.key] || null}
                                suggested={suggested.has(s.key)} changed={s.key in changes && !suggested.has(s.key)} onChange={onChange} />
                            ))}
                          </div>
                        </ReadOnlyFieldset>
                      )}
                    </section>
                  )
                })}
                {total > 0 && !shown.length && <p className="text-sm text-muted-foreground">Nothing matches.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
