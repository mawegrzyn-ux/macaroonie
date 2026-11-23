// src/components/forms/useFormDraft.js
//
// A form's draft (migration 275, Pepper-first step 3d, docs/CHAT_FIRST.md F6):
// its unsaved values, kept on the server per person, form, venue and day
// (/api/form-drafts), so they survive a reload or a switch of device. Only
// forms with `drafts: true` in shared/forms.js keep one.
//
// This is a draft, not a save of the record: Standard Design Rule 5 ("every
// save is explicit") is about the record, which still changes only when the
// person presses the form's own Save, through the page's own route. The
// draft is kept as the person types (debounced), restored when the form
// opens, and deleted once the form is saved (done()).
//
//   const d = useFormDraft({ form, venueId, day, pepper })
//   d.ready    false while the draft is being read (the form waits for it)
//   d.values   what the form starts from: the draft's values, and Pepper's
//              (from the chat's card) for any field the draft hasn't
//   d.marked   the fields whose value is Pepper's (FormFillProvider marks them)
//   d.change(key, value)   a field changed: kept in the draft
//   d.done()   the form was saved: the draft goes

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { FORMS } from '@shared/forms.js'

export const DRAFT_DEBOUNCE_MS = 800
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function useFormDraft({ form, venueId, day, pepper }) {
  const api = useApi()
  const meta = FORMS[form]
  const on = !!meta?.drafts && !!venueId && (!meta.by || !!day)
  const where = `form=${form}&venue_id=${venueId}${meta?.by ? `&day=${day}` : ''}`
  const { data, isPending, isError } = useQuery({
    queryKey: ['form-draft', form, venueId, day],
    queryFn: () => api.get('/form-drafts?' + where),
    enabled: on,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const ready = !on || !isPending || isError

  // What the form starts from, worked out once, when the draft has been read.
  const start = useRef(null)
  if (ready && !start.current) {
    const own = (on && data?.draft?.values) || {}
    const peppers = pepper || {}
    const values = { ...peppers, ...own }
    // Pepper's value keeps its mark unless the draft holds something else there.
    const marked = new Set(Object.keys(peppers).filter(k => !(k in own) || same(own[k], peppers[k])))
    start.current = { values, marked }
  }

  const current = useRef(null)
  const timer = useRef(null)
  const finished = useRef(false)
  const put = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = null
    if (!on || finished.current || !current.current) return
    api.put('/form-drafts', { form, venue_id: venueId, day: meta.by ? day : null, values: current.current })
      .catch(err => console.error('The form\'s draft wasn\'t kept', err))
  }, [api, on, form, venueId, day, meta])

  const change = useCallback((key, value) => {
    if (!on || finished.current) return
    const next = { ...(current.current || start.current?.values || {}) }
    if (value === null || value === undefined || value === '') delete next[key]
    else next[key] = value
    current.current = next
    clearTimeout(timer.current)
    timer.current = setTimeout(put, DRAFT_DEBOUNCE_MS)
  }, [on, put])

  const done = useCallback(() => {
    if (!on) return
    finished.current = true
    clearTimeout(timer.current)
    timer.current = null
    current.current = null
    api.delete('/form-drafts?' + where).catch(err => console.error('The form\'s draft wasn\'t cleared', err))
  }, [api, on, where])

  // Closing the form with a change still waiting keeps it straight away.
  useEffect(() => () => { if (timer.current) put() }, [put])

  return useMemo(() => ({
    on,
    ready,
    values: start.current?.values ?? pepper ?? {},
    marked: start.current?.marked ?? null,
    change,
    done,
  }), [on, ready, pepper, change, done])
}
