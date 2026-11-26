// Sharing a picture (or a link or a note) to the app from another app
// (shareCore.js, the bridge's share part, links.js onPhonePages, the share
// target in app.json).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { bridgeScript, makeHandler, sharedScript } from '../bridge.js'
import { onPhonePages } from '../links.js'
import {
  createShareInbox, whatWasShared, readShared, fitWithin, base64Bytes, pictureName,
  SHARE_KEEP_MS, SHARE_MAX_BYTES, SHARE_TEXT_MAX, NOT_A_PICTURE, UNREADABLE, TOO_BIG,
} from '../shareCore.js'

const appJson = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url)))

/** A page with the bridge on it, wired to an app handler whose share part is the inbox. */
function wire(inbox, { allowed = () => true } = {}) {
  let handle
  const window = { ReactNativeWebView: { postMessage: data => setTimeout(() => handle(data, 'https://ops.macaroonie.com/mobile'), 0) } }
  const page = vm.createContext({ window, Promise, setTimeout, JSON, Error })
  vm.runInContext(bridgeScript('9'), page)
  const run = script => vm.runInContext(script, page)
  handle = makeHandler({ allowed, run, services: { share: { take: async () => inbox.take() } } })
  return { window, run }
}

const picture = { kind: 'image', name: 'invoice.jpg', type: 'image/jpeg', dataBase64: 'aGVsbG8=', more: 0 }

test('share.take() gives the waiting picture once, then null; nothing waiting gives null', async () => {
  const inbox = createShareInbox()
  const { window } = wire(inbox)
  assert.equal(await window.MacaroonieOffice.share.take(), null, 'nothing shared')
  inbox.put(picture)
  assert.equal(inbox.waiting(), true)
  assert.deepEqual(JSON.parse(JSON.stringify(await window.MacaroonieOffice.share.take())), picture, 'as the app holds it (a copy from the page)')
  assert.equal(await window.MacaroonieOffice.share.take(), null, 'taken once only')
  assert.equal(inbox.waiting(), false)
})

test('the page hears about a share while it is open, and stops hearing once it lets go', () => {
  const { window, run } = wire(createShareInbox())
  let heard = 0
  const stop = window.MacaroonieOffice.share.onShared(() => { heard++ })
  window.MacaroonieOffice.share.onShared(() => { throw new Error('one listener failing') })
  run(sharedScript())
  assert.equal(heard, 1, 'the notice reaches the page (and one failing listener doesn\'t stop the others)')
  stop()
  run(sharedScript())
  assert.equal(heard, 1)
  assert.doesNotMatch(sharedScript(), /base64|data/i, 'the notice carries no picture: the page takes it')
})

test('a page that isn\'t ours can\'t take a shared picture', async () => {
  const inbox = createShareInbox()
  inbox.put(picture)
  const { window } = wire(inbox, { allowed: () => false })
  await assert.rejects(window.MacaroonieOffice.share.take(), /Not on a Macaroonie page/)
  assert.equal(inbox.waiting(), true, 'still waiting for our page')
})

test('an app without the share part answers null (older services), and a page script without it is unchanged', async () => {
  let handle
  const window = { ReactNativeWebView: { postMessage: data => setTimeout(() => handle(data, 'https://ops.macaroonie.com/mobile'), 0) } }
  const page = vm.createContext({ window, Promise, setTimeout, JSON, Error })
  vm.runInContext(bridgeScript('9'), page)
  handle = makeHandler({ allowed: () => true, run: s => vm.runInContext(s, page), services: {} })
  assert.equal(await window.MacaroonieOffice.share.take(), null)
})

test('the inbox drops what nobody took after ten minutes, and a new share replaces the old', () => {
  let at = 1000
  const timers = []
  const inbox = createShareInbox({ now: () => at, timers: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearTimeout() {} } })
  inbox.put(picture)
  assert.equal(timers[0].ms, SHARE_KEEP_MS)
  inbox.put({ kind: 'text', text: 'second' })
  at += SHARE_KEEP_MS - 1
  assert.deepEqual(inbox.take(), { kind: 'text', text: 'second' })
  inbox.put(picture)
  at += SHARE_KEEP_MS + 1
  assert.equal(inbox.take(), null, 'too old')
  inbox.put(picture)
  timers.at(-1).fn()
  assert.equal(inbox.waiting(), false, 'the timer lets it go')
})

test('what was shared: the first picture (and how many were left out), words, or a polite no', () => {
  const one = whatWasShared({ files: [{ contentUri: 'content://media/1', filePath: '/data/cache/IMG_1.jpg', fileName: 'IMG_1.jpg', mimeType: 'image/jpeg' }, ['type', 'file']] })
  assert.deepEqual(one, { kind: 'image', uris: ['content://media/1', 'file:///data/cache/IMG_1.jpg'], name: 'IMG_1.jpg', more: 0 })
  const three = whatWasShared({ files: [
    { contentUri: 'content://x/a', mimeType: 'video/mp4', fileName: 'a.mp4' },
    { contentUri: 'content://x/b', mimeType: 'image/png', fileName: 'b.png' },
    { contentUri: 'content://x/c', mimeType: 'image/heic', fileName: 'c.heic' },
  ] })
  assert.equal(three.uris[0], 'content://x/b', 'the first picture among them')
  assert.equal(three.name, 'b.jpg')
  assert.equal(three.more, 2)
  assert.deepEqual(whatWasShared({ files: [{ contentUri: 'content://x/d', mimeType: 'application/pdf', fileName: 'd.pdf' }] }), { kind: 'refused', message: NOT_A_PICTURE })
  assert.deepEqual(whatWasShared({ text: '  https://supplier.example/invoice/7  ', type: 'text' }), { kind: 'text', text: 'https://supplier.example/invoice/7' })
  assert.equal(whatWasShared({ text: 'x'.repeat(5000) }).text.length, SHARE_TEXT_MAX)
  assert.equal(whatWasShared({ text: '   ' }), null)
  assert.equal(whatWasShared(null), null)
  assert.equal(whatWasShared({ files: [{ mimeType: 'image/jpeg' }] }), null, 'a file with no address is nothing')
})

test('a shared picture is shrunk, tried address by address, then at a lower quality, and capped', async () => {
  const found = whatWasShared({ files: [{ contentUri: 'content://a', filePath: '/c/a.jpg', mimeType: 'image/jpeg', fileName: 'a.jpg' }] })
  const tried = []
  const item = await readShared(found, async (uri, q) => { tried.push([uri, q]); if (uri.startsWith('content')) throw new Error('no grant'); return 'QUJD' })
  assert.deepEqual(tried, [['content://a', 0.8], ['file:///c/a.jpg', 0.8]])
  assert.deepEqual(item, { kind: 'image', name: 'a.jpg', type: 'image/jpeg', dataBase64: 'QUJD', more: 0 })

  const big = 'A'.repeat(Math.ceil(SHARE_MAX_BYTES * 4 / 3) + 8)
  const qualities = []
  const smaller = await readShared(found, async (uri, q) => { qualities.push(q); return q > 0.7 ? big : 'QUJD' })
  assert.deepEqual(qualities, [0.8, 0.6])
  assert.equal(smaller.dataBase64, 'QUJD')
  assert.deepEqual(await readShared(found, async () => big), { kind: 'refused', message: TOO_BIG })
  assert.deepEqual(await readShared(found, async () => { throw new Error('nope') }), { kind: 'refused', message: UNREADABLE })
  assert.deepEqual(await readShared({ kind: 'text', text: 'hi' }, null), { kind: 'text', text: 'hi' })
  assert.equal(await readShared(null, null), null)
})

test('sizes and names', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 2000 })
  assert.deepEqual(fitWithin(3000, 4000), { height: 2000 })
  assert.equal(fitWithin(2000, 1500), null)
  assert.equal(fitWithin(0, 0), null)
  assert.equal(base64Bytes('aGVsbG8='), 5)
  assert.equal(base64Bytes(''), 0)
  assert.equal(pictureName('IMG_2024 (1).HEIC'), 'IMG_2024 1.jpg')
  assert.equal(pictureName('../../etc/passwd'), 'passwd.jpg')
  assert.equal(pictureName('.hidden'), 'shared-picture.jpg')
  assert.equal(pictureName(''), 'shared-picture.jpg')
})

test('the phone pages are where a share opens Capture', () => {
  assert.ok(onPhonePages('https://ops.macaroonie.com/mobile', 'macaroonie.com'))
  assert.ok(onPhonePages('https://ops.macaroonie.com/mobile/cash-up?d=1', 'macaroonie.com'))
  assert.ok(!onPhonePages('https://ops.macaroonie.com/mobilex', 'macaroonie.com'))
  assert.ok(!onPhonePages('https://office.macaroonie.com/mobile', 'macaroonie.com'))
  assert.ok(!onPhonePages('https://ops.macaroonie.com/', 'macaroonie.com'))
  assert.ok(!onPhonePages(null, 'macaroonie.com'))
})

test('the app is a share target for pictures and words on Android, not the iPhone yet', () => {
  const plugin = appJson.expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-share-intent')
  assert.ok(plugin, 'expo-share-intent\'s config plugin')
  assert.deepEqual(plugin[1].androidIntentFilters, ['image/*', 'text/plain'])
  assert.deepEqual(plugin[1].androidMultiIntentFilters, ['image/*'])
  assert.equal(plugin[1].disableIOS, true, 'an iPhone share extension needs the Apple account and an app group')
})
