// A tiny key-value store on IndexedDB: the till's pairing, config, checks and
// unsent events live here so the till works after a reload with the internet
// down. Falls back to memory when IndexedDB isn't available (private mode).

const DB = 'macaroonie-till'
const STORE = 'kv'
let dbPromise = null
const memory = new Map()

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

export async function get(key) {
  const db = await open()
  if (!db) return memory.get(key)
  return new Promise(resolve => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(undefined)
  })
}

export async function set(key, value) {
  const db = await open()
  if (!db) { memory.set(key, value); return }
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function del(key) {
  const db = await open()
  if (!db) { memory.delete(key); return }
  return new Promise(resolve => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}
