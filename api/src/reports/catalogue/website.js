// src/reports/catalogue/website.js
//
// The website and what guests say about the group (docs/REPORTS.md 20,
// phase 3d): reviews, the website's own pages and modals, and the Media
// library. All need the Website module, as their pages do.
//
// Reviews are as the Reviews page holds them: each from a review site
// (fetched, recorded from the site's page, imported or added by hand), with
// its stars, whether it is on the website and whether someone has checked
// it (the To check inbox). A review not tied to a location shows only with
// every venue picked.
//
// Pages are the draft the Pages & modals page edits; the live site shows the
// pages as they were last published. A page's address is worked out the way
// the site works it out (shared/sitePages.js pagePath()).

import { subject, text, number, yesno, choice, moment, count, avg, ratio, sum, one, many } from './define.js'
import { SYSTEM_PAGES } from '../../../../shared/sitePages.js'

const SITES = { google: 'Google', tripadvisor: 'TripAdvisor', justeat: 'Just Eat', deliveroo: 'Deliveroo', glovo: 'Glovo', manual: 'Added by hand' }
const SOURCES = { scraped: 'Fetched by the scraper', recorded: 'Recorded from the site\'s page', csv: 'Imported from a file', manual: 'Added by hand' }

const REPLIED = "(COALESCE(btrim({t}.reply_text), '') <> '')"
const CHECKED = '({t}.checked_at IS NOT NULL)'

// The built-in pages' addresses, from the one list (keys and paths are that
// file's own constants, so they can be written into the SQL as they are).
const SYSTEM_PATH = '(CASE {t}.system_key ' + Object.entries(SYSTEM_PAGES)
  .map(([key, p]) => "WHEN '" + key + "' THEN '" + p.path + "'").join(' ') + ' END)'
const ADDRESS = `(CASE WHEN {t}.kind = 'modal' THEN '#modal/' || {t}.slug
   WHEN {t}.system_key IS NOT NULL THEN ${SYSTEM_PATH}
   WHEN {t}.venue_id IS NOT NULL THEN '/locations/' || (SELECT v.slug FROM venues v WHERE v.id = {t}.venue_id AND v.tenant_id = {t}.tenant_id) || '/p/' || {t}.slug
   ELSE '/p/' || {t}.slug END)`
const BUILT_IN = Object.fromEntries(Object.entries(SYSTEM_PAGES).map(([key, p]) => [key, p.title]))

const KIND_OF_FILE = `(CASE WHEN {t}.mimetype LIKE 'image/%' THEN 'picture'
   WHEN {t}.mimetype LIKE 'video/%' THEN 'video'
   WHEN {t}.mimetype = 'application/pdf' THEN 'pdf' ELSE 'other' END)`
const FILE_KINDS = { picture: 'Picture', video: 'Video', pdf: 'PDF', other: 'Other' }
const MB = '({t}.bytes / 1048576.0)'

export default [
  subject({
    key: 'website.reviews',
    label: 'Reviews',
    one: 'review',
    area: 'website',
    module: 'website',
    about: 'Reviews of the group\'s venues as the Reviews page holds them: from Google, TripAdvisor, Just Eat, Deliveroo and Glovo, or added by hand, with their stars, whether they are on the website and whether someone has checked them. A review not tied to a location shows only with every venue picked.',
    from: 'reviews',
    name: 'reviewer',
    venue: 'venue_id',
    date: { sql: '(COALESCE({t}.review_date, {t}.created_at) AT TIME ZONE {tz})::date', label: 'Day written', about: 'The day the review was written, as the site shows it; when that isn\'t known, the day it reached us.' },
    fields: {
      site: choice('platform', SITES, { label: 'Site' }),
      came_from: choice('source', SOURCES, { label: 'How it came in' }),
      reviewer: text('reviewer_name', { label: 'Reviewer', pii: true }),
      rating: number('rating', { label: 'Stars', decimals: 0 }),
      review: text('review_text', { label: 'Review' }),
      reply: text('reply_text', { label: 'Reply' }),
      replied: yesno({ sql: REPLIED }, { label: 'Replied to' }),
      on_website: yesno('is_approved', { label: 'On the website' }),
      featured: yesno('is_featured', { label: 'Featured' }),
      checked: yesno({ sql: CHECKED }, { label: 'Checked', about: 'Someone decided whether it goes on the website. One not checked yet is in the To check inbox.' }),
      checked_at: moment('checked_at', { label: 'Checked on' }),
      checked_by: text('checked_by', { label: 'Checked by', pii: true }),
      written_at: moment('review_date', { label: 'Written' }),
      came_in_at: moment('created_at', { label: 'Reached us' }),
    },
    measures: {
      reviews: count({ label: 'Reviews' }),
      average_rating: avg('rating', { label: 'Average stars', decimals: 1, about: 'The average of the reviews\' stars; reviews without stars aren\'t counted. As on the Reviews page.' }),
      five_stars: count({ label: 'Five-star reviews', where: '{t}.rating = 5' }),
      low_ratings: count({ label: 'Reviews of 1 or 2 stars', where: '{t}.rating <= 2' }),
      shown_on_website: count({ label: 'On the website', where: '{t}.is_approved' }),
      featured_reviews: count({ label: 'Featured', where: '{t}.is_featured' }),
      to_check: count({ label: 'To check', where: 'NOT ' + CHECKED, about: 'Reviews nobody has decided on yet: the To check inbox.' }),
      replied_to: count({ label: 'Replied to', where: REPLIED }),
      reply_rate: ratio('replied_to', 'reviews', { type: 'percent', label: 'Share replied to' }),
    },
    list: ['written_at', 'site', 'venue.name', 'rating', 'reviewer', 'review', 'on_website'],
    sort: [{ by: 'written_at', dir: 'desc' }],
    // The review site's own id (the duplicate check), the reviewer's picture
    // and what the scraper brought.
    skip: ['external_id', 'reviewer_photo_url', 'raw_data', 'updated_at'],
  }),

  subject({
    key: 'website.pages',
    label: 'Website pages',
    one: 'page',
    area: 'website',
    module: 'website',
    about: 'The pages and modals on Website, Pages & modals: the group\'s own and each location\'s, as they are being edited. The live site shows them as they were last published. A location\'s pages show only with that venue (or every venue) picked; the group\'s own only with every venue.',
    from: 'website_pages',
    name: 'title',
    venue: 'venue_id',
    fields: {
      title: text('title', { label: 'Title' }),
      slug: text('slug', { label: 'Web address name' }),
      address: text({ sql: ADDRESS }, { label: 'Address', about: 'Where it is on the site: /p/ and its name, a location\'s pages under /locations/, the built-in pages at their own address, and a modal opened by #modal/ and its name.' }),
      kind: choice('kind', { page: 'Standalone page', modal: 'Modal overlay' }, { label: 'Opens as' }),
      built_in: choice('system_key', BUILT_IN, { label: 'Built-in page', empty: 'Your own' }),
      published: yesno('is_published', { label: 'Published' }),
      legal: yesno('is_legal', { label: 'Legal page' }),
      shows_header: yesno('show_header', { label: 'Shows the header' }),
      shows_footer: yesno('show_footer', { label: 'Shows the footer' }),
      blocks: number({ sql: "(CASE WHEN jsonb_typeof({t}.blocks) = 'array' THEN jsonb_array_length({t}.blocks) ELSE 0 END)" }, { label: 'Blocks', decimals: 0, about: 'Blocks on the page itself; blocks inside columns or tabs aren\'t counted.' }),
      made_at: moment('created_at', { label: 'Made' }),
      changed_at: moment('updated_at', { label: 'Last changed' }),
    },
    measures: {
      pages: count({ label: 'Pages and modals' }),
      standalone: count({ label: 'Pages', where: "{t}.kind = 'page'" }),
      modals: count({ label: 'Modals', where: "{t}.kind = 'modal'" }),
      published_pages: count({ label: 'Published', where: '{t}.is_published' }),
    },
    list: ['title', 'address', 'kind', 'published', 'changed_at'],
    sort: [{ by: 'title', dir: 'asc' }],
    // The old text-only page body and the place on the Pages list.
    skip: ['content', 'sort_order'],
  }),

  subject({
    key: 'website.media',
    label: 'Media library files',
    one: 'file',
    area: 'website',
    module: 'website',
    about: 'The pictures, videos and PDFs in the Media library, shared by the website, menus, menu screens, kiosks and the rest.',
    from: 'media_items',
    name: 'filename',
    fields: {
      filename: text('filename', { label: 'File name' }),
      kind: choice({ sql: KIND_OF_FILE }, FILE_KINDS, { label: 'Kind of file' }),
      file_type: text('mimetype', { label: 'File type' }),
      scope: text('scope', { label: 'Scope', about: 'Where in the app it was added: shared for everything, else the page it belongs to.' }),
      size_mb: number({ sql: MB }, { label: 'Size (MB)', decimals: 1, adds: true }),
      width: number('width', { label: 'Width (px)', decimals: 0 }),
      height: number('height', { label: 'Height (px)', decimals: 0 }),
      added_at: moment('created_at', { label: 'Added' }),
    },
    measures: {
      files: count({ label: 'Files' }),
      total_mb: sum({ sql: MB }, { label: 'Total size (MB)', decimals: 1 }),
      pictures: count({ label: 'Pictures', where: "{t}.mimetype LIKE 'image/%'" }),
      videos: count({ label: 'Videos', where: "{t}.mimetype LIKE 'video/%'" }),
    },
    links: {
      category: one('website.media_categories', 'category_id', { label: 'Category' }),
    },
    list: ['filename', 'kind', 'category.name', 'size_mb', 'added_at'],
    sort: [{ by: 'added_at', dir: 'desc' }],
    // Where the file is kept and its fingerprint (the duplicate check).
    skip: ['url', 'storage_key', 'hash', 'updated_at'],
  }),

  subject({
    key: 'website.media_categories',
    label: 'Media library categories',
    one: 'category',
    area: 'website',
    module: 'website',
    about: 'The categories the Media library sorts its files into.',
    from: 'media_categories',
    name: 'name',
    fields: {
      name: text('name'),
      made_at: moment('created_at', { label: 'Made' }),
    },
    measures: {
      categories: count({ label: 'Categories' }),
    },
    links: {
      files: many('website.media', 'category_id', { label: 'Files' }),
    },
    list: ['name'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['sort_order', 'updated_at'],
  }),
]
