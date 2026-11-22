// src/pages/docs/ops-today.jsx
// The Docs page's "Today (the ops front door)" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'ops-today'
export const label = 'Today (the ops front door)'
export const order = 350

export function Section() {
  return (
    <section id="ops-today" data-doc="">
      <H2>Today (the ops front door)</H2>
      <P>
        The first slice of the chat-first front door in <Mono>docs/CHAT_FIRST.md</Mono> (requirement ids in
        brackets). <Mono>/today</Mono> (<Mono>admin/src/pages/OpsToday.jsx</Mono>, nav link at the top of Home,
        migration 221) shows the day at a glance, the tasks for a venue grouped
        Late / Now / Next / Later, the person's menu as tiles and Pepper beside them. The tasks come from data and
        rules, never the model (P1, Q1), so the page works with Pepper off.
      </P>
      <H3>Who has the link</H3>
      <P>
        Everyone signed in, like the feed itself (<Mono>GET /api/ops/today</Mono> has no module gate; each area
        is read as the person, so their permissions decide what is on it). The link has no <Mono>module</Mono> in{' '}
        <Mono>ROUTE_CATALOG</Mono> or <Mono>DEFAULT_NAV_TREE</Mono>. Migration 221 had given it the Overview&apos;s
        module (<Mono>dashboard</Mono>) and copied the Overview link&apos;s <Mono>hidden_role_ids</Mono>, so a role
        without the Overview lost Today too: a custom role resolves every module it doesn&apos;t name to{' '}
        <Mono>none</Mono> (<Mono>resolvePermission()</Mono>). Migration 227 clears both on every group&apos;s{' '}
        <Mono>/today</Mono> link; the Navigation designer can still hide it from a role.
      </P>
      <H3>GET /api/ops/today</H3>
      <P>
        <Mono>routes/ops.js</Mono> (<Mono>?venue_id=&amp;date=&amp;time=</Mono>; no venue = the tenant's first
        active venue by name; <Mono>time</Mono> HH:MM judges the groups at another moment, default the venue's time
        now, a past day = 23:59, a future day = 00:00). Open to anyone signed in; it builds a staff tool context
        (<Mono>makeContext()</Mono>) and calls <Mono>opsToday()</Mono> in <Mono>services/opsToday.js</Mono>, which
        reads every source through the admin routes in-process as the person (<Mono>callApi()</Mono>), so each
        part keeps its route's permission check and tenant filter. Areas the person has no level on (from{' '}
        <Mono>permissionLevels()</Mono>) or that answer 403 are listed in <Mono>not_included</Mono>, other
        failures in <Mono>errors</Mono>; the rest still loads.
      </P>
      <DataTable
        head={['Area (module)', 'Tasks (kind)', 'Read from']}
        rows={[
          ['food_safety (food_safety)', 'fridge_check and hold_check per check time with units not logged; cooking_check per session short of required_items_count; corrective_action per out-of-range reading or failed delivery with no action', '/api/food-safety equipment, capture-times, temp-logs, hold-stations, hold-capture-times, holds, cooking-sessions, cooking, deliveries'],
          ['checklists (checklists)', 'checklist per template not completed (daily = now, weekly / monthly = later)', '/api/checklists/due'],
          ['hs_actions (hs_action_log)', 'hs_action per open entry due today or overdue', '/api/hs-action-log/entries'],
          ['purchasing (purchasing)', 'po_to_send (soonest first; late once deadlinePassed() for its day, listed first); delivery_due (sent, delivery today); delivery_not_booked (sent, delivery day before today: late); orders_to_approve (only with purchasing_approve manage)', '/api/purchasing/pos (order=asc for to_send), /api/purchasing/orders'],
          ['cash (cash_recon)', "cash_up per open day (openDatesOrNull()) of the last CASH_DAYS_BACK (7) and the feed's own day that isn't submitted: the day's own due at closingTime() of its sittings (now / next / later, late once the day has passed), yesterday late, earlier days late only once the venue uses Cash Recon (a report on any day of this week or last); days after the venue's today never", '/api/venues/:id/cash-recon/week/:monday (this week and last), /api/venues/:id/schedule/sittings-for-date'],
          ['wages (cash_recon)', 'wages_to_pay when last week has cash still to pay: per entry max(0, total - bank_amount - cash_amount), one late task with the sum and how many people', '/api/venues/:id/cash-recon/wages/:monday'],
          ['online_orders (web_orders)', 'online_orders when orders are placed but not accepted', '/api/orders'],
        ]}
      />
      <P>
        Every task: <Mono>{'{ key, area, kind, compliance, title, detail, due, group, action, can_act }'}</Mono>.{' '}
        <Mono>key</Mono> is stable (one card per thing to do, C6), <Mono>action</Mono> is{' '}
        <Mono>{'{ form, label, ref }'}</Mono> (temps, holds, cooking, checklist, cash_up with{' '}
        <Mono>{'ref.date'}</Mono>, wages with <Mono>{'ref.week'}</Mono>) or <Mono>{'{ path, label }'}</Mono>, and{' '}
        <Mono>can_act</Mono> is the module's work level (<Mono>workLevel()</Mono>: Use where the module offers it,
        else Manage, so Manage for Cash Recon) (U1). <Mono>closingTime(sittings)</Mono> (exported) is the latest
        of the day's sittings' doors close, else last orders; a sitting closing after midnight counts as 23:59.
        The context <Mono>s</Mono> carries <Mono>today</Mono> (the venue's date now) beside the feed's{' '}
        <Mono>date</Mono>, so a feed for another day never counts a day that hasn't passed as missed.
        <Mono> groupFor()</Mono> decides the group (<Mono>GRACE_MINS</Mono> 30, <Mono>NEXT_MINS</Mono> 120) and{' '}
        <Mono>sortTasks()</Mono> the order: group, compliance first, then time (S1). A closed day
        (<Mono>/api/hs-settings</Mono> <Mono>closed</Mono>) expects no check rounds (R4). There is no task store
        yet: tasks are worked out on every request, done when their record exists (R2). The response also carries{' '}
        <Mono>summary</Mono> (bookings and big parties from <Mono>day_overview</Mono>, people on the rota from{' '}
        <Mono>whos_working</Mono>, the week ahead from Local info), <Mono>counts</Mono> and the <Mono>venues</Mono>{' '}
        for the switch.
      </P>
      <H3>The week ahead (summary.local)</H3>
      <P>
        With Local info View or more (<Mono>local_info</Mono> is in <Mono>OPS_MODULES</Mono>), <Mono>summary()</Mono>{' '}
        reads <Mono>GET /api/local-info/items</Mono> for the venue from the day to six days on (<Mono>WEEK_DAYS</Mono>{' '}
        7, through the route as the person, so hidden items and other venues stay out and items saved for every venue
        come in) and turns it into <Mono>summary.local</Mono> with <Mono>weekAhead()</Mono> in{' '}
        <Mono>shared/localInfo.js</Mono>: <Mono>{'{ from, to, weather, headlines, more }'}</Mono>.{' '}
        <Mono>weather</Mono> has one entry per day with a captured weather day (<Mono>isWeatherDay()</Mono>: kind weather
        with <Mono>data.weather_code</Mono>; the loudest when two captures cover a day), with the code, temperatures,
        rain and wind from the capture&apos;s <Mono>data</Mono>, <Mono>recorded</Mono> and its <Mono>hours</Mono>. Every other item is a headline (a typed-in weather
        item too), each once, on the first day of the week it shows, sorted by that day, then severity, kind and
        title; at most <Mono>HEADLINES</Mono> 5, <Mono>more</Mono> counting the rest. A headline&apos;s{' '}
        <Mono>url</Mono> goes through <Mono>webLink()</Mono> (<Mono>shared/links.js</Mono>: http / https only, else null). Without Local info the
        key is left out, and the area isn&apos;t named in <Mono>not_included</Mono> (it holds no tasks).
      </P>
      <P>
        <Mono>WeekAhead</Mono> (exported from <Mono>OpsToday.jsx</Mono>; <Mono>MobileToday.jsx</Mono> draws it with{' '}
        <Mono>{'linkFor={opsLink}'}</Mono>) sits under the greeting: a seven-column strip, each day in its own column
        (<Mono>gridColumnStart</Mono> from its offset, so a day without a forecast is a gap), with{' '}
        <Mono>WeatherIcon</Mono> (<Mono>components/localInfo/weather.jsx</Mono>) from the WMO code, the high, the
        low and the rain from 1 mm, red or amber for a
        warning or a notice; then the headlines with the kind icon in its severity chip (<Mono>KIND_ICONS</Mono>,{' '}
        <Mono>SEV_CHIP</Mono>), when (a day, Until a day, or a day to a day), time and place, and a 48 px Source link;
        then the more link to Local info. Day names come from the feed&apos;s own <Mono>date</Mono> and{' '}
        <Mono>is_today</Mono> (the venue&apos;s day), never the browser&apos;s clock. With nothing held, Local info
        Manage gets a line pointing at Local info and everyone else no card. Test ids <Mono>today-week</Mono>,{' '}
        <Mono>today-week-open</Mono>, <Mono>today-weather</Mono>, <Mono>today-weather-day</Mono>{' '}
        (<Mono>data-date</Mono>, <Mono>data-severity</Mono>), <Mono>today-headlines</Mono>,{' '}
        <Mono>today-headline</Mono> (<Mono>data-kind</Mono>, <Mono>data-severity</Mono>),{' '}
        <Mono>today-headline-source</Mono>, <Mono>today-week-more</Mono>, <Mono>today-week-empty</Mono>.
      </P>
      <H3>The page</H3>
      <P>
        Forms open in a sheet on the page with the shared panels (<Mono>TempChecksTable</Mono>,{' '}
        <Mono>HoldChecksTable</Mono>, <Mono>CookingChecksPanel</Mono>, <Mono>ChecklistRunPanel</Mono>), so they save
        through the same routes and keep their own read-only rules (F1, F3, F5); Done refetches the feed. A cash-up
        is <Mono>DayView</Mono> (<Mono>CashRecon.jsx</Mono>) with <Mono>hideHeader</Mono> and{' '}
        <Mono>onStateChange</Mono>: the sheet's foot shows its status and save state and its Submit / Unsubmit,
        only once DayView says <Mono>ready</Mono> (the day and Cash Recon setup loaded; DayView's{' '}
        <Mono>canSubmit</Mono> includes it, since Submit saves the form first and a Submit before the load would save
        an empty day over the real one: <Mono>MobileCashUp.jsx</Mono> had that gap). Submitting refetches the feed at
        once. Wages are <Mono>WeekWagesEditor</Mono> (<Mono>readOnly</Mono> without Cash Recon Manage; on the phone
        without the Bank column and Paid on for all) with <Mono>onStateChange</Mono>{' '}
        <Mono>{'{ dirty, saving, save }'}</Mono>: Done, the X and the backdrop ask first while <Mono>dirty</Mono>{' '}
        (<Mono>today-unsaved</Mono>: Keep editing, Close without saving, Save and close, which closes only when{' '}
        <Mono>save()</Mono> resolves true). A <Mono>FORMS</Mono> entry's <Mono>phone</Mono> path is where Open the
        full page goes on the phone (wages: <Mono>/mobile/wages</Mono>; the cash-up's <Mono>/cash-recon</Mono> goes
        through <Mono>opsLink()</Mono> to <Mono>/mobile/cash-up</Mono>). The phone hub's Cash Up and Wages tiles
        count the <Mono>cash</Mono> and <Mono>wages</Mono> tasks (<Mono>areas</Mono> in{' '}
        <Mono>mobile/registry.js</Mono>). Test ids <Mono>today-form</Mono> (<Mono>data-form</Mono>),{' '}
        <Mono>today-form-title</Mono>, <Mono>today-cash-state</Mono> (<Mono>data-status</Mono>),{' '}
        <Mono>today-cash-submit</Mono>, <Mono>today-cash-unsubmit</Mono>, <Mono>today-unsaved</Mono>,{' '}
        <Mono>today-unsaved-stay</Mono>, <Mono>today-unsaved-discard</Mono>, <Mono>today-unsaved-save</Mono>. The tiles
        are <Mono>/api/me</Mono>'s <Mono>nav_tree</Mono> links, pages with tasks first (<Mono>AREA_ROUTES</Mono>).
        Pepper is <Mono>ChatView</Mono> with <Mono>pageAware</Mono> (the page calls <Mono>usePepperPage()</Mono>
        with the venue and day) and a <Mono>suggestions</Mono> list for the day; the conversation is the drawer's
        remembered one (<Mono>useRememberedConversation()</Mono>). The venue choice is kept in{' '}
        <Mono>maca_today_venue</Mono>. Tests: <Mono>api/test/ops-today.test.mjs</Mono>.
      </P>
      <InfoBox type="info">
        Not built yet from <Mono>docs/CHAT_FIRST.md</Mono>: a task store with owners, snooze, skip and escalation
        (sections 3 and 5), manual and learned tasks (C3, L1-L6), watchers and push (M1-M7), forms inside the chat
        itself (F1 in the conversation, F6, F7), the shared-device person switch (U2) and the per-group chat-first
        switch (G1). Adding a source: a function in <Mono>SOURCES</Mono> with its module in <Mono>AREAS</Mono>,
        reading through the routes with <Mono>callApi()</Mono>, and a row in this table.
      </InfoBox>
      <H3>The form sheet</H3>
      <P>
        <Mono>components/forms/FormSheet.jsx</Mono>: <Mono>FORMS</Mono> (with each form&apos;s module and phone page),{' '}
        <Mono>Go</Mono>, <Mono>formTitle()</Mono>, <Mono>FormSheet</Mono> and <Mono>FormOpener</Mono>, moved out of{' '}
        <Mono>OpsToday.jsx</Mono> (which re-exports <Mono>FormSheet</Mono>) so Pepper&apos;s form cards open the
        same sheet. New forms: delivery (<Mono>DeliveryChecksPanel</Mono>), expense (<Mono>PettyCashPanel</Mono>),
        rota_day (<Mono>RotaDayList</Mono> and the week&apos;s <Mono>RotaGrid</Mono> on that day), sold_out
        (<Mono>AvailabilityModal</Mono>).
      </P>
      <H3>Task notices (migration 262)</H3>
      <P>
        <Mono>services/notices.js</Mono>, worker <Mono>task-notices</Mono> every five minutes
        (<Mono>startTaskNoticeWorker(app, log)</Mono>): for each group with a device, each venue&apos;s feed is
        worked out as the group&apos;s first owner through the internal act-as sign-in (see Authentication), so it
        holds every area. <Mono>noticeKind()</Mono>: <Mono>late</Mono> for a late task, <Mono>due_soon</Mono> for
        one due within <Mono>DUE_SOON_MINUTES</Mono> (30). <Mono>wants()</Mono>: the person&apos;s{' '}
        <Mono>user_notify</Mono> (on, venues, areas, kinds, <Mono>inQuietHours()</Mono> in venue time) and the
        feed&apos;s can_act rule on their own levels. Each notice is claimed in <Mono>task_notices</Mono> (PK venue,
        task key, day, kind) before it is sent, so it goes once. Delivery: <Mono>pushSenders.web</Mono>{' '}
        (web-push with VAPID keys made once and sealed in <Mono>platform_secrets</Mono> as{' '}
        <Mono>web_push_vapid</Mono>) and <Mono>pushSenders.app</Mono> (Expo&apos;s push service, channel{' '}
        <Mono>tasks</Mono>); a device the service calls gone is deleted, another failure kept in{' '}
        <Mono>last_error</Mono>. Old <Mono>task_notices</Mono> go after 30 days (hourly clean-up).
      </P>
      <P>
        <Mono>routes/notices.js</Mono> (<Mono>/api/notices</Mono>, anyone signed in, their own rows only):{' '}
        <Mono>GET/PUT /settings</Mono> (a whole save; venues checked to be the group&apos;s), <Mono>POST /devices</Mono>{' '}
        (<Mono>web</Mono>: a PushSubscription, https endpoint; <Mono>app</Mono>: an Expo push token; sealed, one row
        per <Mono>token_hash</Mono>), <Mono>DELETE /devices/:id</Mono>, <Mono>POST /test</Mono>. Admin:{' '}
        <Mono>components/notices/NoticeSettings.jsx</Mono> (on <Mono>/mobile/notices</Mono> and Settings),{' '}
        <Mono>lib/push.js</Mono>, and <Mono>public/push-sw.js</Mono> loaded into the service worker
        (<Mono>workbox.importScripts</Mono>): it shows a notice and opens its page on a tap.
      </P>
    </section>
  )
}
