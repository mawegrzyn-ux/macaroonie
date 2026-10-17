// src/lib/api.js
// Thin fetch wrapper.
// useApi() hook returns an api object with token injected automatically.

import { useAuth0 } from '@auth0/auth0-react'
import { useCallback } from 'react'

const BASE = '/api'

// Selected restaurant — identity is the Auth0 JWT, tenant is this pick.
// Sent as X-Tenant-Id on every request. The API only honours it when the
// caller is a member of that tenant (or a platform admin).
const SELECTED_TENANT_KEY = 'maca_selected_tenant'
const LEGACY_PLATFORM_KEY = 'maca_platform_tenant'

export function getSelectedTenant() {
  try {
    return localStorage.getItem(SELECTED_TENANT_KEY)
      ?? localStorage.getItem(LEGACY_PLATFORM_KEY)
      ?? null
  } catch {
    return null
  }
}

export function setSelectedTenant(id) {
  try {
    if (id) {
      localStorage.setItem(SELECTED_TENANT_KEY, id)
      localStorage.removeItem(LEGACY_PLATFORM_KEY)
    } else {
      localStorage.removeItem(SELECTED_TENANT_KEY)
      localStorage.removeItem(LEGACY_PLATFORM_KEY)
    }
  } catch {}
}

// Back-compat aliases — older sidebar code used the platform-admin names.
export function getPlatformTenantOverride() { return getSelectedTenant() }
export function setPlatformTenantOverride(id) { setSelectedTenant(id) }

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`)
    this.status = status
    this.body   = body
  }
}

function authHeaders(token, extra = {}) {
  const tenantId = getSelectedTenant()
  return {
    'Authorization': `Bearer ${token}`,
    ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    ...extra,
  }
}

async function request(token, method, path, body) {
  const hasBody = body != null
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(token, hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  })

  const data = res.status !== 204 ? await res.json().catch(() => null) : null
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

export function useApi() {
  const { getAccessTokenSilently } = useAuth0()

  const call = useCallback(async (method, path, body) => {
    const token = await getAccessTokenSilently()
    return request(token, method, path, body)
  }, [getAccessTokenSilently])

  // download: fetches a binary resource with auth and triggers a browser Save dialog.
  const download = useCallback(async (path, filename) => {
    const token = await getAccessTokenSilently()
    const res   = await fetch(`${BASE}${path}`, {
      headers: authHeaders(token),
    })
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null))
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename ?? path.split('/').pop()
    a.click()
    URL.revokeObjectURL(url)
  }, [getAccessTokenSilently])

  // upload: posts multipart/form-data (file + optional fields) to the API.
  //   api.upload('/website/upload', file, { kind: 'images' })
  // Returns the parsed JSON response (e.g. { url, kind, bytes, mimetype }).
  const upload = useCallback(async (path, file, extraFields = {}) => {
    const token = await getAccessTokenSilently()
    const fd    = new FormData()
    fd.append('file', file)
    for (const [k, v] of Object.entries(extraFields)) {
      if (v != null) fd.append(k, String(v))
    }
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(token),   // do NOT set Content-Type; fetch handles the boundary
      body: fd,
    })
    const data = res.status !== 204 ? await res.json().catch(() => null) : null
    if (!res.ok) throw new ApiError(res.status, data)
    return data
  }, [getAccessTokenSilently])

  // blob: fetches a file the API serves behind auth (an image to show, a PDF
  // to open), as a Blob.
  const blob = useCallback(async (path) => {
    const token = await getAccessTokenSilently()
    const res   = await fetch(`${BASE}${path}`, { headers: authHeaders(token) })
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null))
    return res.blob()
  }, [getAccessTokenSilently])

  // postBlob: POSTs JSON and returns the file the API sends back (an export
  // built from what's on screen), as a Blob.
  const postBlob = useCallback(async (path, body) => {
    const token = await getAccessTokenSilently()
    const res   = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null))
    return res.blob()
  }, [getAccessTokenSilently])

  // stream: POSTs JSON asking for server-sent events and calls onEvent with
  // each one ({ type, ...data }). Resolves with the `done` event's data;
  // rejects with the `error` event's (an ApiError), or with status 0 and
  // `lost` set when the connection ends without either. A server that
  // answers with plain JSON (an early refusal) is handled like post().
  const stream = useCallback(async (path, body, onEvent) => {
    const token = await getAccessTokenSilently()
    const controller = new AbortController()
    const res   = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(token, { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
      const data = res.status !== 204 ? await res.json().catch(() => null) : null
      if (!res.ok) throw new ApiError(res.status, data)
      return data
    }
    return readEvents(res.body, onEvent, controller)
  }, [getAccessTokenSilently])

  return {
    get:      (path)        => call('GET',    path),
    post:     (path, body)  => call('POST',   path, body),
    patch:    (path, body)  => call('PATCH',  path, body),
    put:      (path, body)  => call('PUT',    path, body),
    delete:   (path, body)  => call('DELETE', path, body),
    download,
    upload,
    blob,
    postBlob,
    stream,
  }
}

// The server sends something at least every 15 s while a stream is open, so
// this long without a byte means the connection has died without closing (a
// phone changing networks): give up on it rather than wait for ever.
const STREAM_IDLE_MS = 45_000

/** Reads a server-sent event stream to its `done` or `error` event. */
async function readEvents(body, onEvent, controller) {
  const reader  = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let idle
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => controller?.abort(), STREAM_IDLE_MS) }
  try {
    arm()
    for (;;) {
      let chunk
      try {
        chunk = await reader.read()
      } catch {
        break   // the network went: treated as a dropped connection
      }
      arm()
      if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true })
      let end
      while ((end = /\r?\n\r?\n/.exec(buffer))) {
        const lines = buffer.slice(0, end.index).split(/\r?\n/)
        buffer = buffer.slice(end.index + end[0].length)
        const data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n')
        if (!data) continue   // a comment (keep-alive)
        let event
        try { event = JSON.parse(data) } catch { continue }
        if (event.type === 'done') return event
        if (event.type === 'error') throw new ApiError(event.status || 500, event)
        onEvent?.(event)
      }
      if (chunk.done) break
    }
  } finally {
    clearTimeout(idle)
  }
  const lost = new ApiError(0, { error: 'The connection dropped before the reply finished.' })
  lost.lost = true
  throw lost
}

// Public fetch — no auth (used for widget slots endpoint)
export async function publicGet(path) {
  const res = await fetch(`${BASE}${path}`)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}
