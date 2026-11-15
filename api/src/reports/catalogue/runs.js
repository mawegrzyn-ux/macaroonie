// src/reports/catalogue/runs.js
//
// Report runs: every time a report was run on screen, downloaded, printed,
// kept as a file or sent by email (report_runs, migration 243; kept files,
// migration 250; schedules and emails, migration 251), as Past runs lists
// them for everyone in the group. Seeing everyone's runs on
// Past runs needs Manage on Reports, and so does this.
//
// What a run was about is said in the catalogue's own words for its subject
// and area, which exist only once every other subject is defined, so
// index.js hands them in: runsSubjects(otherSubjects, areas). Both are text
// worked out in SQL, not choices: a choice's words go into the smart
// builder's word index (smart.js subjectDocs()), and every subject's and
// area's name there made this the best fit for nearly every request.
//
// The choices a run was made with (params) are read only for whether Pepper
// made it and whether rows were opened up. An error's words aren't offered:
// only whether it failed. A send's record (delivery) is read only for its
// counts: the addresses in it are masked and never offered.

import { subject, text, number, yesno, choice, moment, duration, sum, avg, max, count, countDistinct, ratio, one } from './define.js'
import { ASSISTANT_NAME } from '../../../../shared/assistant.js'

const KEY = 'group.report_runs'
const LABEL = 'Report runs'
const DAY = '({t}.created_at AT TIME ZONE {tz})::date'
const SECONDS = '({t}.ms::numeric / 1000)'
const KEPT = '(EXISTS (SELECT 1 FROM report_files f WHERE f.tenant_id = {t}.tenant_id AND f.run_id = {t}.id))'
const NOT_MET = "(COALESCE({t}.delivery->>'not_met', '') = 'true')"
const WHAT = "(CASE WHEN {t}.kind = 'scheduled' AND " + NOT_MET + " THEN 'skipped' WHEN {t}.kind = 'scheduled' THEN 'scheduled'" +
  " WHEN {t}.kind = 'emailed' THEN 'emailed' WHEN {t}.kind = 'run' THEN 'ran' WHEN {t}.format = 'print' THEN 'printed'" +
  " WHEN " + KEPT + " THEN 'kept' ELSE 'downloaded' END)"
const EMAILS_SENT = "COALESCE(NULLIF({t}.delivery->>'sent', '')::int, 0)"
const BY_PEPPER = "(COALESCE({t}.params->>'via', '') = 'pepper')"
const OPENED_UP = "(jsonb_typeof({t}.params->'drill') = 'array' AND jsonb_array_length({t}.params->'drill') > 0)"
// A subject's key goes into the SQL as written: keys are code, never typed.
const SAFE_KEY = /^[a-z0-9_.]+$/
// Names come from the catalogue (code), quoted for SQL.
const lit = v => "'" + String(v).replace(/'/g, "''") + "'"
const caseOf = (pairs, otherwise) => '(CASE {t}.subject ' + pairs.map(([k, v]) => "WHEN '" + k + "' THEN " + lit(v)).join(' ') + ' ELSE ' + otherwise + ' END)'

export default function runsSubjects(others, areas) {
  const all = [...others, { key: KEY, label: LABEL, area: 'shared' }]
  const areaLabel = Object.fromEntries(areas.map(a => [a.key, a.label]))
  for (const s of all) {
    if (!SAFE_KEY.test(s.key)) throw new Error('Report catalogue: "' + s.key + '" can\'t be named in report runs')
    if (!areaLabel[s.area]) throw new Error('Report catalogue: ' + s.key + '\'s area "' + s.area + '" has no name for report runs')
  }
  // A subject since taken out of the catalogue keeps its key: shown as it is.
  const aboutSql = caseOf(all.map(s => [s.key, s.label]), '{t}.subject')
  const areaSql = caseOf(all.map(s => [s.key, areaLabel[s.area]]), 'NULL')

  return [
    subject({
      key: KEY,
      label: LABEL,
      one: 'run',
      area: 'shared',
      module: 'reports',
      level: 'manage',
      about: 'Every time a report was run on screen, downloaded, printed, kept as a file or sent by email, as Past runs lists them: which report, who, when, how many rows and how long it took. Like everyone\'s runs on Past runs, this needs Manage on Reports.',
      from: 'report_runs',
      name: 'report',
      // The schedule a run was sent by: What was done says Sent by a schedule;
      // schedules themselves are settings, not counted.
      skip: ['schedule_id'],
      date: { sql: DAY, bound: '{t}.created_at', label: 'Day' },
      fields: {
        at: moment('created_at', { label: 'When' }),
        report: text({ sql: "COALESCE(NULLIF(btrim({t}.report_name), ''), 'Not named')" }, { label: 'Report' }),
        about: text({ sql: aboutSql }, { label: 'What it was about', about: 'The kind of thing the report counted, as the report builder names it.' }),
        area: text({ sql: areaSql }, { label: 'Area' }),
        what: choice({ sql: WHAT }, {
          ran: 'Ran', downloaded: 'Downloaded', kept: 'File kept', printed: 'Printed',
          scheduled: 'Sent by a schedule', skipped: 'Skipped by a schedule', emailed: 'Emailed',
        }, {
          label: 'What was done',
          about: 'Ran on screen (the builder\'s preview isn\'t counted), downloaded as a file, kept as a file to download later, printed, sent by a schedule, skipped by a schedule because its condition wasn\'t met, or emailed by someone.',
        }),
        format: choice('format', { csv: 'CSV', xlsx: 'Excel', print: 'Print', email: 'In the email' }, { label: 'Format', empty: 'On screen' }),
        kind_of_report: choice({ sql: "(CASE WHEN {t}.report_id IS NOT NULL THEN 'saved' WHEN {t}.starter_key IS NOT NULL THEN 'starter' ELSE 'unsaved' END)" },
          { saved: 'Saved report', starter: 'Starter report', unsaved: 'Not saved, or deleted since' }, { label: 'Kind of report' }),
        who: text('user_email', { label: 'Who', pii: true }),
        by_pepper: yesno({ sql: BY_PEPPER }, { label: 'By ' + ASSISTANT_NAME, about: 'Run, or a file made, by ' + ASSISTANT_NAME + ' for the person.' }),
        opened_up: yesno({ sql: 'COALESCE(' + OPENED_UP + ', false)' }, { label: 'Rows opened up', about: 'A row of the report was opened into others, or into the rows behind it.' }),
        failed: yesno({ sql: '({t}.error IS NOT NULL)' }, { label: 'Failed' }),
        rows: number('row_count', { label: 'Rows', decimals: 0 }),
        time_taken: duration({ sql: SECONDS }, { label: 'Time taken' }),
      },
      measures: {
        runs: count({ label: 'Runs', about: 'Every run, download, print and kept file.' }),
        on_screen: count({ label: 'Ran on screen', where: "{t}.kind = 'run'" }),
        downloads: count({ label: 'Downloaded', where: "{t}.kind = 'export' AND COALESCE({t}.format, '') <> 'print' AND NOT " + KEPT }),
        kept: count({ label: 'Files kept', where: KEPT }),
        prints: count({ label: 'Printed', where: "{t}.format = 'print'" }),
        failures: count({ label: 'Failed', where: '{t}.error IS NOT NULL' }),
        schedule_sends: count({ label: 'Sent by a schedule', where: "{t}.kind = 'scheduled' AND NOT " + NOT_MET }),
        schedule_skips: count({ label: 'Skipped by a schedule', where: "{t}.kind = 'scheduled' AND " + NOT_MET, about: 'Times a schedule didn\'t send because its condition wasn\'t met.' }),
        emailed: count({ label: 'Emailed', where: "{t}.kind = 'emailed'", about: 'Times someone emailed a report with Email it now.' }),
        emails_sent: sum({ sql: EMAILS_SENT }, { label: 'Emails sent', about: 'Emails that went out, one for each person a send reached.' }),
        by_pepper_runs: count({ label: 'By ' + ASSISTANT_NAME, where: BY_PEPPER }),
        people: countDistinct('user_sub', { label: 'People' }),
        reports: countDistinct({ sql: "COALESCE({t}.report_id::text, 'starter:' || {t}.starter_key, {t}.report_name)" }, {
          label: 'Reports', about: 'How many different reports: a saved report, a starter, or one never saved by its name.',
        }),
        average_time: avg({ sql: SECONDS }, { type: 'duration', label: 'Average time' }),
        slowest: max({ sql: SECONDS }, { type: 'duration', label: 'Slowest' }),
        failed_rate: ratio('failures', 'runs', { type: 'percent', label: 'Failed (%)' }),
      },
      links: {
        person: one('group.team', 'user_sub', { on: 'auth0_user_id', label: 'Person', needs: 'team' }),
      },
      list: ['at', 'report', 'what', 'who', 'rows', 'time_taken'],
      sort: [{ by: 'at', dir: 'desc' }],
    }),
  ]
}
