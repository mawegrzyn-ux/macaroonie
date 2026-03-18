// src/lib/api.js
// Thin fetch wrapper.
// useApi() hook returns an api object with token injected automatically.

import { useAuth0 } from '@auth0/auth0-react'
import { useCallback } from 'react'

const BASE = '/api'

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`)
    this.status = status
    this.body   = body
  }
}

async function request(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
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

  return {
    get:    (path)        => call('GET',    path),
    post:   (path, body)  => call('POST',   path, body),
    patch:  (path, body)  => call('PATCH',  path, body),
    put:    (path, body)  => call('PUT',    path, body),
    delete: (path)        => call('DELETE', path),
  }
}

// Public fetch — no auth (used for widget slots endpoint)
export async function publicGet(path) {
  const res = await fetch(`${BASE}${path}`)
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}
