// shared/sitePages.js
//
// The website's built-in pages (website_pages.system_key): pages the
// operator designs in Website -> Pages & modals like any other, but which
// live at a fixed address, can't be deleted, unpublished or made a modal.
//   order    /order    the Online ordering block (migration 126)
//   loyalty  /loyalty  the Loyalty card block (migration 214)
// Used by the API (site routes, sitemap, llms.txt) and the admin (page list,
// link picker), so a page's address is worked out in one place.

export const SYSTEM_PAGES = Object.freeze({
  order:   Object.freeze({ path: '/order',   label: 'Ordering', title: 'Order online', what: 'the ordering page' }),
  loyalty: Object.freeze({ path: '/loyalty', label: 'Loyalty',  title: 'Loyalty',      what: 'the loyalty page' }),
})

export const SYSTEM_PAGE_KEYS = Object.freeze(Object.keys(SYSTEM_PAGES))

/** A tenant-level page's address on the site: /order, /loyalty or /p/<slug>. */
export function pagePath(p, anchor) {
  const sys = p && p.system_key ? SYSTEM_PAGES[p.system_key] : null
  const base = sys ? sys.path : '/p/' + (p && p.slug)
  return anchor ? base + '#' + anchor : base
}
