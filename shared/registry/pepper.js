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
]

export const notObjects = {
  'Pepper\'s own use, cost and chats: a record of the assistant, not of the business.':
    ['pepper.usage', 'pepper.requests', 'pepper.people', 'pepper.chats'],
}
