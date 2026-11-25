// src/demo/kiosk/pictures.js
//
// The kiosk designer demo's built-in pictures (img/*.svg, drawn for it: no
// stock photos, no real brands), offered by the demo's media picker and used
// by the demo menu (demoData.json names them /demo-img/<file>). Built as
// files of their own (vite.demo.config.js keeps them out of the bundle), so a
// design keeps short addresses.

const FILES = import.meta.glob('./img/*.svg', { eager: true, query: '?url', import: 'default' })

// Names, sizes and kinds for the picker; the file name is the key.
const INFO = {
  burger: ['Burger', 600, 600], cheeseburger: ['Cheeseburger', 600, 600], 'chicken-burger': ['Chicken burger', 600, 600],
  fries: ['Fries', 600, 600], 'sweet-potato-fries': ['Sweet potato fries', 600, 600], 'onion-rings': ['Onion rings', 600, 600],
  salad: ['Salad', 600, 600], wrap: ['Wrap', 600, 600], nuggets: ['Nuggets', 600, 600], cola: ['Cola', 600, 600],
  lemonade: ['Lemonade', 600, 600], milkshake: ['Milkshake', 600, 600], coffee: ['Coffee', 600, 600],
  brownie: ['Brownie', 600, 600], 'ice-cream': ['Ice cream', 600, 600], 'combo-meal': ['Meal deal', 600, 600],
  'hero-harbour': ['Start screen: the harbour', 1080, 1920], 'hero-burger': ['Start screen: burger', 1080, 1920],
  'banner-meal': ['Banner: meal deal', 1600, 700], 'banner-shakes': ['Banner: shakes', 1600, 700],
  logo: ['Harbour & Co logo', 400, 400],
}

const byName = {}
for (const [file, url] of Object.entries(FILES)) byName[file.slice(6, -4)] = url

/** '/demo-img/burger.svg' -> the built picture's address (unknown names stay as they are). */
export function pictureUrl(path) {
  const name = path.replace(/^\/demo-img\//, '').replace(/\.svg$/, '')
  return byName[name] || path
}

const CREATED = '2026-11-25T09:00:00.000Z'

/** The built-in set as media library items. */
export const BUILT_IN = Object.entries(INFO).filter(([name]) => byName[name]).map(([name, [label, width, height]]) => ({
  id: 'built-in-' + name, filename: label + '.svg', url: byName[name], mimetype: 'image/svg+xml', kind: 'image',
  width, height, bytes: null, scope: 'kiosk', category_id: null, category_name: null, created_at: CREATED, built_in: true,
}))
