// shared/nav/hs.js: the Health & safety area's pages in the admin's menu
// (docs/PARALLEL_WORK.md 3.6). One record per page: shared/nav/index.js
// gathers every area's file and builds ROUTE_CATALOG, DEFAULT_NAV_TREE,
// NAV_KEYWORDS and NAV_DESCRIPTIONS from them; the fields are described there.

export const pages = [
  {
    path: '/food-safety', label: 'Food safety', icon: 'Thermometer', module: 'food_safety',
    section: 'Health & safety', order: 10, catalogOrder: 510,
    keywords: 'food safety temperatures fridge freezer checks deliveries hold cooking logs corrective actions haccp sfbb',
    description: 'Food safety records: fridge and freezer temperatures, deliveries, hot and cold holding and cooking checks, with corrective actions.',
  },
  {
    path: '/checklists', label: 'Checklists', icon: 'ListChecks', module: 'checklists',
    section: 'Health & safety', order: 20, catalogOrder: 520,
    keywords: 'checklists opening closing cleaning tasks tick off daily weekly monthly due audits',
    description: 'Opening, closing, cleaning and audit checklists: tick off what is due today and set up the lists.',
  },
  {
    path: '/hs-action-log', label: 'Action log', icon: 'ClipboardCheck', module: 'hs_action_log',
    section: 'Health & safety', order: 40, catalogOrder: 540,
    keywords: 'action log health safety repairs maintenance records training facilities to do',
    description: 'A to-do list of repairs, records, training and cleaning at each venue, with who it is for and when it is due.',
  },
  {
    path: '/legacy-import', label: 'Legacy import', icon: 'FileSpreadsheet', module: 'test_data',
    section: 'Admin', order: 70, catalogOrder: 870,
    keywords: 'legacy import spreadsheet workbook cafe manager old data',
    description: 'Bring in checklists and food safety records from the old spreadsheet.',
  },
]
