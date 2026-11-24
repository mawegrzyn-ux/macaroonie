// shared/registry/reports.js: the Reports area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'reports.reports', label: 'Report', plural: 'Reports', words: ['saved report', 'report file', 'export'],
    table: 'reports', subjects: ['group.report_runs'],
    page: '/reports',
    actions: ['build_report', 'change_report', 'copy_report', 'delete_report', 'share_report', 'export_report'],
  },
  {
    key: 'reports.schedules', label: 'Report schedule', plural: 'Report schedules', words: ['scheduled report', 'report email'],
    table: 'report_schedules',
    page: '/reports',
    actions: ['schedule_report', 'change_schedule', 'pause_schedule', 'send_report'],
  },
]
