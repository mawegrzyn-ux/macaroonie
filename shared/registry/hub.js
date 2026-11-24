// shared/registry/hub.js: the Venue hub area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'till.printers', label: 'Printer', plural: 'Printers', words: ['print job', 'receipt printer', 'kitchen printer'],
    table: 'pos_printers', subjects: ['till.printers', 'till.print_jobs'],
    page: '/pos/printers',
  },
]
