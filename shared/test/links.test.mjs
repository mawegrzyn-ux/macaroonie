import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webLink, typedLink } from '../links.js'

test('webLink: only http and https addresses can be opened', () => {
  assert.equal(webLink('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(webLink('  http://example.com  '), 'http://example.com')
  assert.equal(webLink('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM')
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,hi', 'ftp://x.y', '//x.y', 'https://a b', 'https://', '', null, undefined]) {
    assert.equal(webLink(bad), null, String(bad))
  }
})

test('typedLink: what an editor stores for a link typed in', () => {
  assert.equal(typedLink('https://example.com/a'), 'https://example.com/a')
  assert.equal(typedLink('  example.com/menu?x=1 '), 'https://example.com/menu?x=1', 'a bare address gets https://')
  assert.equal(typedLink('www.thai-house.co.uk'), 'https://www.thai-house.co.uk')
  assert.equal(typedLink('mailto:hello@example.com'), 'mailto:hello@example.com')
  assert.equal(typedLink('tel:+441234567890'), 'tel:+441234567890')
  assert.equal(typedLink('/menu'), '/menu', 'a page of the site')
  assert.equal(typedLink('{{manage_link}}'), null, 'a placeholder only where asked')
  assert.equal(typedLink('{{ manage_link }}', { tokens: true }), '{{manage_link}}', 'stored tidied')
  assert.equal(typedLink('/menu', { paths: false }), null)
  assert.equal(typedLink('mailto:a@b.c', { mail: false }), null)
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '//evil.com', 'two words.com', 'notalink', 'ftp://x.y', 'mailto://x', '', null, '{{bad token}}']) {
    assert.equal(typedLink(bad, { tokens: true }), null, String(bad))
  }
})

