// shared/registry/shell.js: the Home and Today area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'today.tasks', label: 'Task', plural: 'Today\'s tasks', words: ['today', 'to do', 'due task'],
    table: 'ops_task_days', subjects: ['today.tasks', 'today.task_changes'],
    page: '/',
    actions: ['snooze_task', 'skip_task', 'assign_task'],
  },
]

export const notObjects = {
  'A record of pages opened, searches and suggestions: about using the app, not the business.':
    ['usage.pages', 'usage.searches', 'usage.suggestions', 'usage.mine'],
}
