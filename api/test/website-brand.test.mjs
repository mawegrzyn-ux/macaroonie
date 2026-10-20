// Saving the group's Brand identity and Brand & theme once a location has
// website settings. Both saves used to blank the template on every
// location's website_config, a NOT NULL column, so they failed with a 500,
// and they stripped colours and fonts from locations with their own brand.
import test from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, PLATFORM } from './support/seed.mjs'

let ids, owner, ware, hertford

const OWN_THEME = {
  colors: { primary: '#123456', background: '#fefefe' },
  typography: { heading_font: 'Fraunces', body_font: 'Inter' },
}

test.before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  ware = await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))
  hertford = await ok(owner.post('/api/venues', { name: 'Hertford', slug: 'hertford', timezone: 'Europe/London' }))
  await ok(owner.post('/api/website/config', { venue_id: ware.id }))
  await ok(owner.post('/api/website/config', { venue_id: hertford.id }))
  // Hertford has its own Brand & theme.
  await ok(owner.patch(`/api/website/config?venue_id=${hertford.id}`, {
    use_brand_override: true, template_key: 'modern', font_family: 'Fraunces', theme: OWN_THEME,
  }))
})
test.after(closeApp)

test('Brand identity saves with the template and font', async () => {
  const saved = await ok(owner.patch('/api/website/brand-defaults', {
    brand_name: null, site_name: 'Thai House', tagline: 'Delicious', logo_url: '/uploads/logo.png',
    favicon_url: null, primary_colour: '#630812', secondary_colour: null,
    font_family: 'Space Grotesk', template_key: 'modern', og_image_url: null,
  }), 'brand identity save')
  assert.equal(saved.template_key, 'modern')
  assert.equal(saved.font_family, 'Space Grotesk')
})

test('Brand & theme saves with the template', async () => {
  const saved = await ok(owner.patch('/api/website/tenant-site', {
    template_key: 'classic',
    theme: { colors: { primary: '#aa0000', background: '#ffffff' }, typography: { heading_font: 'Space Grotesk', body_font: 'Inter' } },
  }), 'theme save')
  assert.equal(saved.template_key, 'classic')
  assert.equal(saved.theme.colors.primary, '#aa0000')
})

test('Brand & theme saves the theme alone', async () => {
  const saved = await ok(owner.patch('/api/website/tenant-site', {
    theme: { colors: { primary: '#bb0000', background: '#ffffff' } },
  }), 'theme only save')
  assert.equal(saved.theme.colors.primary, '#bb0000')
})

test('a platform admin saves a group they are not a member of', async () => {
  const pa = as(PLATFORM, ids.a)
  await ok(pa.patch('/api/website/brand-defaults', { site_name: 'From the platform', template_key: 'classic' }), 'platform save')
})

test("a location's own brand is untouched by the group's saves", async () => {
  const [h] = await sql`SELECT template_key, font_family, theme FROM website_config WHERE venue_id = ${hertford.id}`
  assert.equal(h.template_key, 'modern')
  assert.equal(h.font_family, 'Fraunces')
  assert.deepEqual(h.theme.colors, OWN_THEME.colors)
  assert.deepEqual(h.theme.typography, OWN_THEME.typography)
})
