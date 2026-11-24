// shared/registry/core.js: the group's own business objects: venues, the
// team, roles, issues and feature requests (shared/registry/index.js says
// what a record holds).

export const objects = [
  {
    key: 'venue', label: 'Venue', plural: 'Venues', words: ['restaurant', 'site', 'location', 'store'],
    table: 'venues', subjects: ['venue'],
    page: '/venues',
    actions: ['create_location'],
  },
  {
    key: 'group.team', label: 'Team member', plural: 'Team', words: ['user', 'login', 'account'],
    table: 'users', subjects: ['group.team'],
    page: '/team',
  },
  {
    key: 'group.roles', label: 'Role', plural: 'Roles', words: ['permissions', 'access'],
    table: 'tenant_roles', subjects: ['group.roles'],
    page: '/access',
  },
  {
    key: 'group.issues', label: 'Issue', plural: 'Issues', words: ['fault', 'problem', 'bug'],
    table: 'issue_log', subjects: ['group.issues'],
    page: '/issues',
    actions: ['report_issue'],
  },
  {
    key: 'group.requests', label: 'Feature request', plural: 'Feature requests', words: ['idea', 'request'],
    table: 'feature_requests', subjects: ['group.requests'],
    page: '/feature-requests',
    actions: ['request_feature'],
  },
]
