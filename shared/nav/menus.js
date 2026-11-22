// shared/nav/menus.js: the Menus area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/allergens', label: 'Allergens', icon: 'Wheat', module: 'allergens',
    section: 'Service', order: 60, catalogOrder: 110,
    keywords: 'allergen allergy allergies lookup free from gluten dairy nuts peanuts vegan vegetarian dietary guest question dish contains',
    description: "Answer a guest's allergy question: find a dish's allergens, or the dishes free from one, on the menus guests are served.",
  },
  {
    path: '/menus', label: 'Menus', icon: 'ChefHat', module: 'menus',
    section: 'Menus', order: 10, catalogOrder: 590,
    keywords: 'menus dishes prices sections categories options photos edit publish meal deals',
    description: 'Menus, sections and dishes: prices, photos, options, allergens and meal deals, saved as a draft and published when ready.',
  },
  {
    path: '/menus/times', label: 'Menu times', icon: 'Clock', module: 'menus',
    section: 'Menus', parent: '/menus', order: 10, catalogOrder: 600,
    keywords: 'menu times schedules lunch dinner breakfast when menus show channels kiosks tills',
    description: 'When each menu is on: its days and times, and whether the website, kiosks and tills show it.',
  },
  {
    path: '/menus/print-designs', label: 'Menu print designer', icon: 'BookOpenText', module: 'menus',
    section: 'Menus', parent: '/menus', order: 20, catalogOrder: 610,
    keywords: 'menu print designer printed menu designs layout paper a4 pages pdf',
    description: 'Design printed menus: place sections, dishes, pictures and notes on the page by hand, with several designs for each menu.',
  },
  {
    path: '/menus/variant-groups', label: 'Menu variant groups', menuLabel: 'Variant groups', icon: 'Layers', module: 'menus',
    section: 'Menus', parent: '/menus', order: 30, catalogOrder: 620,
    keywords: 'variant groups options choices modifiers extras sizes flavours toppings',
    description: 'Reusable sets of options for dishes, such as sizes, flavours and extras, with their prices and how kiosks show them.',
  },
  {
    path: '/menus/dietary-tags', label: 'Menu allergens & dietary tags', menuLabel: 'Allergens & dietary', icon: 'Tag', module: 'menus',
    section: 'Menus', parent: '/menus', order: 40, catalogOrder: 630,
    keywords: 'allergens allergy allergies dietary tags vegan vegetarian gluten dairy nuts notice',
    description: 'The allergen and dietary tags dishes can carry, their order and icons, and the allergen notice shown to guests.',
  },
  {
    path: '/menus/allergens', label: 'Allergen matrix', icon: 'Grid3x3', module: 'menus',
    section: 'Menus', parent: '/menus', order: 50, catalogOrder: 640,
    keywords: 'allergen allergy matrix allergies contains may contain free from dishes grid publish',
    description: 'A grid of every dish against every allergen: set what a dish contains, may contain or can leave out, then publish.',
  },
  {
    path: '/menus/tax', label: 'Tax rates', icon: 'Percent', module: 'menus',
    section: 'Menus', parent: '/menus', order: 60, catalogOrder: 650,
    keywords: 'tax rates vat exceptions order types percentages',
    description: 'Tax (VAT) rates and which one applies by menu, section, dish, order type and location.',
  },
  {
    path: '/menus/deliveroo', label: 'Deliveroo menu', icon: 'Bike', module: 'menus',
    section: 'Menus', parent: '/menus', order: 80, catalogOrder: 660,
    keywords: 'deliveroo menu file csv export delivery prices matching',
    description: "Fill Deliveroo's menu file from your menus: prices, VAT, descriptions and allergens.",
  },
  {
    path: '/menus/translations', label: 'Menu translations (kiosks)', menuLabel: 'Translations', icon: 'Languages', module: 'menus',
    section: 'Menus', parent: '/menus', order: 70, catalogOrder: 670,
    keywords: 'menu translations languages kiosks spanish french german ai draft',
    description: 'Menu words in other languages for the kiosks, with a first draft from Pepper.',
  },
]
