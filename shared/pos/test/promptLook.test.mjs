// How an order flow's prompt looks on each channel (shared/pos/orderFlows.js,
// ask.look): tills, kiosks and online ordering each have a standard look a
// prompt can change; colours are the channel's theme colours or codes.
// Run: node --test shared/pos/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseOrderFlow, normalisePromptLook, normalisePromptPart, promptLook, promptLookDefault, promptStyle,
  promptColour, promptPicture, promptInk, colourContrast, hasOwnLook, ownFlow, flowProblems, PROMPT_COLOUR_KEYS,
} from '../orderFlows.js'

const uuid = () => globalThis.crypto.randomUUID()
const COKE = uuid(), WATER = uuid()
const ask = look => normaliseOrderFlow({
  id: uuid(), name: 'Drink', kind: 'ask', apps: ['till', 'kiosk', 'online'],
  ask: { title: 'Add a drink?', item_ids: [COKE, WATER], look },
})
// A kiosk design's colours and a brand theme, as the channels hand them over.
const KIOSK_THEME = { primary: '#0b6b3a', accent: '#ffc72c', background: '#fbf8f2', surface: '#ffffff', text: '#1b1b1b', muted: '#6e6a62' }
const BRAND = { primary: '#630812', accent: '#f4a7b9', background: '#ffffff', surface: '#f9f6f1', text: '#1a1a1a', muted: '#666666' }

test('each channel has a standard look, and a flow with none stores no look', () => {
  assert.equal(promptLookDefault('till').pictures, false, 'tills: no pictures, as before')
  assert.equal(promptLookDefault('kiosk').header.align, 'center', 'kiosks: the title centred, as before')
  assert.equal(promptLookDefault('online').dishes, 'rows', 'online: a list, as before')
  const f = ask(undefined)
  assert.equal('look' in f.ask, false, 'no look key at all while every channel is standard')
  assert.deepEqual(promptLook(f, 'kiosk'), promptLookDefault('kiosk'))
  // A look equal to the standard one is the same as none.
  assert.equal(normalisePromptLook({ till: promptLookDefault('till'), kiosk: promptLookDefault('kiosk'), online: promptLookDefault('online') }), null)
  assert.equal('look' in ask({ till: { pictures: false }, kiosk: {}, online: { dishes: 'rows' } }).ask, false)
  // Each copy is fresh: changing one doesn't change the next.
  promptLookDefault('till').colours.window = '#000000'
  assert.equal(promptLookDefault('till').colours.window, null)
})

test('a channel\'s own look is stored tidy; the others stay standard', () => {
  const f = ask({
    kiosk: {
      header: { style: 'band', align: 'nowhere', image_url: '/uploads/t/media/head.jpg' },
      background: { image_url: '/uploads/t/media/bg.png', shade: 140 },
      dishes: 'rows', pictures: false,
      colours: { window: 'surface', header: 'PRIMARY', title: '#ABCDEF', text: 'pink', cards: '#12345', button: 'accent', extra: '#000000' },
    },
    online: { pictures: true, dishes: 'cards' },
    till: 'not a look',
  })
  assert.equal(f.ask.look.till, null)
  assert.deepEqual(f.ask.look.kiosk, {
    header: { style: 'band', align: 'center', image_url: '/uploads/t/media/head.jpg' },
    background: { image_url: '/uploads/t/media/bg.png', shade: 90 },
    dishes: 'rows', pictures: false,
    colours: { window: 'surface', header: null, title: '#abcdef', text: null, cards: null, button: 'accent' },
  })
  assert.deepEqual(Object.keys(f.ask.look.kiosk.colours), PROMPT_COLOUR_KEYS)
  assert.equal(f.ask.look.online.dishes, 'cards')
  assert.ok(hasOwnLook(f, 'kiosk') && hasOwnLook(f, 'online') && !hasOwnLook(f, 'till'))
  // Normalising again changes nothing; ownFlow() keeps the look.
  assert.deepEqual(normaliseOrderFlow(f), f)
  assert.deepEqual(ownFlow(f, { items: new Set([COKE, WATER]) }).ask.look, f.ask.look)
  // The look never stops a flow being saved.
  assert.deepEqual(flowProblems(f), [])
  // An add flow has no prompt, so no look.
  const add = normaliseOrderFlow({ id: uuid(), name: 'Bag', kind: 'add', ask: { look: { kiosk: { pictures: false } } } })
  assert.equal(add.ask, null)
})

test('colours and pictures: theme colours, codes, nothing else', () => {
  assert.equal(promptColour('muted'), 'muted')
  assert.equal(promptColour('#A1B2C3'), '#a1b2c3')
  for (const bad of ['border', 'red', '#abc', '#abcdefg', 12, null, undefined, 'transparent']) assert.equal(promptColour(bad), null, String(bad))
  assert.equal(promptPicture('/uploads/x/media/a b.jpg'), null, 'a space could end url()')
  assert.equal(promptPicture('/uploads/x/media/ab.jpg'), '/uploads/x/media/ab.jpg')
  assert.equal(promptPicture('https://bucket.s3.eu-west-2.amazonaws.com/t/media/ab.webp'), 'https://bucket.s3.eu-west-2.amazonaws.com/t/media/ab.webp')
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', '//evil.example/a.png', '/a.png")', "/a'.png", 'ftp://x/a.png', '/' + 'a'.repeat(700)]) {
    assert.equal(promptPicture(bad), null, bad)
  }
  assert.equal(normalisePromptPart({ background: { image_url: 'javascript:alert(1)' } }, 'till'), null, 'a refused picture leaves the standard look')
})

test('words on a colour come from the theme, else black or white', () => {
  assert.equal(promptInk('#0b6b3a', KIOSK_THEME), '#fbf8f2', 'the page colour reads on the main colour')
  assert.equal(promptInk('#ffc72c', KIOSK_THEME), '#1b1b1b', 'the text colour reads on the accent')
  // A theme whose text and page colours both read badly on the colour: black or white.
  assert.equal(promptInk('#777777', { text: '#808080', background: '#707070' }), '#000000')
  assert.equal(promptInk('#202020', { text: '#303030', background: '#404040' }), '#ffffff')
  assert.equal(promptInk('#ffffff', {}), '#000000', 'no theme at all')
  assert.equal(promptInk('primary', KIOSK_THEME), null, 'only a code')
  assert.ok(colourContrast('#000000', '#ffffff') > 20)
})

test('a look as colours to draw with, against each channel\'s theme', () => {
  const f = ask({
    kiosk: { header: { style: 'band' }, colours: { window: 'background', cards: 'accent', button: '#222222' } },
    online: { colours: { window: '#0f172a', title: 'accent' } },
    till: { header: { style: 'picture', image_url: '/uploads/t/media/head.jpg' }, pictures: true, colours: { header: 'accent' } },
  })
  const k = promptStyle(f, 'kiosk', KIOSK_THEME)
  assert.equal(k.window, '#fbf8f2')
  assert.equal(k.band, '#0b6b3a', 'a band with no colour of its own takes the main colour')
  assert.equal(k.title, '#fbf8f2', 'the title reads on the band')
  assert.equal(k.message, '#fbf8f2', 'the line under it is in the band too')
  assert.equal(k.text, '#1b1b1b', 'words on the window read on it')
  assert.deepEqual([k.cards, k.cards_ink], ['#ffc72c', '#1b1b1b'])
  assert.deepEqual([k.button, k.button_ink], ['#222222', '#fbf8f2'])
  assert.equal(k.own, true)
  // The same role follows the theme it is drawn with: a brand theme on the till.
  const o = promptStyle(f, 'online', BRAND)
  assert.equal(o.window, '#0f172a')
  assert.equal(o.title, '#f4a7b9', 'a title colour set wins')
  assert.equal(o.text, '#ffffff', 'words on a dark window: the page colour')
  assert.equal(o.band, null)
  const t = promptStyle(f, 'till', BRAND)
  assert.equal(t.header.picture, '/uploads/t/media/head.jpg')
  assert.equal(t.band, null, 'a band colour only means something on a band')
  assert.equal(t.title, null, 'standard colours stay the channel\'s own')
  assert.equal(t.pictures, true)
  // A plain header keeps its picture for later but doesn't draw it.
  const plain = ask({ till: { header: { style: 'plain', image_url: '/uploads/t/media/head.jpg' } } })
  assert.equal(plain.ask.look.till.header.image_url, '/uploads/t/media/head.jpg')
  assert.equal(promptStyle(plain, 'till', BRAND).header.picture, null)
  // A see-through kiosk Cards colour falls back to the page.
  const clear = ask({ kiosk: { colours: { window: 'surface' } } })
  assert.equal(promptStyle(clear, 'kiosk', { ...KIOSK_THEME, surface: 'transparent' }).window, '#fbf8f2')
  // No theme: a role can't be drawn, so the channel's standard colour stays.
  assert.equal(promptStyle(clear, 'kiosk', {}).window, null)
  // A flow with no look: everything standard.
  const none = promptStyle(ask(undefined), 'online', BRAND)
  assert.deepEqual([none.window, none.title, none.text, none.cards, none.button, none.own], [null, null, null, null, null, false])
})
