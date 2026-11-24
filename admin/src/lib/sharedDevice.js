// src/lib/sharedDevice.js
//
// This browser (or this Office app install) as a shared device (Pepper-first
// step 6a, migration 280; api/src/middleware/sharedDevice.js is the judge).
//
//   The device token  kept in localStorage (DEVICE_KEY) once an admin marks
//                     the device shared; sent as X-Shared-Device on every
//                     request (lib/api.js).
//   The person        the short-lived token from POST /shared-devices/act,
//                     kept in memory only (a reload is a Lock), sent as
//                     X-Acting-Person.
//   askWho(code)      when a change comes back 403 person_needed or
//                     office_pin_needed, lib/api.js asks "Who is this?"
//                     through the handler SharedDeviceLayer registers, then
//                     sends the change again once.
//   Idle              IDLE_MS after the last tap or key the person is locked
//                     here too; while they use the device, "still here" goes
//                     to the server at most every STILL_HERE_MS.

import { useSyncExternalStore } from 'react'

export const DEVICE_KEY = 'maca_shared_device'
export const DEVICE_HEADER = 'X-Shared-Device'
export const ACT_HEADER = 'X-Acting-Person'
/** The codes a refused change comes back with on a shared device. */
export const PERSON_CODES = new Set(['person_needed', 'office_pin_needed'])
export const IDLE_MS = 120_000
const STILL_HERE_MS = 30_000

function readDevice() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    const d = raw ? JSON.parse(raw) : null
    return d && typeof d.token === 'string' && /^sd_[0-9a-f]{64}$/.test(d.token) ? d : null
  } catch { return null }
}

let state = { device: readDevice(), person: null }
let actToken = null
let lastTouch = 0
let lastStillHere = 0
let idleTimer = null
let whoHandler = null
let stillHereFn = null
const listeners = new Set()

function set(next) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const snapshot = () => state

/** { device, person } for the UI: device null when this isn't a shared device. */
export function useSharedDevice() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export const sharedDevice = () => state.device

/** The headers every request carries on a shared device. */
export function sharedHeaders() {
  if (!state.device) return {}
  return { [DEVICE_HEADER]: state.device.token, ...(actToken ? { [ACT_HEADER]: actToken } : {}) }
}

/** This device was just marked shared (POST /shared-devices answered with its token). */
export function keepDevice(device, token) {
  const d = { token, id: device.id, name: device.name, venue_id: device.venue_id, venue_name: device.venue_name }
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(d)) } catch { /* private mode */ }
  set({ device: d, person: null })
  actToken = null
}

/** This device is no longer shared (stopped here, or the server no longer knows it). */
export function forgetDevice() {
  try { localStorage.removeItem(DEVICE_KEY) } catch { /* private mode */ }
  actToken = null
  clearTimeout(idleTimer)
  set({ device: null, person: null })
}

/** Someone said who they are: { token, person } from POST /shared-devices/act. */
export function startPerson(token, person) {
  actToken = token
  lastTouch = Date.now()
  lastStillHere = Date.now()
  set({ person })
  armIdle()
}

/** Lock: the person is gone from this device (the server is told by the caller). */
export function endPerson() {
  actToken = null
  clearTimeout(idleTimer)
  if (state.person) set({ person: null })
}

/** The token to send with POST /shared-devices/lock. */
export const personToken = () => actToken

function armIdle() {
  clearTimeout(idleTimer)
  if (!actToken) return
  const left = IDLE_MS - (Date.now() - lastTouch)
  idleTimer = setTimeout(() => {
    if (Date.now() - lastTouch >= IDLE_MS) {
      const token = actToken
      endPerson()
      lockFn?.(token)
    } else armIdle()
  }, Math.max(1000, left))
}

let lockFn = null
/** SharedDeviceLayer hands over how to tell the server (Lock, still here). */
export function setServerCalls({ lock, stillHere }) {
  lockFn = lock
  stillHereFn = stillHere
}

/** A tap or a key on the page: the person is still here. */
export function touched() {
  if (!actToken) return
  lastTouch = Date.now()
  if (Date.now() - lastStillHere > STILL_HERE_MS) {
    lastStillHere = Date.now()
    stillHereFn?.(actToken)
  }
}

/** SharedDeviceLayer's "Who is this?": resolves once someone switched in, rejects if they close it. */
export function setWhoHandler(fn) { whoHandler = fn }

export async function askWho(code) {
  if (!whoHandler) throw new Error('This is a shared device: say who you are first.')
  return whoHandler(code)
}
