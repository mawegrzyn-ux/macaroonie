// shared/registry/website.js: the Website area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'website.site', label: 'Website', plural: 'Websites', words: ['site', 'banner', 'web page', 'media'],
    table: 'website_pages', subjects: ['website.pages', 'website.media', 'website.media_categories'],
    page: '/website',
    actions: ['publish_website', 'set_website_banner'],
  },
  {
    key: 'website.reviews', label: 'Review', plural: 'Reviews', words: ['rating', 'google review'],
    table: 'reviews', subjects: ['website.reviews'],
    page: '/reviews',
    actions: ['record_reviews', 'moderate_review'],
  },
]
