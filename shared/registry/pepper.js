// shared/registry/pepper.js: Pepper's business objects: a new location's
// plan and Pepper's own changes (shared/registry/index.js says what a record
// holds).

export const objects = [
  {
    key: 'group.openings', label: 'New location plan', plural: 'New location plans', words: ['store opening', 'new venue', 'opening'],
    table: 'store_openings', subjects: ['group.openings'],
    page: '/new-location',
    actions: ['plan_new_location', 'answer_location_questions', 'change_location_plan'],
  },
  {
    key: 'pepper.actions', label: 'Change by Pepper', plural: 'Changes by Pepper', words: ['done by pepper', 'pepper change', 'undo'],
    table: 'ai_actions', subjects: ['pepper.actions'],
    page: '/pepper/done',
  },
  {
    key: 'pepper.rules', label: 'Rule', plural: 'Rules', words: ['automation', 'when then', 'trigger'],
    table: 'pepper_rules',
    page: '/settings',
    actions: ['make_rule', 'change_rule', 'switch_rule', 'delete_rule'],
  },
  {
    key: 'pepper.notices', label: 'Notice', plural: 'Notices', words: ['push notice', 'phone alert', 'notification'],
    table: 'push_devices',
    page: '/settings',
    actions: ['send_notice'],
  },
]

export const notObjects = {
  'Pepper\'s own use, cost and chats: a record of the assistant, not of the business.':
    ['pepper.usage', 'pepper.requests', 'pepper.people', 'pepper.chats'],
}
