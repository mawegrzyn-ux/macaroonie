// src/pages/docs/usage-record.jsx
// The Docs page's "Usage record" section (migration 270, Pepper-first step 0a).
// Docs.jsx gathers every file in this folder (except parts.jsx) by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'usage-record'
export const label = 'Usage record'
export const order = 235

export function Section() {
  return (
    <section id="usage-record" data-doc="">
      <H2>Usage record</H2>
      <P>
        Pages opened in the admin and searches in the menu box (the ask bar), with whether a search was
        handed to Pepper and what it opened: the record step 0 of the Pepper-first plan asks for
        (<Mono>reports/AI first back office strategy.md</Mono>, "0. Prove and instrument"). One table,
        <Mono> usage_events</Mono> (migration 270, RLS enabled and forced), kept 90 days.
      </P>
      <H3>Writing it</H3>
      <DataTable
        head={['Part', 'What it does']}
        rows={[
          ['admin/src/lib/usage.js', 'recordUse() queues an event; flush() sends up to 50 to POST /api/usage/events every 15 s, when the queue fills and when the tab is hidden or closed (fetch with keepalive). A failed batch is dropped; nothing waits on it.'],
          ['usePageUse()', 'In AppShell and MobileShell: one page event per change of location.pathname (never the query string); lends the queue the Auth0 token getter.'],
          ['useSearchUse()', 'In the ask bar (components/layout/AskBar.jsx, on Home and over any page): typed(q, n) as the box changes, askedPepper() when the words are handed to Pepper (Enter with no row lit, Ask, the Ask Pepper row, an ask under the bar), picked(kind, route) when a page (menu) or a saved report (report) is opened from the bar. One row per search: ended by a pick, a hand-over (the box empties), an emptied box, new words after a hand-over, or the tab hidden. A search of one letter that went nowhere is not sent. Since step 2c nothing records picked pepper: what Pepper\'s answer then opened is not joined to the search.'],
          ['api/src/routes/usage.js', 'POST /api/usage/events { events } (requireAuth, any member of the group, at most 50, 120 batches a minute): 204. Each event is cleaned by usageRow(): an odd one is dropped, never refused.'],
          ['api/src/services/usageRecord.js', 'usagePath(): the path only, each part that is a uuid, a number or a long key as :id, letters, digits and / _ : . ~ - only, 200 characters. usageRow(), recordUsage(), cleanUpUsage() (the hourly ai-cleanup job, KEEP_DAYS 90).'],
        ]}
      />
      <H3>Reading it: three report subjects</H3>
      <P>
        In <Mono>api/src/reports/catalogue/usage.js</Mono>, area Your group. Decision 8 of the strategy: the
        record of what a person opens stays theirs, and Pepper does not rank people.
      </P>
      <DataTable
        head={['Subject', 'Who', 'What']}
        rows={[
          ['usage.mine (My pages and searches)', 'No module: anyone who can use reports', 'Its rule is {t}.user_sub = {me}: only the person running it, the words typed included (pii, so a schedule to outsiders leaves them out).'],
          ['usage.pages (Pages opened)', 'View on nav_designer', 'Times opened, pages, days; no person, no words.'],
          ['usage.searches (Menu searches)', 'View on nav_designer', 'Searches, handed to Pepper and their share, opened something and its share, Pepper picks opened, no menu match; no person, no words.'],
        ]}
      />
      <P>
        <Mono>{'{me}'}</Mono> is a template the report compiler (<Mono>compile.js</Mono>, <Mono>Statement.me()</Mono>) turns
        into a parameter holding <Mono>env.userKey</Mono>, the auth0 sub of the person the run is for
        (<Mono>ctx.userKey</Mono> in <Mono>runReport()</Mono>): '' when there is none, which matches no row. The catalogue
        allows it only in a subject's <Mono>where</Mono>, and nothing can link to a subject whose rule reads more than
        <Mono> {'{t}'}</Mono>, so the rows can't be reached another way. A data link runs as the person who made it, and a
        schedule as its owner, so either shows that person's own record.
      </P>
      <InfoBox type="info">
        A guest's erasure (<Mono>eraseFromAi()</Mono>) deletes menu searches whose words name them.
        Fixture: <Mono>api/test/support/fixtures/shell.mjs</Mono>; tests: <Mono>api/test/usage-record.test.mjs</Mono>.
      </InfoBox>
    </section>
  )
}
