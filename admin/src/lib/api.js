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

  return {
    get:      (path)        => call('GET',    path),
    post:     (path, body)  => call('POST',   path, body),
    patch:    (path, body)  => call('PATCH',  path, body),
    put:      (path, body)  => call('PUT',    path, body),
    delete:   (path, body)  => call('DELETE', path, body),
    download,
    upload,
  }
}

// Public fetch — no auth (used for widget slots endpoint)
export async function publicGet(path) {
  const res = await fetch(`${BASE}${path}`)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}
