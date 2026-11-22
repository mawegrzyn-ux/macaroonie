// src/pages/docs/home.jsx
// The Docs page's "Home, pins and the ask bar" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'home'
export const label = 'Home, pins and the ask bar'
export const order = 345

export function Section() {
  return (
    <section id="home" data-doc="">
      <H2>Home, pins and the ask bar</H2>
      <P>
        Step 2 of the Pepper-first back office (<Mono>reports/AI first back office strategy.md</Mono>, &ldquo;One
        home and the ask bar&rdquo;; <Mono>docs/PEPPER_FIRST.md</Mono> 4.1 to 4.4). Decision 8 holds throughout: a
        person&apos;s pins are theirs, and nothing on Home ranks or scores a person.
      </P>
      <H3>Home at / (migration 273)</H3>
      <P>
        <Mono>admin/src/pages/Home.jsx</Mono> (the index route in <Mono>admin/src/routes/shell.jsx</Mono>), for every
        group and role (decision 2: it is the Today feed and a search bar, not a chat; a full-screen conversation is
        never a landing page). From the top: pins (<Mono>home-pins</Mono>), the greeting with{' '}
        <Mono>Glance</Mono>, the feed&apos;s <Mono>TaskBoard</Mono> with its <Mono>FormSheet</Mono>, and{' '}
        <Mono>WeekAhead</Mono>, all from <Mono>GET /api/ops/today</Mono> as the Today page drew them (see Today, the
        ops front door); step 5 adds For review below. Its page record is <Mono>/</Mono> in{' '}
        <Mono>shared/nav/shell.js</Mono> (Home, icon <Mono>Home</Mono>, no module: the only page without one), first
        in the Home section. The Overview&apos;s tiles moved to <Mono>/overview</Mono> (its record in{' '}
        <Mono>shared/nav/dashboards.js</Mono>, the route in <Mono>admin/src/routes/dashboards.jsx</Mono>), and{' '}
        <Mono>/today</Mono> is a redirect to <Mono>/</Mono>. Task notices open <Mono>/</Mono> (the phone app&apos;s
        host and the Office app send it to <Mono>/mobile/today</Mono>: <Mono>push-sw.js</Mono>,{' '}
        <Mono>noticeUrl()</Mono> in <Mono>office-app/links.js</Mono>).
      </P>
      <P>
        Migration 273 on saved menus: the <Mono>/</Mono> link becomes <Mono>/overview</Mono> (only where{' '}
        <Mono>/overview</Mono> isn&apos;t there yet, so a second run changes nothing); the <Mono>/today</Mono> link
        becomes <Mono>/</Mono>, named Home with the Home icon where the group hadn&apos;t renamed it, with no module and
        no hidden roles; Home goes first among its siblings; a menu without Today gets a Home link first in the
        Overview&apos;s section (or at the top). Tests: <Mono>api/test/nav-default.test.mjs</Mono> (the migrations&apos;
        tree against <Mono>DEFAULT_NAV_TREE</Mono>, 273 on real rows) and <Mono>api/test/ops-today.test.mjs</Mono>{' '}
        (Home in a custom role&apos;s menu that has no Overview).
      </P>
      <P>
        The phone app (<Mono>/mobile</Mono>) keeps its own hub and Today page for now.
      </P>
      <H3>Pins (migration 272)</H3>
      <P>
        Each person&apos;s own shortcuts, kept on the server so they follow the person to any device. Table{' '}
        <Mono>home_pins</Mono> (RLS enabled and forced): <Mono>user_sub</Mono>, <Mono>sort_order</Mono>,{' '}
        <Mono>path</Mono> (a page of the person&apos;s own menu), <Mono>venue_id</Mono> (venues, set to null when the
        venue goes), <Mono>tab</Mono>, <Mono>label</Mono> (the person&apos;s own name for it, 40 characters at most).
        They replaced the Overview&apos;s Quick access picker, which kept its list in each browser
        (<Mono>maca_dashboard_shortcuts</Mono>, gone with its fixed <Mono>SHORTCUT_OPTIONS</Mono> list).
      </P>
      <DataTable
        head={['Route', 'What it does']}
        rows={[
          ['GET /api/pins', 'The person\'s pins in their order, { pins: [{ path, venue_id, tab, label }], max: 12 }. A pin whose page has left the person\'s menu (navTreeFor(), the tree /api/me sends) is not sent. Open to everyone signed in to a group.'],
          ['PUT /api/pins', '{ pins: [...] } replaces the whole list (rule 13), at most MAX_PINS 12. A path not in the person\'s menu is refused (400), a venue not the group\'s (404). A venue or tab the page\'s address does not accept (pageAccepts(), shared/nav/links.js) is dropped, a tab not one of the page\'s too; the same page at the same venue and tab twice is kept once. Returns the saved list as GET does.'],
        ]}
      />
      <P>
        Admin: <Mono>components/home/Pins.jsx</Mono>: <Mono>PinStrip</Mono> (chips that open{' '}
        <Mono>pageLink(path, {'{ venue, tab }'})</Mono>, <Mono>pin</Mono> <Mono>data-path</Mono>,{' '}
        <Mono>pin-where</Mono>, <Mono>pins-edit</Mono>), <Mono>usePins()</Mono> (the <Mono>['pins']</Mono> query and
        the save, which puts the reply into the query), <Mono>menuLinks(tree)</Mono> (the person&apos;s menu links,
        once each) and the editor (<Mono>pins-editor</Mono>, <Mono>pins-row</Mono>, <Mono>pins-grip</Mono> for
        @dnd-kit with pointer, touch and keyboard sensors, <Mono>pins-label</Mono>, <Mono>pins-venue</Mono>,{' '}
        <Mono>pins-tab</Mono>, <Mono>pins-remove</Mono>, <Mono>pins-find</Mono> with the menu search&apos;s own matcher,{' '}
        <Mono>pins-add</Mono>, <Mono>pins-count</Mono>, <Mono>pins-full</Mono>, <Mono>pins-save</Mono>). Nothing is
        saved until Save. The Overview&apos;s <Mono>quick_access</Mono> tile (now named Your pins) draws the same strip.
      </P>
      <InfoBox type="info">
        Tests: <Mono>api/test/home-pins.test.mjs</Mono>; the fixtures (<Mono>support/fixtures/shell.mjs</Mono>) save two
        pins, one at a venue, so the cross-tenant sweep replays the save as the other group.
      </InfoBox>
    </section>
  )
}
