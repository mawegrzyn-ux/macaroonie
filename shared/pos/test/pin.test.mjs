// Staff PINs (shared/pos/pin.js): hashing and the PINs that can't sit
// beside each other at a venue.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPin, pinOverlaps, weakPin } from '../pin.js'

test('a PIN is hashed digit for digit: a leading 0 counts', async () => {
  const a = await hashPin('0482', 'salt')
  const b = await hashPin('0482', 'salt')
  assert.equal(a, b)
  assert.notEqual(a, await hashPin('4820', 'salt'))
  assert.notEqual(a, await hashPin('0482', 'other salt'))
  await assert.rejects(() => hashPin('482', 'salt'), /4 to 6 digits/)
  await assert.rejects(() => hashPin('1234567', 'salt'), /4 to 6 digits/)
})

test('pinOverlaps: a PIN\'s shorter starts and every longer PIN starting with it', () => {
  const four = pinOverlaps('1234')
  assert.equal(four.length, 110)
  assert.ok(four.includes('12340') && four.includes('12349'))
  assert.ok(four.includes('123400') && four.includes('123499'))
  assert.ok(!four.includes('1234'), 'not the PIN itself')
  assert.ok(four.every(p => p.startsWith('1234') && p.length >= 5 && p.length <= 6))
  assert.equal(new Set(four).size, four.length, 'no repeats')

  const five = pinOverlaps('12345')
  assert.deepEqual(five, ['1234', ...Array.from({ length: 10 }, (_, d) => '12345' + d)])

  assert.deepEqual(pinOverlaps('123456'), ['1234', '12345'])

  const zero = pinOverlaps('0482')
  assert.ok(zero.includes('04820') && zero.includes('048299'), 'a leading 0 stays')

  assert.deepEqual(pinOverlaps('12'), [])
  assert.deepEqual(pinOverlaps('12a4'), [])
  assert.deepEqual(pinOverlaps(''), [])
})

test('weak PINs', () => {
  assert.ok(weakPin('1111'))
  assert.ok(weakPin('1234'))
  assert.ok(weakPin('987654'))
  assert.equal(weakPin('0482'), null)
  assert.equal(weakPin('573912'), null)
})
