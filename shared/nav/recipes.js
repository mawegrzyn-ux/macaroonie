// shared/nav/recipes.js: the Recipes area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/recipes', label: 'Recipes', icon: 'ChefHat', module: 'recipes',
    section: 'Stock', order: 20, catalogOrder: 165,
    keywords: 'recipes recipe book prep batch sub-recipe ingredients method dish cost plate cost food cost costing portion yield gp margin',
    description: 'What goes into each dish and prep batch, the method and photo, and what each costs at every venue\'s supplier prices, with what is not costed yet.',
  },
  {
    path: '/menu-margins', label: 'Menu margins', icon: 'BadgePercent', module: 'costing',
    section: 'Stock', order: 30, catalogOrder: 167,
    keywords: 'menu margins margin gp gross profit cost percent cost percentage food cost plate cost dish cost target threshold vat net price meal deal options sold dishes sold theoretical cost theoretical food cost menu engineering stars dogs plough horse puzzle scenario what if price change push prices',
    description: 'Every dish on a menu with its price net of VAT, what it costs, its gross profit and cost %, coloured against your targets, at a venue and order type; what really sold, with its theoretical cost and GP; menu engineering (stars, plough-horses, puzzles and dogs); and scenarios that try price and cost changes and push new prices into a menu\'s draft.',
    accepts: ['tab'], tabs: ['margins', 'sold', 'engineering', 'scenarios'],
  },
]
