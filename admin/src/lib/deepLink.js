// src/lib/deepLink.js
//
// Where a page is asked to open by its address: ?venue=<id>&date=YYYY-MM-DD,
// ?week=<a Monday>, ?tab=<key> (docs/PEPPER_FIRST.md 4.6). What each page
// accepts is in its record in shared/nav/<area>.js (`accepts`, `tabs`), and
// shared/nav/links.js has the rules: pageLink() writes such an address (Pepper's
// open_page, a Today card), linkValues() reads it back here. The same idea as
// useLinked() (lib/linked.js) for records.
//
//   useDeepLink('/rota', { ready: venuesLoaded, apply: link => { ... } })
//     -> the link ({ venue?, date?, week?, tab? }) or null
//
// The values are read from the address when the page opens (and again when
// a link to the same page is followed while it is open), handed to `apply`
// once, as soon as `ready` is true, and taken out of the address (replace,
// keeping the history entry's state), so a reload or the page's own controls
// aren't held to them. Only the shapes are checked: `apply` must ignore a
// venue the person can't see (one not in the page's own venue list).

import { useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { pageAccepts, linkValues } from '@shared/nav/links.js'

const read = (path, params) => {
  const v = linkValues(path, params)
  return Object.keys(v).length ? v : null
}

export function useDeepLink(path, { ready = true, apply } = {}) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const [link, setLink] = useState(() => read(path, params))
  const seen = useRef(location.search)
  const applied = useRef(null)
  const applyRef = useRef(apply)
  applyRef.current = apply

  // Take the accepted keys out of the address; a new address (a link to this
  // page followed while it is open) is read first.
  useEffect(() => {
    const keys = pageAccepts(path).keys.filter(k => params.has(k))
    if (!keys.length) return
    if (seen.current !== location.search) setLink(read(path, params))
    setParams(prev => {
      const next = new URLSearchParams(prev)
      for (const k of keys) next.delete(k)
      return next
    }, { replace: true, state: location.state })
  }, [location.search]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { seen.current = location.search })

  // Hand each link to the page once, when it is ready for it.
  useEffect(() => {
    if (!link || !ready || applied.current === link) return
    applied.current = link
    applyRef.current?.(link)
  }, [link, ready])

  return link
}
