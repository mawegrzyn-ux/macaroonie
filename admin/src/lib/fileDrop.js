// src/lib/fileDrop.js
//
// Pictures (and screen videos) dropped from the computer onto the editors:
// the screen board designer, the menu print designer, the website page
// builder and every picture field (FileDropArea).
//
//   useFileDrop()      drop handlers for one area; only file drags count,
//                      and the innermost area takes the drop
//   installDropGuard() once per page load (main.jsx): a file or link dropped
//                      where nothing takes it does nothing, instead of the
//                      browser opening it over the admin and losing unsaved
//                      work
//   uploadMedia()      a file into the Media library, reusing the same file
//                      when it is already there in that scope
//   mediaSize()        a picture's or video's size (and a video's length)
//   noImageDrag        onDragStart for canvases: stops the browser's own
//                      dragging of a picture, which otherwise cancels moving
//                      the block it sits in

import { useRef, useState } from 'react'

const VIDEO_TYPES = ['video/mp4', 'video/webm']
const HASH_MAX_BYTES = 30 * 1024 * 1024

export const isFileDrag = e => Array.from(e?.dataTransfer?.types || []).includes('Files')
export const isImageFile = f => /^image\//.test(f?.type || '')
export const isVideoFile = f => VIDEO_TYPES.includes(f?.type)

/** The files of the kinds asked for (['image'], ['image', 'video']). */
export function pickFiles(list, kinds = ['image']) {
  return Array.from(list || []).filter(f => (kinds.includes('image') && isImageFile(f)) || (kinds.includes('video') && isVideoFile(f)))
}

const kindWords = kinds => (kinds.includes('video') ? (kinds.includes('image') ? 'a picture or a video' : 'a video') : 'a picture')

/**
 * Drop handlers for an area. onFiles(files, event) gets only files of the
 * kinds asked for; onRefused(message) runs when none were.
 * Returns { over, dropProps } (spread dropProps on the element).
 */
export function useFileDrop({ onFiles, onRefused, kinds = ['image'], disabled = false } = {}) {
  const depth = useRef(0)
  const [over, setOver] = useState(false)
  const active = e => !disabled && isFileDrag(e)
  const dropProps = {
    onDragEnter: e => {
      if (!active(e)) return
      e.preventDefault(); e.stopPropagation()
      depth.current += 1
      setOver(true)
    },
    onDragOver: e => {
      if (!active(e)) return
      e.preventDefault(); e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: e => {
      if (!active(e)) return
      e.stopPropagation()
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    },
    onDrop: e => {
      if (!active(e)) return
      e.preventDefault(); e.stopPropagation()
      depth.current = 0
      setOver(false)
      const files = pickFiles(e.dataTransfer.files, kinds)
      if (files.length) onFiles?.(files, e)
      else onRefused?.(`That isn't ${kindWords(kinds)}. Drop a JPG, PNG, WebP or GIF${kinds.includes('video') ? ', or an MP4 or WebM video' : ''}.`)
    },
  }
  return { over, dropProps }
}

let guarded = false
/** A drop nobody takes does nothing (no browser opening the file). */
export function installDropGuard() {
  if (guarded || typeof window === 'undefined') return
  guarded = true
  const editable = t => !!t?.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]')
  window.addEventListener('dragover', e => {
    if (e.defaultPrevented || editable(e.target)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
  })
  window.addEventListener('drop', e => {
    if (e.defaultPrevented || editable(e.target)) return
    e.preventDefault()
  })
}

/** For a canvas's onDragStart: no dragging a picture (or link) out of a block. */
export function noImageDrag(e) {
  const t = e.target
  if (t?.tagName === 'IMG' || t?.tagName === 'VIDEO' || t?.tagName === 'A' || t?.closest?.('.sl-block, .md-block')) e.preventDefault()
}

async function sha256(file) {
  if (!globalThis.crypto?.subtle || file.size > HASH_MAX_BYTES) return null
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A dropped file into the Media library (POST /media/items/upload), or the
 * item already there with the same content in that scope. Returns the
 * media item ({ url, mimetype, ... }).
 */
export async function uploadMedia(api, file, scope = 'shared') {
  let hash = null
  try { hash = await sha256(file) } catch { /* upload anyway */ }
  if (hash) {
    try {
      const rows = await api.post('/media/items/check-duplicate', { filename: file.name || 'upload', hash, scope })
      const same = (rows || []).find(r => r.hash === hash)
      if (same) return same
    } catch { /* upload anyway */ }
  }
  return api.upload('/media/items/upload', file, { scope })
}

/** { width, height, duration? } of a picture or video file (nulls when the browser can't tell). */
export function mediaSize(file) {
  const url = URL.createObjectURL(file)
  const done = v => { URL.revokeObjectURL(url); return v }
  if (isVideoFile(file)) {
    return new Promise(resolve => {
      const v = document.createElement('video')
      v.preload = 'metadata'; v.muted = true
      const finish = r => { v.removeAttribute('src'); resolve(done(r)) }
      v.onloadedmetadata = () => finish({
        width: v.videoWidth || null, height: v.videoHeight || null,
        duration: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null,
      })
      v.onerror = () => finish({ width: null, height: null, duration: null })
      setTimeout(() => finish({ width: null, height: null, duration: null }), 10000)
      v.src = url
    })
  }
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(done({ width: img.naturalWidth || null, height: img.naturalHeight || null }))
    img.onerror = () => resolve(done({ width: null, height: null }))
    img.src = url
  })
}
