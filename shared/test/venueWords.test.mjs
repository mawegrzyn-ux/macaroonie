// The venue's own words for speech (shared/venueWords.js, Pepper-first step 6c).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapToWords, venueWordList, firstNameOf, MAX_WORDS } from '../venueWords.js'

const WORDS = ['Walk-in fridge', 'Fresh Co', 'Fresh Cod', 'Bain marie', 'Pad Thai', 'Chicken satay', 'Siobhan', 'Sam', 'Brakes', 'Display chiller']
const snap = t => snapToWords(t, WORDS).text

test('a near miss of a venue word becomes the word', () => {
  assert.equal(snap('walking fridge four degrees'), 'Walk-in fridge four degrees')
  assert.equal(snap('the walking fridge is at 4'), 'the Walk-in fridge is at 4')
  assert.equal(snap('chicken satey hot hold 68'), 'Chicken satay hot hold 68')
  assert.equal(snap('display chiller ok'), 'display chiller ok', 'heard right, only the case differs: left as said')
  assert.equal(snap('walk in fridge 3'), 'Walk-in fridge 3', 'spaces and hyphens: the venue\'s spelling')
  const r = snapToWords('walking fridge 5', WORDS)
  assert.deepEqual(r.changes, [{ from: 'walking fridge', to: 'Walk-in fridge' }])
})

test('a venue word heard right stays, and never becomes a neighbour', () => {
  assert.equal(snap('Fresh Co delivered two boxes short'), 'Fresh Co delivered two boxes short')
  assert.equal(snap('fresh co were late'), 'fresh co were late')
  assert.equal(snap('one Fresh Cod sold out'), 'one Fresh Cod sold out')
})

test('numbers are never touched: measured values stay as they were said', () => {
  assert.equal(snap('walking fridge minus eighteen'), 'Walk-in fridge minus eighteen')
  assert.equal(snap('fridge 4.5 then 14'), 'fridge 4.5 then 14')
  assert.equal(snap('four fourteen forty'), 'four fourteen forty')
  // A window holding a number is never replaced, even when it would be close.
  assert.equal(snapToWords('fridge 2 at 3', ['Fridge 1']).text, 'fridge 2 at 3')
  assert.equal(snapToWords('fridge to at 3', ['Fridge two']).text, 'fridge to at 3', 'number words in the venue word are left too')
})

test('short words match exactly only, so everyday words stay', () => {
  assert.equal(snap('I will check the pass'), 'I will check the pass')
  assert.equal(snap('same again'), 'same again', 'not Sam')
  assert.equal(snap('brake the box'), 'brake the box', 'Brakes is too short to guess at')
  assert.equal(snap('Siobhan logged it'), 'Siobhan logged it')
  assert.equal(snap('bane marie hot'), 'Bain marie hot')
})

test('nothing to snap to, or nothing said', () => {
  assert.deepEqual(snapToWords('', WORDS), { text: '', changes: [] })
  assert.deepEqual(snapToWords('walking fridge', []), { text: 'walking fridge', changes: [] })
  assert.equal(snapToWords(null, WORDS).text, '')
})

test('the word list: cleaned, each once, capped, groups in order', () => {
  const list = venueWordList([['  Walk-in   fridge ', 'walk-in fridge', ''], ['Pad Thai', '12', 'x'.repeat(80)], ['Jo']])
  assert.deepEqual(list, ['Walk-in fridge', 'Pad Thai', 'Jo'])
  const many = venueWordList([Array.from({ length: 500 }, (_, i) => 'Dish ' + i)])
  assert.equal(many.length, MAX_WORDS)
  assert.equal(firstNameOf('Jo Bloggs'), 'Jo')
  assert.equal(firstNameOf(''), '')
})
