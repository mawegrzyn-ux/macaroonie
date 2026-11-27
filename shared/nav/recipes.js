// shared/nav/recipes.js: the Recipes area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/recipes', label: 'Recipes', icon: 'ChefHat', module: 'recipes',
    section: 'Stock', order: 20, catalogOrder: 165,
    keywords: 'recipes recipe book prep batch sub-recipe ingredients method dish cost plate cost food cost costing portion yield gp margin allergen allergens allergen check may contain declared allergens',
    description: 'What goes into each dish and prep batch, the method and photo, what each costs at every venue\'s supplier prices, and where a dish\'s declared allergens differ from its recipes.',
    accepts: ['tab'], tabs: ['recipes', 'dishes', 'options', 'allergens'],
  },
  {
    path: '/menu-margins', label: 'Menu margins', icon: 'BadgePercent', module: 'costing',
    section: 'Stock', order: 30, catalogOrder: 167,
    keywords: 'menu margins margin gp gross profit cost percent cost percentage food cost plate cost dish cost target threshold vat net price meal deal options sold dishes sold theoretical cost theoretical food cost menu engineering stars dogs plough horse puzzle scenario what if price change push prices price creep cost creep price rise cost alert',
    description: 'Each dish\'s price net of VAT, cost, GP and cost % against your targets; what really sold; menu engineering; what-if scenarios that push new prices into a menu\'s draft; and the dishes a supplier price rise took over target.',
    accepts: ['tab'], tabs: ['margins', 'sold', 'engineering', 'scenarios'],
  },
]
