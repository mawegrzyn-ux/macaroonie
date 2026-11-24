// src/reports/catalogue/group.js
//
// The group itself: its team and roles, the new locations it planned, the
// issues it logged and the features it asked for. Each needs the module of
// the page that shows it (Team, the New location page's Venues, Issue log,
// Feature requests); roles are named to everyone signed in, as the Team and
// Access pages name them. What a role may do isn't reported: a built-in role
// reads most of its levels from each module's defaults, so its stored map
// alone would mislead.
//
// A new location's own words and Pepper's plan (input, steps, ai,
// overrides, plan, results) are never read here.

import { subject, text, number, yesno, choice, moment, duration, sum, avg, count, ratio, one, many } from './define.js'

const DAY = '({t}.created_at AT TIME ZONE {tz})::date'
const TODAY = '(now() AT TIME ZONE {tz})::date'

// A person's role as the app decides it (effectiveRoleId() in
// src/services/roles.js): their custom role, else the built-in row for the
// role on their sign-in. {t} is the person's row.
const ROLE_ID = '(COALESCE({t}.custom_role_id, (SELECT br.id FROM tenant_roles br WHERE br.tenant_id = {t}.tenant_id AND br.key = {t}.role::text AND br.is_builtin)))'

const LEVELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const ISSUE_OPEN = "{t}.status NOT IN ('resolved', 'closed')"
const TO_RESOLVE = 'EXTRACT(EPOCH FROM ({t}.resolved_at - {t}.created_at))'
const FOLLOWUPS = "(SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof({t}.followups) = 'array' THEN {t}.followups ELSE '[]'::jsonb END) f)"
const FOLLOWUPS_LEFT = "(SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof({t}.followups) = 'array' THEN {t}.followups ELSE '[]'::jsonb END) f WHERE NOT COALESCE((f->>'done')::boolean, false))"

/** Where these subjects come in the catalogue (index.js gathers this folder by it, then by file name). */
export const order = 170

/**
 * This area's tables that no subject reads, and why (decisions.js gathers
 * them): settings (how something is set up) and out ({ reason: [tables] }).
 */
export const decisions = {
  settings: [
    'tenant_modules',
    'tenants', // the group's own name
  ],
  out: {
    'Secrets and keys': ['platform_secrets', 'user_office_pins'],
    // Shared devices (migration 280): the device, who is switched in, wrong PINs.
    'Tokens, codes and sessions': ['shared_devices', 'shared_device_people', 'shared_device_pin_tries'],
    // Each change on a shared device and its person (a report subject on the
    // share of named changes is a follow-up, docs/claude/outstanding/core.md).
    'A log of requests, kept for the record': ['shared_device_changes'],
    'Layouts and designs with nothing to count': ['nav_items', 'dashboard_tiles', 'home_pins'],
    'Working state that changes from minute to minute': [
      // Push notices (migration 262): where a person's notices go, their own
      // settings, and which task notices were sent (each once).
      'push_devices', 'user_notify', 'task_notices',
    ],
    'Reached only through the row they belong to': ['feature_request_upvotes'],
    'The platform\'s own, the same for every group': [
      'platform_admins', 'platform_interest', 'platform_settings', 'backlog_items', 'schema_migrations', 'changelog_entries',
    ],
  },
}

export const subjects = [
  subject({
    key: 'group.team',
    label: 'Team',
    one: 'person',
    area: 'shared',
    module: 'team',
    about: 'Everyone with a sign-in to the group, as the Team page lists them: their role, whether they are active and when they last signed in.',
    from: 'users',
    name: 'name',
    fields: {
      name: text({ sql: "COALESCE(NULLIF(btrim({t}.full_name), ''), {t}.email)" }, { label: 'Name', pii: true }),
      email: text('email', { label: 'Email', pii: true }),
      builtin_role: choice({ sql: '{t}.role::text' }, { owner: 'Owner', admin: 'Admin', operator: 'Operator', viewer: 'Viewer' }, {
        label: 'Built-in role', about: 'The fixed role on the sign-in. A custom role, when given, decides what they can do instead.',
      }),
      custom: yesno({ sql: '(EXISTS (SELECT 1 FROM tenant_roles cr WHERE cr.id = {t}.custom_role_id AND cr.tenant_id = {t}.tenant_id AND NOT cr.is_builtin))' }, { label: 'Has a custom role', about: 'Given a role the group made, as the Team page shows it.' }),
      active: yesno('is_active', { label: 'Active' }),
      signed_in: yesno({ sql: '({t}.last_login_at IS NOT NULL)' }, { label: 'Has signed in' }),
      last_signed_in: moment('last_login_at', { label: 'Last signed in' }),
      days_since: number({ sql: '(' + TODAY + ' - ({t}.last_login_at AT TIME ZONE {tz})::date)' }, { label: 'Days since they signed in', decimals: 0 }),
      invited: moment('invited_at', { label: 'Invited' }),
      added: moment('created_at', { label: 'Added' }),
    },
    measures: {
      people: count({ label: 'People' }),
      active_people: count({ label: 'Active', where: '{t}.is_active' }),
      never_signed_in: count({ label: 'Never signed in', where: '{t}.is_active AND {t}.last_login_at IS NULL', about: 'Active sign-ins nobody has used yet.' }),
      recent: count({ label: 'Signed in, last 30 days', where: "{t}.last_login_at > now() - interval '30 days'" }),
    },
    links: {
      role: one('group.roles', { sql: ROLE_ID }, { label: 'Role' }),
      invited_by: one('group.team', 'invited_by', { label: 'Invited by' }),
    },
    list: ['name', 'email', 'role.name', 'active', 'last_signed_in'],
    sort: [{ by: 'name', dir: 'asc' }],
    // The password hash is a secret. (auth0_user_id is read: Pepper's use and
    // chats find their person by it.)
    skip: ['password_hash', 'updated_at'],
  }),

  subject({
    key: 'group.roles',
    label: 'Roles',
    one: 'role',
    area: 'shared',
    about: 'The group\'s roles, the four built in and its own, as the Access page lists them. What each role may do isn\'t reported here.',
    from: 'tenant_roles',
    name: 'name',
    fields: {
      name: text('label', { label: 'Role' }),
      description: text('description'),
      builtin: yesno('is_builtin', { label: 'Built in' }),
      in_use: yesno('is_active', { label: 'In use' }),
      added: moment('created_at', { label: 'Added' }),
    },
    measures: {
      roles: count({ label: 'Roles' }),
      own_roles: count({ label: 'The group\'s own', where: 'NOT {t}.is_builtin' }),
    },
    links: {
      people: many('group.team', { sql: ROLE_ID }, { label: 'People' }),
    },
    list: ['name', 'builtin', 'in_use', 'description'],
    sort: [{ by: 'name', dir: 'asc' }],
    // permissions: a built-in role reads most of its levels from the module
    // defaults, so the stored map alone would mislead.
    skip: ['key', 'permissions', 'sort_order', 'updated_at'],
  }),

  subject({
    key: 'group.openings',
    label: 'New locations',
    one: 'new location',
    area: 'shared',
    module: 'venues',
    about: 'Every new location planned on the New location page or with Pepper, on the day it was started: how far it got, who started it, when the location was made and how many follow-ups are left. What was typed and Pepper\'s plan aren\'t reported.',
    from: 'store_openings',
    name: 'name',
    date: { sql: DAY, bound: '{t}.created_at', label: 'Day started' },
    fields: {
      name: text('title', { label: 'Name' }),
      status: choice('status', { draft: 'Started', questions: 'Questions to answer', ready: 'Ready to create', created: 'Location made' }, { label: 'Where it got to' }),
      made: yesno({ sql: "({t}.status = 'created')" }, { label: 'Location made' }),
      started: moment('created_at', { label: 'Started' }),
      started_by: text('created_by_email', { label: 'Started by', pii: true }),
      last_changed: moment('updated_at', { label: 'Last changed' }),
      made_at: moment('opened_at', { label: 'Made at' }),
      made_by: text('opened_by', { label: 'Made by', pii: true }),
      days_to_make: number({ sql: '(({t}.opened_at AT TIME ZONE {tz})::date - ' + DAY + ')' }, { label: 'Days from start to made', decimals: 0 }),
      rounds: number('rounds', { label: 'Rounds of questions', adds: true }),
      followups: number({ sql: FOLLOWUPS }, { label: 'Follow-ups', adds: true }),
      followups_left: number({ sql: FOLLOWUPS_LEFT }, { label: 'Follow-ups left', adds: true }),
    },
    measures: {
      openings: count({ label: 'New locations' }),
      made_count: count({ label: 'Made', where: "{t}.status = 'created'" }),
      in_progress: count({ label: 'Not made yet', where: "{t}.status <> 'created'" }),
      total_followups_left: sum({ sql: FOLLOWUPS_LEFT }, { label: 'Follow-ups left' }),
    },
    links: {
      // Named location, not venue: a plan has no location until it is made,
      // and a venues choice would leave the drafts out.
      location: one('venue', 'venue_id', { label: 'Location' }),
    },
    list: ['date', 'name', 'status', 'started_by', 'location.name', 'followups_left'],
    sort: [{ by: 'date', dir: 'desc' }],
    // The person's own words and Pepper's plan, and the working state: never reported.
    skip: ['input', 'steps', 'ai', 'overrides', 'plan', 'results', 'busy_until', 'created_by'],
  }),

  subject({
    key: 'group.issues',
    label: 'Issues',
    one: 'issue',
    area: 'shared',
    module: 'issue_log',
    about: 'Every issue the group logged on the Issue log, on the day it was logged: what kind, its impact, urgency and priority, and where it got to.',
    from: 'issue_log',
    name: 'title',
    date: { sql: DAY, bound: '{t}.created_at', label: 'Day logged' },
    fields: {
      title: text('title'),
      description: text('description'),
      kind: choice('category', { incident: 'Incident', problem: 'Problem', change_request: 'Change request', service_request: 'Service request' }, { label: 'Kind' }),
      impact: choice('impact', LEVELS, { label: 'Impact' }),
      urgency: choice('urgency', LEVELS, { label: 'Urgency' }),
      priority: choice('priority', { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4' }, { label: 'Priority' }),
      status: choice('status', { new: 'New', acknowledged: 'Acknowledged', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' }, { label: 'Status' }),
      still_open: yesno({ sql: '(' + ISSUE_OPEN + ')' }, { label: 'Open' }),
      resolution: text('resolution_notes', { label: 'Resolution' }),
      logged: moment('created_at', { label: 'Logged' }),
      resolved: moment('resolved_at', { label: 'Resolved' }),
      time_to_resolve: duration({ sql: TO_RESOLVE }, { label: 'Time to resolve' }),
    },
    measures: {
      issues: count({ label: 'Issues' }),
      open_count: count({ label: 'Open', where: ISSUE_OPEN }),
      resolved_count: count({ label: 'Resolved', where: '{t}.resolved_at IS NOT NULL' }),
      urgent: count({ label: 'P1 and P2', where: "{t}.priority IN ('p1', 'p2')" }),
      average_to_resolve: avg({ sql: TO_RESOLVE }, { label: 'Average time to resolve', type: 'duration', where: '{t}.resolved_at IS NOT NULL' }),
    },
    list: ['date', 'title', 'kind', 'priority', 'status'],
    sort: [{ by: 'date', dir: 'desc' }],
    // The platform's own backlog: not the group's.
    skip: ['promoted_to_backlog_id', 'updated_at'],
  }),

  subject({
    key: 'group.requests',
    label: 'Feature requests',
    one: 'feature request',
    area: 'shared',
    module: 'feature_requests',
    about: 'The features the group asked for, on the day it asked, with their votes (every group\'s) and where each got to. Other groups\' requests, which the Feature requests page lists too, aren\'t counted.',
    from: 'feature_requests',
    name: 'title',
    date: { sql: DAY, bound: '{t}.created_at', label: 'Day asked' },
    fields: {
      title: text('title'),
      description: text('description'),
      status: choice('status', { submitted: 'Submitted', under_review: 'Under review', planned: 'Planned', in_progress: 'In progress', shipped: 'Shipped', declined: 'Declined' }, { label: 'Status' }),
      votes: number('upvotes', { label: 'Votes', adds: true }),
      reply: text('admin_notes', { label: 'Reply from Macaroonie' }),
      asked: moment('created_at', { label: 'Asked' }),
    },
    measures: {
      requests: count({ label: 'Requests' }),
      total_votes: sum('upvotes', { label: 'Votes' }),
      shipped: count({ label: 'Shipped', where: "{t}.status = 'shipped'" }),
      waiting: count({ label: 'Waiting', where: "{t}.status IN ('submitted', 'under_review', 'planned', 'in_progress')" }),
      votes_a_request: ratio('total_votes', 'requests', { label: 'Votes a request', decimals: 1 }),
    },
    list: ['date', 'title', 'status', 'votes'],
    sort: [{ by: 'date', dir: 'desc' }],
    // The platform's own backlog: not the group's.
    skip: ['promoted_to_backlog_id', 'updated_at'],
  }),
]
