// shared/nav/pepper.js: the Pepper area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/new-location', label: 'New venue', icon: 'Store', module: 'venues',
    section: 'Venues', parent: '/venues', order: 10, catalogOrder: 750,
    keywords: 'new venue location restaurant opening wizard store setup pepper',
    description: "Set up a new venue step by step: details, brand, menu, opening hours, tables and the rest, with Pepper's help if you like.",
  },
  {
    path: '/ai', label: 'Pepper', icon: 'Sparkles', module: 'ai_assistant',
    section: 'Home', order: 60, catalogOrder: 840,
    keywords: 'pepper ai assistant chat connect tokens activity usage mcp claude',
    description: 'Chat with Pepper, the assistant: ask about bookings, the rota, cash, menus and more, connect other AI apps and see what Pepper did.',
  },
]
