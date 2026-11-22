// src/pages/docs/kiosk-analytics.jsx
// The Docs page's "Kiosk analytics & journeys" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'kiosk-analytics'
export const label = 'Kiosk analytics & journeys'
export const order = 290

export function Section() {
  return (
    <section id="kiosk-analytics" data-doc="">
      <H2>Kiosk analytics &amp; journeys</H2>
      <P>
        Migration 208. Each kiosk records every guest visit as a stream of events with enough in it to play the
        visit back, step by step, on the kiosk app itself; the API sums each visit up on arrival and the admin
        page (Store tech → Kiosk analytics, <Mono>/pos/kiosk-analytics</Mono>, Till reports view) reports on
        them and plays them back. The rules live once in <Mono>shared/kioskJourney.js</Mono>, used by the
        kiosk, the API and the admin.
      </P>
      <H3>The event stream</H3>
      <P>
        A visit is <Mono>{'{ id (ULID), started_at, design_id, stream_id, config_version, app_version, truncated, names, events }'}</Mono>.
        Every event has <Mono>t</Mono> (ms since the start, in order) and a kind <Mono>k</Mono>:
      </P>
      <DataTable
        head={['Kind', 'Fields', 'Meaning']}
        rows={[
          ['v', 'p (patch), d (keys removed)', 'What the kiosk shows changed: a patch of the flat view (diffView() / applyPatch()). The first v holds the whole view.'],
          ['tap', 'x, y, el, id, ref, hit', 'A touch at x, y (CSS px of the kiosk\'s viewport) on el (the element\'s aria-label or words, after the change), id (data-testid), ref (an item, section or option id). hit 1 = something answered, 0 = nothing answers there, 2 = it was disabled.'],
          ['swipe', 'x, y, x2, y2, ms, el, id', 'A drag of 24 px or more.'],
          ['scroll', 's, x, y', 'A scrolling box moved: s is its path of child indexes from .k-root (boxPath() / boxAt()), recorded at most every 150 ms.'],
          ['vp', 'w, h, b', 'The kiosk\'s viewport size (at the start and on a resize), and b: the kiosk\'s box in it, [x, y, w, h] (bars on a screen of another shape; kept inside the window by cleanVisit(), left off when broken). A replay places the kiosk by it (useReplayBox()).'],
          ['end', 'why', 'done (the order number screen), guest (Start again), timeout ("Still there?" unanswered), left (45 s untouched on the start screen), interrupted (reloaded mid-visit), preview.'],
        ]}
      />
      <P>
        The flat view (<Mono>viewOf()</Mono> in <Mono>pos/src/kiosk/journey.js</Mono>): <Mono>screen</Mono>,{' '}
        <Mono>section</Mono>, <Mono>orderType</Mono>, <Mono>lang</Mono>, <Mono>reach</Mono>, <Mono>prefs</Mono>,{' '}
        <Mono>basket</Mono> (entries with item_id, qty, selection, key), <Mono>builder</Mono>,{' '}
        <Mono>details</Mono> (the name and tent number as lengths only), <Mono>detailStep</Mono>,{' '}
        <Mono>method</Mono>, <Mono>result</Mono> (order number, provisional, pending, total, check id),{' '}
        <Mono>error</Mono>, <Mono>toast</Mono>, <Mono>link</Mono>, <Mono>value</Mono> (the basket in pence) and{' '}
        <Mono>ui:&lt;key&gt;</Mono> for what screens keep to themselves. <Mono>names</Mono> maps ids to the
        names the guest saw (dishes, sections, order types, tags, languages) so steps read in words after the
        menu changes.
      </P>
      <H3>Recording on the kiosk</H3>
      <P>
        <Mono>startJourneys()</Mono> (from <Mono>KioskApp.jsx</Mono>, never in a preview, a share link or a
        replay, and not when the design's <Mono>behaviour.record_journeys</Mono> is false) subscribes to the
        store (<Mono>subscribeKiosk()</Mono>) and records the difference after every change, plus touch, drag
        and scroll listeners on the document (capture). A visit starts at the first touch or an order starting
        and ends at <Mono>restart(why)</Mono> (the store keeps <Mono>{'ended: { why, n }'}</Mono>; every caller
        passes its reason), or after 45 s untouched on the start screen. The visit being recorded is kept in{' '}
        <Mono>localStorage</Mono> <Mono>kiosk_journey_open</Mono> so a reload sends it as interrupted;
        finished visits wait in <Mono>kiosk_journeys</Mono> (up to 40 or 2.5M characters, oldest dropped) and go
        in batches of 5 (1.5M characters) to <Mono>POST /pos-api/kiosk/journeys</Mono> a second after a visit
        finishes, 5 s after the kiosk opens and every 60 s (kept on any other failure, so an offline kiosk sends them later). A 400 or 413 drops the batch (it would be refused again). Past 6000
        events a visit keeps only its view changes (<Mono>truncated</Mono>).
      </P>
      <P>
        Screens' own state that changes what the guest sees goes through{' '}
        <Mono>useJourneyState(key, init, {'{ save, load }'})</Mono> instead of <Mono>useState</Mono>: the
        dish being built (<Mono>dish.sel</Mono>, <Mono>dish.qty</Mono>), a combo's picks, page and opened steps
        (<Mono>combo.*</Mono>), option groups (<Mono>og.&lt;item&gt;.&lt;choice&gt;.&lt;depth&gt;</Mono>), the
        Start again and language sheets, the allergens sheet, the idle warning, the card step. Privacy: the
        kiosk's keyboard and number pad carry <Mono>data-jprivate</Mono>, so a touch there is recorded at the
        keyboard's middle with el <Mono>keyboard</Mono>; nothing typed is ever in a view.
      </P>
      <H3>Storing and summing up</H3>
      <P>
        <Mono>kiosk_sessions</Mono> (primary key tenant_id + id, forced RLS): venue, device, design and
        revenue stream (kept only when they are the tenant's, the stream also the venue's), started / ended,
        the summary columns (outcome, furthest, last_screen, order_no, check_id, total_pence,
        basket_value_pence, items_added, taps, dead_taps, lang, event_count, truncated), and{' '}
        <Mono>summary</Mono>, <Mono>names</Mono>, <Mono>viewport</Mono>, <Mono>events</Mono> (jsonb).{' '}
        <Mono>services/kioskJourneySvc.js</Mono>: <Mono>cleanVisit()</Mono> checks the shape (a ULID id,
        started within the last 31 days, at most 8000 events and 3M characters, times clamped into order, at
        most 6 hours), <Mono>saveVisits()</Mono> stores with <Mono>ON CONFLICT DO NOTHING</Mono> (a visit sent
        twice is stored once; the reply lists every id the kiosk may forget) and works the summary out itself
        with <Mono>summariseJourney()</Mono>. The device, venue and tenant come from the kiosk's pairing, never
        the body. The device route is kiosk only (403 for other kinds), 8 MB body, 60 a minute.{' '}
        <Mono>cleanUpJourneys()</Mono> (the hourly AI clean-up job): events cleared after 90 days
        (<Mono>events_cleared_at</Mono>), rows deleted after 400.
      </P>
      <DataTable
        head={['Function (shared/kioskJourney.js)', 'Does']}
        rows={[
          ['applyPatch() / diffView()', 'The view stream both ways.'],
          ['frameAt(events, t)', 'The view at a moment, the scroll places since the last screen or dish change, the viewport (with the recorded box, b) and the touches shortly before (the player draws them, and sends the box with kiosk.replay).'],
          ['journeySteps(events, names)', 'The visit as steps in words: opened a section or a dish, added / changed / removed / took off, left a dish without adding it, asked / answered "Still there?", asked to start again and kept ordering, card declined, order placed; touches (a touch is folded into the change it caused within 700 ms; a touch on nothing never is), typing on the keyboard and scrolling each folded into one step. Going back to the start screen clears the order without counting removals.'],
          ['summariseJourney(events, { names })', 'outcome, duration_ms, furthest (STAGES), last_screen, time per screen (a dish being built counts as its own screen, dish), sections, items (views, view time, adds, qty, removed, left), the order, first_add_ms, order_ms, cancels, taps, dead_taps, swipes, scrolls, languages, reach, allergens.'],
          ['aggregateJourneys(rows)', 'The overview: tiles, the funnel, outcomes, where guests gave up, time per screen, changes of mind, dishes, by hour, by kiosk.'],
        ]}
      />
      <H3>Report and playback API (/api/pos/kiosk-analytics, routes/kioskAnalytics.js)</H3>
      <DataTable
        head={['Route', 'Returns']}
        rows={[
          ['GET /venues/:venueId?from&to&device_id&design_id', 'The overview for the days in the venue\'s time (at most 92 days, 20,000 visits; truncated says when there were more), with the venue\'s kiosks and the designs.'],
          ['GET /venues/:venueId/sessions?...&outcome&limit&offset', 'The visits newest first without events; total from the same statement (count(*) OVER ()).'],
          ['GET /sessions/:id', 'One visit: session, summary, names, viewport, events, notes, and replay { url, design_id, design_name }: a kiosk preview link (previewToken(), menu live) with &replay=1 for the visit\'s design at its venue and stream, or the kiosk\'s design now when it was deleted; null when the events are cleared or no design is left.'],
        ]}
      />
      <H3>Playback</H3>
      <P>
        The kiosk app with <Mono>&amp;replay=1</Mono> boots with <Mono>bootReplay()</Mono> (no service worker,
        no recording, posted designs ignored) and <Mono>listenForReplay()</Mono>: the player posts{' '}
        <Mono>{'{ type: \'kiosk.replay\', view, scroll }'}</Mono>, the kiosk writes the view into its store
        (<Mono>replayView()</Mono>: the name and tent as dots), hands <Mono>ui:</Mono> values back through{' '}
        <Mono>useJourneyState()</Mono>, puts scroll boxes where they were, and answers{' '}
        <Mono>{'kiosk.replayed { missing }'}</Mono> (dishes no longer on the menu). Timers that would move the
        screen on by themselves (the order number countdown, the idle warning) check <Mono>s.replay</Mono>; a
        cover (<Mono>k-replay-cover</Mono>) takes every touch. The admin player
        (<Mono>pages/KioskAnalytics.jsx</Mono>: <Mono>VisitPlayer</Mono>, <Mono>KioskFrame</Mono>,{' '}
        <Mono>StepList</Mono>) scales the frame to the visit's viewport, posts a frame whenever the view or the
        scroll places change, draws touches in an SVG over it, and plays at 1x to 8x with long pauses (over
        2.5 s) shortened.
      </P>
    </section>
  )
}
