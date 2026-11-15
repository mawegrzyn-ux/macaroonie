// src/services/privateStore.js
//
// Files only signed-in routes hand out (docs/REPORTS.md 14): report files
// kept for past runs (report_files, migration 250), and later the files
// schedules make. Unlike uploads (services/storageSvc.js, served to anyone
// at /uploads/...), nothing here has an address: a route checks who is
// asking, then streams the file. The folder is PRIVATE_DIR (config/env.js),
// outside the app's own folder, so the deploy's clean-up never removes it
// and nginx never serves it. Files and folders are made readable by the
// API's own user only.
//
// A key is <area>/<YYYY-MM-DD>/<uuid>.<ext>: made here by newKey(), never
// from anything someone typed, and checked against KEY before a path is
// built from it, so no key can reach outside the folder.
//
//   newKey(area, ext)            a new key for a file of that area and kind
//   putBuffer(key, data)         write a whole file (never over another)
//   writeStream(key)             a stream to write a file into (async)
//   readStream(key)              a stream to read one
//   sizeOf(key)                  its size in bytes, or null when it isn't there
//   remove(key)                  delete one (no error when it isn't there)
//   removeDaysBefore(area, ymd)  an area's day folders before a day: files a
//                                crash left behind, which no row points at

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'

const KEY = /^([a-z][a-z0-9-]{0,30})\/(\d{4}-\d{2}-\d{2})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(csv|xlsx|pdf|json)$/
const AREA = /^[a-z][a-z0-9-]{0,30}$/
const YMD = /^\d{4}-\d{2}-\d{2}$/

const root = () => path.resolve(env.PRIVATE_DIR)

/** The file's place on disk; throws for anything that isn't a key made by newKey(). */
function pathOf(key) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('Not a private file key')
  const base = root()
  const full = path.resolve(base, key)
  if (!full.startsWith(base + path.sep)) throw new Error('Not a private file key')
  return full
}

export function newKey(area, ext, now = new Date()) {
  const key = area + '/' + now.toISOString().slice(0, 10) + '/' + crypto.randomUUID() + '.' + ext
  pathOf(key)
  return key
}

async function folderFor(full) {
  await fsp.mkdir(path.dirname(full), { recursive: true, mode: 0o700 })
}

export async function putBuffer(key, data) {
  const full = pathOf(key)
  await folderFor(full)
  await fsp.writeFile(full, data, { flag: 'wx', mode: 0o600 })
}

export async function writeStream(key) {
  const full = pathOf(key)
  await folderFor(full)
  return fs.createWriteStream(full, { flags: 'wx', mode: 0o600 })
}

export function readStream(key) {
  return fs.createReadStream(pathOf(key))
}

export async function sizeOf(key) {
  try {
    const st = await fsp.stat(pathOf(key))
    return st.isFile() ? st.size : null
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

export async function remove(key) {
  await fsp.rm(pathOf(key), { force: true })
}

export async function removeDaysBefore(area, ymd) {
  if (!AREA.test(area) || !YMD.test(ymd)) throw new Error('Not an area and a day')
  const dir = path.join(root(), area)
  let days
  try {
    days = await fsp.readdir(dir)
  } catch (e) {
    if (e.code === 'ENOENT') return 0
    throw e
  }
  let removed = 0
  for (const day of days) {
    if (!YMD.test(day) || day >= ymd) continue
    await fsp.rm(path.join(dir, day), { recursive: true, force: true })
    removed++
  }
  return removed
}
