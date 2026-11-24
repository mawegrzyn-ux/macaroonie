// One listening's rules (speechCore.js): joining continuous listening's
// pieces, the Android errors that are never shown, and when continuous
// listening is dropped for the rest of the app's run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession, QUIET_ERRORS } from '../speechCore.js'

test('continuous: each pause\'s words are kept and the new ones added after them', () => {
  const s = createSession({ continuous: true })
  assert.equal(s.text('hey', false), 'hey')
  assert.equal(s.text('hey ho', true), 'hey ho')
  assert.equal(s.text('let\'s', false), 'hey ho let\'s')
  assert.equal(s.text('let\'s go', true), 'hey ho let\'s go')
  assert.equal(s.text('', false), 'hey ho let\'s go')
})

test('an iPhone: each result holds every word so far, continuous or not, so nothing is joined', () => {
  const s = createSession({ continuous: true, cumulative: true })
  assert.equal(s.text('fridge', false), 'fridge')
  assert.equal(s.text('fridge four', true), 'fridge four')
  assert.equal(s.text('fridge four degrees', false), 'fridge four degrees', 'not "fridge four fridge four degrees"')
})

test('the ordinary way: each result already holds every word', () => {
  const s = createSession()
  assert.equal(s.text('hey', false), 'hey')
  assert.equal(s.text('hey ho', true), 'hey ho')
  assert.equal(s.text(' hey ho ', true), 'hey ho')
})

test('Android\'s endings that mean "nothing more" are never shown; real failures are', () => {
  const s = createSession()
  for (const code of ['client', 'no-speech', 'speech-timeout', 'aborted']) assert.equal(s.error(code), false, code)
  for (const code of ['network', 'not-allowed', 'audio-capture', 'busy']) assert.equal(s.error(code), true, code)
  assert.ok(QUIET_ERRORS.has('client'))
})

test('continuous listening is dropped only when it fails before the page asks it to stop', () => {
  const asked = createSession({ continuous: true })
  asked.stop(); asked.error('client')
  assert.equal(asked.end(), false, 'stopped by the page: fine')

  const quiet = createSession({ continuous: true })
  assert.equal(quiet.end(), false, 'no error: fine')

  const refused = createSession({ continuous: true })
  refused.error('client')
  assert.equal(refused.end(), true, 'ended on its own with an error: the phone can\'t')

  const ordinary = createSession()
  ordinary.error('network')
  assert.equal(ordinary.end(), false, 'not continuous: nothing to drop')
})
