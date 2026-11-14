import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webLink } from '../links.js'

test('webLink: only http and https addresses can be opened', () => {
  assert.equal(webLink('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(webLink('  http://example.com  '), 'http://example.com')
  assert.equal(webLink('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM')
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,hi', 'ftp://x.y', '//x.y', 'https://a b', 'https://', '', null, undefined]) {
    assert.equal(webLink(bad), null, String(bad))
  }
})
