// shared/nav/website.js: the Website area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/brand', label: 'Brand & theme', icon: 'Palette', module: 'website',
    section: 'Brand & web', order: 10, catalogOrder: 550,
    keywords: 'brand theme colours fonts logo identity look palette tagline theme maker',
    description: 'Your brand: name, logo, colours and fonts, with a theme maker. Used by the website, kiosks, menu screens and printed menus.',
  },
  {
    path: '/website', label: 'Website', icon: 'Globe', module: 'website',
    section: 'Brand & web', order: 20, catalogOrder: 560,
    keywords: 'website site settings pages publish staging domain seo banner header footer gallery opening hours',
    description: "The website's settings: header, footer, domain, SEO, opening hours, gallery, banner and publishing.",
  },
  {
    path: '/website/builder', label: 'Page builder', icon: 'Blocks', module: 'website',
    section: 'Brand & web', order: 30, catalogOrder: 570,
    keywords: 'page builder website designer page designer pages blocks home page location pages modals pop ups layout',
    description: "Build website pages from blocks: the home page, extra pages and pop-ups, and each location's page.",
  },
  {
    path: '/website/reservations-widget', label: 'Reservations widget', icon: 'CalendarCheck', module: 'website',
    section: 'Brand & web', order: 40, catalogOrder: 580,
    keywords: 'reservations booking widget designer look colours fonts calendar embed confirmation',
    description: 'Design the booking widget on your website: colours, fonts, the calendar, its words and the confirmation page.',
  },
  {
    path: '/media', label: 'Media', icon: 'FolderOpen', module: 'website',
    section: 'Brand & web', order: 50, catalogOrder: 720,
    keywords: 'media library pictures photos images videos uploads files folders',
    description: 'The media library: pictures, videos and files for the website, menus, kiosks and screens, in folders.',
  },
  {
    path: '/reviews', label: 'Reviews', icon: 'MessageSquare', module: 'website',
    section: 'Brand & web', order: 60, catalogOrder: 730,
    keywords: 'reviews google tripadvisor ratings feedback stars approve record check inbox website',
    description: 'Customer reviews from Google and other sites: check new ones and choose which show on the website.',
  },
]
