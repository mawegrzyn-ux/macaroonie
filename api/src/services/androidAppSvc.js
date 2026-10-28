// src/services/androidAppSvc.js
//
// The Macaroonie Android app's download (android-app/ in the repository).
// The APK is built by EAS (expo.dev) and its links there change with every
// build and don't last for ever, so a platform admin pastes the newest link
// on the Platform page and the server keeps a copy of the file
// (storageSvc, kind 'android' under 'platform'). Devices download it from
// /android on pos., kitchen. and kiosk. (routes/posSite.js); their setup
// screen offers it when there is one (GET /pos-api/android-app).
//
// Stored in platform_settings 'android_app' (migration 213):
//   { url, key, bytes, sha256, source_url, file_url }
//   url / key   where storageSvc put the copy
//   source_url  the link the admin pasted (shown back to them)
//   file_url    the APK's own address when the link was a web page

import crypto from 'node:crypto'
import { sql } from '../config/db.js'
import { env } from '../config/env.js'
import { getStorage } from './storageSvc.js'

export const ANDROID_APP = 'android_app'
export const APK_MIME = 'application/vnd.android.package-archive'
export const MAX_APK_BYTES = 250 * 1024 * 1024
export const MAX_PAGE_BYTES = 4 * 1024 * 1024
// Under nginx's 60 s on /api/: the copy is made while the admin waits.
export const FETCH_MS = 45_000

class AppFileError extends Error {
  constructor(message) { super(message); this.statusCode = 422 }
}

/** The saved download, or null. */
export async function androidApp() {
  const [row] = await sql`SELECT value, updated_by, updated_at FROM platform_settings WHERE name = ${ANDROID_APP}`
  if (!row?.value?.url) return null
  return { ...row.value, updated_by: row.updated_by, updated_at: row.updated_at }
}

/** A pasted link: https (http too outside production, for tests), at most 2,000 characters. */
export function cleanLink(raw) {
  const text = String(raw || '').trim()
  if (!text || text.length > 2000) return null
  let u
  try { u = new URL(text) } catch { return null }
  const ok = u.protocol === 'https:' || (u.protocol === 'http:' && env.NODE_ENV !== 'production')
  if (!ok || u.username || u.password) return null
  return u.toString()
}

/** The first .apk address in a web page (expo.dev's build page links its file). */
export function apkLinkIn(html, base) {
  const text = String(html || '')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
  const m = text.match(/https?:\/\/[^"'\s<>\\)]+?\.apk(?:\?[^"'\s<>\\)]*)?(?=["'\s<>\\)]|$)/i)
  if (!m) return null
  try { return new URL(m[0], base).toString() } catch { return null }
}

/**
 * Is this an installable Android app? An APK is a zip with an
 * AndroidManifest.xml; an app bundle (.aab, Google Play only) is a zip too,
 * with a BundleConfig.pb.
 */
export function apkProblem(buf) {
  if (!buf || buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    return 'That file isn\'t an Android app (.apk).'
  }
  if (buf.includes('BundleConfig.pb')) {
    return 'That is an app bundle (.aab), which only Google Play can install. Use an APK build (the preview or production profile in eas.json).'
  }
  if (!buf.includes('AndroidManifest.xml')) return 'That file isn\'t an Android app (.apk).'
  return null
}

async function readCapped(res, max, what) {
  const len = Number(res.headers.get('content-length'))
  if (len && len > max) throw new AppFileError(`The ${what} is bigger than ${Math.round(max / 1048576)} MB.`)
  const chunks = []
  let total = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      await reader.cancel().catch(() => {})
      throw new AppFileError(`The ${what} is bigger than ${Math.round(max / 1048576)} MB.`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

async function get(url, signal) {
  let res
  try {
    res = await fetch(url, { redirect: 'follow', signal, headers: { 'user-agent': 'Macaroonie (Android app copy)' } })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new AppFileError('Getting the app took too long. Try again.')
    }
    throw new AppFileError('Couldn\'t reach that link: ' + (err?.cause?.code || err?.message || 'no answer') + '.')
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new AppFileError(`That link answered ${res.status}: check it opens the app's download, and that the build hasn't expired.`)
  }
  return res
}

/**
 * Fetch the app from a pasted link and keep a copy. A link to a web page
 * (the build's page on expo.dev) is read for the .apk address it links.
 * Returns { buffer, file_url }.
 */
export async function fetchApk(link, { timeoutMs = FETCH_MS } = {}) {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    let res = await get(link, signal)
    let fileUrl = res.url || link
    if (/text\/html/i.test(res.headers.get('content-type') || '')) {
      const page = (await readCapped(res, MAX_PAGE_BYTES, 'page')).toString('utf8')
      const found = apkLinkIn(page, fileUrl)
      if (!found) {
        throw new AppFileError('That link opens a web page with no app file on it. On the build\'s page on expo.dev, copy the link of its Install or Download button and paste that.')
      }
      res = await get(found, signal)
      fileUrl = res.url || found
    }
    const buffer = await readCapped(res, MAX_APK_BYTES, 'app')
    const problem = apkProblem(buffer)
    if (problem) throw new AppFileError(problem)
    return { buffer, file_url: fileUrl }
  } catch (err) {
    if (err instanceof AppFileError) throw err
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new AppFileError('Getting the app took too long. Try again.')
    }
    throw err
  }
}

/** Copy the app from a link and make it the download. The old copy is removed. */
export async function saveAndroidApp(rawLink, { by = null, timeoutMs } = {}) {
  const link = cleanLink(rawLink)
  if (!link) throw new AppFileError('Paste the app\'s https:// link.')
  const { buffer, file_url } = await fetchApk(link, { timeoutMs })
  const stored = await getStorage().put('platform', 'android', 'apk', APK_MIME, buffer)
  const value = {
    url: stored.url,
    key: stored.key,
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    source_url: link,
    file_url: file_url !== link ? file_url : null,
  }
  const before = await androidApp()
  await sql`
    INSERT INTO platform_settings (name, value, updated_by, updated_at)
    VALUES (${ANDROID_APP}, ${sql.json(value)}, ${by}, now())
    ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`
  if (before?.url && before.url !== value.url) await getStorage().delete(before.url).catch(() => {})
  return androidApp()
}

/** Stop offering the app and remove the copy. */
export async function removeAndroidApp() {
  const before = await androidApp()
  await sql`DELETE FROM platform_settings WHERE name = ${ANDROID_APP}`
  if (before?.url) await getStorage().delete(before.url).catch(() => {})
  return !!before
}

/** What the setup screens may know: whether there is a download, how big, when saved. */
export function publicView(app) {
  if (!app) return { available: false }
  return { available: true, path: '/android', bytes: app.bytes, updated_at: app.updated_at }
}
