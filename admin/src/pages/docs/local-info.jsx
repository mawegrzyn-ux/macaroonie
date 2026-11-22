// src/pages/docs/local-info.jsx
// The Docs page's "Local info" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox } from './parts.jsx'

export const id = 'local-info'
export const label = 'Local info'
export const order = 360

export function Section() {
  return (
    <section id="local-info" data-doc="">
      <H2>Local info</H2>
      <P>
        Migration 240. Weather, traffic, events and incidents around the venues, captured on a schedule or
        typed in, shown on a month calendar or list at <Mono>/local-info</Mono> (main menu under Today), on a
        dashboard widget, and read by Pepper. Three tables, all with forced RLS: <Mono>local_info_sources</Mono>
        (a capture: venue, kind, place, site, query, frequency daily | hours | weekly with{' '}
        <Mono>every_hours</Mono>, <Mono>next_run_at</Mono>, <Mono>running_until</Mono> claim,{' '}
        <Mono>last_run_at</Mono> / <Mono>last_error</Mono>, the geocode cache <Mono>lat</Mono> /{' '}
        <Mono>lon</Mono> / <Mono>geocoded_place</Mono>, and since migration 248 what Pepper learned from staff
        flags: <Mono>learn_auto</Mono>, <Mono>learned</Mono>, <Mono>learned_at</Mono>, <Mono>flags_at</Mono>,{' '}
        <Mono>learn_error</Mono>), <Mono>local_info_items</Mono> (venue_id NULL = every
        venue; kind, title, details, <Mono>starts_on</Mono> / <Mono>ends_on</Mono> dates, time_text, place, url,
        severity info | notice | warning, <Mono>source_id</Mono> + <Mono>external_key</Mono> for captured rows
        with a partial-unique index, <Mono>hidden</Mono>) and <Mono>local_info_feedback</Mono> (migration 248:
        one flag per person per captured item, primary key <Mono>(item_id, user_sub)</Mono>,{' '}
        <Mono>relevant</Mono> true or false; a flag taken off is no row). One rules file, <Mono>shared/localInfo.js</Mono>:
        kinds, severities, frequencies, <Mono>nextRunAt()</Mono> (05:30 venue time for daily / weekly),{' '}
        <Mono>itemKey()</Mono>, the WMO weather maps (<Mono>weatherText()</Mono> / <Mono>weatherSummary()</Mono> /{' '}
        <Mono>weatherSeverity()</Mono>), <Mono>itemOnDay()</Mono>, <Mono>sortDayItems()</Mono>,{' '}
        <Mono>monthGrid()</Mono> and <Mono>weekAhead()</Mono> (the Today page&apos;s week, see Today). Which
        links may be opened is <Mono>webLink()</Mono> in <Mono>shared/links.js</Mono> (http or https, else null),
        also used for the page a review was recorded from.
      </P>
      <H3>Captures</H3>
      <P>
        <Mono>services/localInfoSvc.js</Mono>. Its own worker (<Mono>startLocalInfoWorker()</Mono> in{' '}
        <Mono>jobs/queues.js</Mono>, BullMQ queue <Mono>local-info</Mono>, every five minutes) calls{' '}
        <Mono>sweepLocalInfo()</Mono>:
        due, enabled sources are claimed across API processes (<Mono>claimDue()</Mono>,{' '}
        <Mono>running_until</Mono> + FOR UPDATE SKIP LOCKED) and run with <Mono>runClaimed()</Mono>, which
        always advances <Mono>next_run_at</Mono> and keeps a failure in <Mono>last_error</Mono> (so one bad
        place or search never wedges the schedule). <Mono>POST /sources/:id/run</Mono> claims one
        (<Mono>claimSource()</Mono>, 409 while a run holds it) and runs it unawaited. Weather:
        Open-Meteo, keyless — the place is geocoded once and cached on the source (re-asked when the place
        changes), then one call for the next seven days and the last seven (<Mono>WEATHER_PAST_DAYS</Mono>), daily
        and hourly, merged into each day&apos;s row with <Mono>mergeWeatherDay()</Mono> (<Mono>shared/localInfo.js</Mono>)
        and upserted one item per day. A day&apos;s <Mono>data</Mono>: the day (recorded once it is over, else the
        latest forecast), <Mono>recorded</Mono>, <Mono>forecast</Mono> (kept once recorded: the forecast as last
        read before the day was over, null for a day first read after it), <Mono>hours</Mono>{' '}
        (<Mono>{'[{ h, weather_code, temp, precip_mm, precip_prob, wind_kph, recorded, forecast }]'}</Mono>, an
        hour before now recorded with no chance of rain and the forecast it had) and <Mono>read_at</Mono>. The
        row&apos;s title, details and severity follow the day as known. On the page a weather entry says Forecast
        or Recorded (<Mono>WeatherTag</Mono>), Forecast was, and By the hour (<Mono>WeatherMore</Mono>,{' '}
        <Mono>HourStrip</Mono>); the Today page&apos;s <Mono>WeekAhead</Mono> shows today&apos;s hours from the hour
        before now (<Mono>hoursFrom()</Mono>), and Pepper&apos;s <Mono>local_info</Mono> says forecast or recorded,
        what was forecast, and the hours as lines when up to three days are asked. Searches (traffic,
        events, incidents): <Mono>searchForJson()</Mono> in <Mono>services/aiJson.js</Mono> runs Claude with
        the <Mono>web_search</Mono> server tool (pinned to the capture's site via{' '}
        <Mono>allowed_domains</Mono> when one is set), a JSON schema in the system text, and a{' '}
        <Mono>pause_turn</Mono> loop; findings are kept only with a title and a date between two weeks back
        and ninety days ahead, severity cleaned, non-http links dropped. Dedupe:{' '}
        <Mono>upsertItem()</Mono> ON CONFLICT (source_id, external_key) freshens details, place, url, days,
        time and severity but never <Mono>hidden</Mono> or the title — what an operator hid stays hidden
        through every later run. Deleting a capture deletes its items (FK cascade). Captured items can't be
        edited or deleted through the items routes (422: hide it, or change the capture).
      </P>
      <H3>Routes, page, widget, Pepper</H3>
      <P>
        <Mono>routes/localInfo.js</Mono> (<Mono>/api/local-info</Mono>, module <Mono>local_info</Mono>: view
        reads, manage changes): venue sources CRUD (site cleaned to a bare host, a changed capture runs again
        soon), <Mono>/items</Mono> (span filter over starts/ends, venue + group-wide rows, kinds,{' '}
        <Mono>include_hidden</Mono>, a range capped near a year), items POST / PATCH / DELETE (typed-in only;
        date columns read back through <Mono>dayOf()</Mono> — the date-column trap; a <Mono>url</Mono> must pass{' '}
        <Mono>webLink()</Mono>, since Zod&apos;s <Mono>url()</Mono> alone accepts javascript: and data: links).
        Admin:{' '}
        <Mono>pages/LocalInfo.jsx</Mono> (calendar from <Mono>monthGrid()</Mono>, day modal, list, Add an
        event, Captures window with Run now polling every 4 s) and{' '}
        <Mono>components/localInfo/shared.jsx</Mono> (<Mono>useLocalInfoItems()</Mono>,{' '}
        <Mono>ItemRow</Mono>, which links only what <Mono>webLink()</Mono> passes, <Mono>DayGroups</Mono>,{' '}
        <Mono>LocalInfoWidget</Mono>); the event window says why a link is refused (<Mono>li-ev-url-problem</Mono>)
        and keeps Add it off until it is a web address. The widget type{' '}
        <Mono>local_info</Mono> (group Local info, nav day) shows the week from the dashboard's selected day,
        with options look_back and hide per kind. Pepper: <Mono>ai/tools/localInfo.js</Mono> —{' '}
        <Mono>local_info</Mono> (read, two weeks ahead by default), <Mono>add_local_event</Mono> (confirm
        card) and <Mono>run_local_capture</Mono>; all on the staff connector too.
      </P>
      <H3>Relevant or not relevant, and learning from the flags</H3>
      <P>
        Migration 248. <Mono>PUT /items/:id/feedback</Mono> <Mono>{'{ relevant: true | false | null }'}</Mono>{' '}
        (Local info View: anyone who sees the page may flag) sets the person&apos;s own flag on a captured
        item: an upsert on <Mono>(item_id, user_sub)</Mono> that changes nothing when the flag is the same
        (<Mono>WHERE relevant IS DISTINCT FROM EXCLUDED.relevant</Mono>), null deletes the row, a typed-in event
        is a 422 and another group&apos;s item a 404. Only when a row really changed (<Mono>RETURNING</Mono>) and
        the item is of its capture&apos;s own kind is the capture stamped: <Mono>flags_at</Mono> from the
        API&apos;s clock, like <Mono>learned_at</Mono>, so the two compare. <Mono>listItems(..., {'{ userSub }'})</Mono>{' '}
        gives each captured item <Mono>feedback</Mono> <Mono>{'{ mine, relevant, not_relevant }'}</Mono> (null for a
        typed-in event) through a LATERAL count, and <Mono>itemFeedback()</Mono> is the same for one item (the
        PUT&apos;s answer). <Mono>sourcesOf()</Mono> gives each capture <Mono>flags</Mono> (its own kind&apos;s
        findings only) and <Mono>flags_changed</Mono> (<Mono>hasNewFlags()</Mono>&apos;s rule written in SQL).
        Admin: <Mono>FlagButtons</Mono> / <Mono>useItemFlag()</Mono> in <Mono>components/localInfo/shared.jsx</Mono>{' '}
        on every <Mono>ItemRow</Mono> (list, day window, widget; <Mono>li-flags</Mono> <Mono>data-mine</Mono>,{' '}
        <Mono>li-flag-yes</Mono> / <Mono>li-flag-no</Mono> with <Mono>aria-pressed</Mono> and{' '}
        <Mono>data-count</Mono>, <Mono>li-flag-error</Mono>), and on each capture in the Captures window its
        flags and what was learned (<Mono>li-cap-flags</Mono>, <Mono>li-cap-learned</Mono>,{' '}
        <Mono>li-cap-learned-what</Mono>, <Mono>li-cap-learned-nothing</Mono>, <Mono>li-cap-new-flags</Mono>,{' '}
        <Mono>li-cap-learn-error</Mono>, <Mono>li-cap-learn-off</Mono>), Learn now (<Mono>li-cap-learn</Mono>),
        Forget asking first (<Mono>li-cap-forget</Mono>, <Mono>-yes</Mono>, <Mono>-no</Mono>), the Edit
        window&apos;s Learn from staff flags (<Mono>li-cap-learn-auto</Mono>) and View&apos;s note{' '}
        <Mono>li-flag-note</Mono>.
      </P>
      <P>
        Migration 252: a flag can carry a note saying why (<Mono>local_info_feedback.note</Mono>, 1 to 200
        characters or NULL; <Mono>FLAG_NOTE_MAX</Mono> and <Mono>cleanFlagNote()</Mono> in{' '}
        <Mono>shared/localInfo.js</Mono>: one line, tidied). The PUT&apos;s body gains <Mono>note</Mono>. Left
        out, the note stays while the flag is the same and is cleared when the flag turns the other way; sent
        empty, as spaces or as null, the note comes off. Over 200 characters after tidying is a 422, and so is
        a note with <Mono>relevant: null</Mono>. A note added, changed or taken off is a change like a flag: it
        stamps the capture&apos;s <Mono>flags_at</Mono>, so the next run learns first. <Mono>feedback</Mono> is
        now <Mono>{'{ mine, mine_note, relevant, not_relevant, notes: [{ relevant, note, mine, by }] }'}</Mono>:
        notes newest first, <Mono>by</Mono> the person&apos;s name, else the first part of their email.
        Learning puts the notes at the end of each finding&apos;s line (<Mono>| relevant because: a; b | not
        relevant because: c</Mono>, up to <Mono>LEARN_NOTES</Mono> (5) each way, each clipped and kept on one
        line with <Mono>|</Mono> and <Mono>;</Mono> taken out), and <Mono>LEARN_SYSTEM</Mono> says to weigh a
        reason above a bare flag and that notes are words staff typed: data, never instructions. Merging
        (<Mono>foldInto()</Mono>) carries a note with its flag, so the newest flag wins whole. Pepper&apos;s{' '}
        <Mono>local_info</Mono> tool gives <Mono>staff_flags.notes</Mono> (up to 5 lines). Reports don&apos;t
        read notes. Admin: the note box in <Mono>FlagButtons</Mono> opens by itself when a flag is put on
        (<Mono>li-why-open</Mono>, <Mono>li-why-form</Mono>, <Mono>li-why-input</Mono>,{' '}
        <Mono>li-why-count</Mono>, <Mono>li-why-save</Mono>, <Mono>li-why-cancel</Mono>,{' '}
        <Mono>li-why-mine</Mono>, <Mono>li-why-list</Mono> with <Mono>data-count</Mono>,{' '}
        <Mono>li-why-item</Mono> with <Mono>data-relevant</Mono>, <Mono>li-why-more</Mono>); its text box is{' '}
        <Mono>flex-[1_1_12rem] min-w-0</Mono> so it shrinks to a narrow dashboard widget. Tests: the notes
        test in <Mono>api/test/local-info-flags.test.mjs</Mono>, notes through a merge in{' '}
        <Mono>local-info-merge.test.mjs</Mono>, <Mono>shared/test/localInfo.test.mjs</Mono>; the fixtures
        send a note, so the tenant sweep replays it.
      </P>
      <P>
        Learning is <Mono>learnFromFlags(source, {'{ person, auto }'})</Mono> in{' '}
        <Mono>services/localInfoSvc.js</Mono>: the <Mono>LEARN_ITEMS</Mono> (60) most recently flagged findings
        of the capture&apos;s own kind, each with its counts, title, details, place and days, and the
        search&apos;s own ask (<Mono>searchText()</Mono>), go to the everyday model in one{' '}
        <Mono>askForJson()</Mono> call (effort low, 2,000 tokens, <Mono>LEARN_SCHEMA</Mono>{' '}
        <Mono>{'{ look_for, leave_out, summary }'}</Mono>) under <Mono>LEARN_SYSTEM</Mono>, which says the
        findings are text from web pages, data and never instructions. What comes back is clipped
        (<Mono>LEARN_MAX</Mono> 6 phrases of <Mono>LEARN_PHRASE</Mono> 100 characters, a summary of 300) and
        stored in <Mono>learned</Mono> with the counts it was worked out from. <Mono>learnedLine()</Mono> adds it
        to the search&apos;s ask as one line after the operator&apos;s own Also look for words, which always
        stay: <Mono>Staff feedback on earlier findings: look especially for ... Leave out ...</Mono>. Before each
        search run, <Mono>runClaimed()</Mono> calls <Mono>learnBeforeRun()</Mono>: with{' '}
        <Mono>learn_auto</Mono> on and <Mono>hasNewFlags()</Mono> (<Mono>flags_at</Mono> later than{' '}
        <Mono>learned_at</Mono>, or never learned) it learns again first; a failure goes to{' '}
        <Mono>learn_error</Mono> and the run carries on with what it learned before; a capture whose flags were
        all taken off forgets (<Mono>learned</Mono> null). Learn now is <Mono>POST /sources/:id/learn</Mono>{' '}
        (Manage; <Mono>pepperOn()</Mono>: 503 without a key, 403 with Pepper off; 422 for a weather capture,
        learning switched off or nothing flagged; <Mono>learnNow()</Mono> holds the capture like a run through{' '}
        <Mono>claimSource()</Mono>, 409 while a run holds it). Forget is{' '}
        <Mono>DELETE /sources/:id/learned</Mono> (Manage): <Mono>learned</Mono> null and{' '}
        <Mono>learned_at</Mono> now, so it learns again only once flags change after. A capture changed to
        another kind starts afresh (<Mono>learned</Mono>, <Mono>learned_at</Mono>, <Mono>learn_error</Mono> and{' '}
        <Mono>flags_at</Mono> cleared). Learning before a run counts the group&apos;s monthly allowance with no
        person, as the search does; Learn now also the person&apos;s daily share. Pepper&apos;s{' '}
        <Mono>local_info</Mono> tool gives each captured item <Mono>staff_flags</Mono> and each capture what it
        learned. Reports: <Mono>local.items</Mono> has <Mono>flagged_relevant</Mono> and{' '}
        <Mono>flagged_not_relevant</Mono> (counts that add up, so a capture&apos;s findings can be totalled
        through its <Mono>items</Mono> link) and <Mono>local.captures</Mono> has <Mono>learns</Mono>,{' '}
        <Mono>learned</Mono> (the summary), <Mono>learned_at</Mono> and <Mono>learn_problem</Mono>. Tests:{' '}
        <Mono>api/test/local-info-flags.test.mjs</Mono>.
      </P>
      <H3>Deleting entries in bulk</H3>
      <P>
        <Mono>POST /api/local-info/items/delete</Mono> (Local info Manage) with{' '}
        <Mono>{'{ from?, until?, venue_id?, group_wide?, source_id?, origin: any | typed | captured, kinds?, severities?, words?, dry_run }'}</Mono>.
        Every criterion given must hold; an entry is in the days when it <em>starts</em> in them (an event
        running since last week isn&apos;t). <Mono>from</Mono> defaults to today and can&apos;t be before it:{' '}
        <Mono>earliestToday()</Mono> is the venue&apos;s own day (the capture&apos;s venue when only{' '}
        <Mono>source_id</Mono> is given), else the earliest day at any of the group&apos;s venues, so a day that
        is still today somewhere counts (422 with the day). <Mono>venue_id</Mono> touches only that venue&apos;s
        own entries, <Mono>group_wide</Mono> only the whole group&apos;s, both together is a 422;{' '}
        <Mono>words</Mono> (100 characters) is matched in the title, details and place with{' '}
        <Mono>ILIKE</Mono>, <Mono>%</Mono> / <Mono>_</Mono> / backslash escaped. What happens to each entry is{' '}
        <Mono>deleteAction()</Mono>: a typed-in event is deleted; a captured finding someone hid is kept (the
        hidden row is what stops its capture adding it again: the capture&apos;s upsert never un-hides); a
        captured finding people flagged, of its capture&apos;s own kind and not a forecast, is hidden instead
        (its flags keep teaching the capture, <Mono>learnFromFlags()</Mono> reads hidden findings too); every
        other captured row is deleted (its flags go with it, <Mono>ON DELETE CASCADE</Mono>). Only entries are
        looked at (<Mono>merged_into IS NULL</Mono>, migration 249): the reports inside a deleted entry go with
        it by the same cascade, except that with a <Mono>source_id</Mono> the reports other captures found are
        handed over: the first of them (<Mono>captured_at</Mono>, then id) becomes the entry and the rest point
        at it, under <Mono>lockMerges()</Mono>; this capture&apos;s own reports inside other captures&apos;
        entries are left alone. The answer, dry run or not, is{' '}
        <Mono>{'{ dry_run, today, from, until, deleted, hidden, kept, handed_over, examples }'}</Mono>
        (<Mono>handed_over</Mono>: the entries whose other reports stay), the first{' '}
        <Mono>DELETE_EXAMPLES</Mono> (10) entries that change with their <Mono>action</Mono>. A capture
        deleted entries can find again on its next run (the next weather run fills its days in again).
        Admin: each capture&apos;s <Mono>Delete future entries</Mono> in the Captures window
        (<Mono>ClearFuturePart</Mono> in <Mono>pages/LocalInfo.jsx</Mono>: <Mono>li-cap-clear</Mono>,{' '}
        <Mono>li-cap-clear-panel</Mono>, <Mono>li-cap-clear-from</Mono> (today at the venue at the earliest),{' '}
        <Mono>li-cap-clear-until</Mono> / <Mono>li-cap-clear-no-end</Mono>, a dry run on every change{' '}
        (<Mono>staleTime: 0</Mono>) into <Mono>li-cap-clear-count</Mono> <Mono>data-deleted</Mono>{' '}
        <Mono>data-hidden</Mono> <Mono>data-kept</Mono> <Mono>data-handed-over</Mono>, <Mono>li-cap-clear-go</Mono> then{' '}
        <Mono>li-cap-clear-sure</Mono> with <Mono>-yes</Mono> / <Mono>-no</Mono>, <Mono>li-cap-clear-cancel</Mono>,{' '}
        <Mono>li-cap-clear-error</Mono>). Pepper: <Mono>delete_local_info</Mono> in{' '}
        <Mono>ai/tools/localInfo.js</Mono> (Manage, a confirm card): a venue by name, the whole group, a capture
        by name (<Mono>captureFor()</Mono>: its kind, place, site or query), and the same criteria;{' '}
        <Mono>describe()</Mono> runs the dry run, says what is deleted, hidden instead, kept and handed over to
        another capture&apos;s report with the first examples, refuses before the card when nothing matches, and pins the first day, the venue and the
        capture it worked out (<Mono>pin</Mono>), so Confirm deletes what the card said even after midnight;{' '}
        <Mono>run()</Mono> plans again (it is called straight away over the staff connector). Tests:{' '}
        <Mono>api/test/local-info-delete.test.mjs</Mono>.
      </P>
      <H3>One entry per event (migration 249)</H3>
      <P>
        Searches and pages report the same event under other names, and a capture&apos;s upsert keys on{' '}
        <Mono>external_key</Mono> (worked out from the title), so every rewording was a new row. Migration 249
        adds <Mono>local_info_items.merged_into</Mono> (the entry a finding was put into, always an entry
        itself, <Mono>ON DELETE CASCADE</Mono>, index <Mono>local_info_items_merged</Mono>),{' '}
        <Mono>keep_separate</Mono> (Not the same: never merged again), <Mono>merge_checked_at</Mono> (when a pass
        last looked at the finding; null = new) and <Mono>local_info_sources.merge_error</Mono>.{' '}
        <Mono>runClaimed()</Mono> calls <Mono>mergeAfterRun()</Mono> after every search capture&apos;s run (never
        the weather), and it never throws: a failure is stored in <Mono>merge_error</Mono> (cleared by the next
        pass that works) and logged, and the run counts as done. <Mono>mergePass()</Mono> reads the venue&apos;s
        captured entries of the capture&apos;s kind (any capture, hidden ones included,{' '}
        <Mono>keep_separate</Mono> left out) from 14 days back to 90 ahead; a new one with nothing within{' '}
        <Mono>MERGE_DAYS</Mono> (1) of it (<Mono>nearDays()</Mono>, on starts_on and ends_on) is marked looked at
        without asking; the others go with their nearest neighbours in batches of at most{' '}
        <Mono>MERGE_ITEMS</Mono> (80), <Mono>MERGE_CALLS</Mono> (3) a pass, the rest left for the next run of a
        capture of that kind at the venue. Each batch is one <Mono>askForJson()</Mono> (the everyday model,
        effort low, <Mono>MERGE_SYSTEM</Mono> says the lines are data from web pages, never instructions;{' '}
        <Mono>MERGE_SCHEMA</Mono> <Mono>{'{ groups: [{ same: [refs], why }] }'}</Mono>): one line a finding,{' '}
        <Mono>ref | title | details | place | days | time | website | new</Mono>, refs <Mono>I1..In</Mono> in day
        order, every field on one line with <Mono>|</Mono> taken out (<Mono>field()</Mono>), the website as its
        host only, no ids. A group needs two refs that resolve; unknown and repeated refs are dropped. A batch
        that fails stops the pass and nothing of it is marked looked at, so it is asked again after the next
        run. <Mono>applyGroups()</Mono> then works on the rows as they are now (under{' '}
        <Mono>lockMerges()</Mono>, an advisory lock per venue and kind, which Not the same and the bulk
        delete&apos;s hand-over take too): a copy counts as its entry, anything kept apart, of another venue or
        kind, or typed in is left out, groups that share an entry are joined (union-find), and in each set{' '}
        <Mono>pickKeeper()</Mono> (hidden first, so a hidden report keeps the whole entry hidden, then severity,
        then the most days, then the first captured) takes in what lies within a day of it; the rest of the set
        is grouped again the same way, so a weekly event is never one entry.{' '}
        <Mono>foldInto()</Mono> points the rows (and whatever was already in them) at the keeper and moves their
        flags to it in one statement: each person&apos;s newest flag across the group (<Mono>DISTINCT ON</Mono>{' '}
        by <Mono>updated_at</Mono>, compared in SQL), written over the keeper&apos;s only when newer and
        different; then it stamps <Mono>flags_at</Mono> on every capture in the group when the keeper&apos;s own
        flags changed, else on the folded findings&apos; captures when either side had flags, so learning
        follows the flags. Readers: <Mono>listItems()</Mono> lists entries only, each captured one with{' '}
        <Mono>also</Mono> (its reports oldest first: id, source_id, title, details, place, url, days, time,
        severity); the sources route&apos;s flag counts go through the entries and add{' '}
        <Mono>merged</Mono> (how many of the capture&apos;s findings sit in another entry);{' '}
        <Mono>learnFromFlags()</Mono> reads each finding&apos;s entry&apos;s flags; the weather subject, Today
        and the dashboard widget read through <Mono>listItems()</Mono> or leave copies out. A copy refuses PATCH,
        flags and DELETE (422, <Mono>MERGED_COPY</Mono>: change the entry, or say it isn&apos;t the same).{' '}
        <Mono>POST /api/local-info/items/:id/separate</Mono> (Local info Manage) makes a copy its own entry
        again: <Mono>merged_into</Mono> null, <Mono>keep_separate</Mono> true, looked at now; the flags stay on
        the entry, and its capture learns again when the entry had flags; 422 for an id that isn&apos;t a copy.
        Admin: <Mono>AlsoReported</Mono> in <Mono>components/localInfo/shared.jsx</Mono> under an entry on the
        list and in the day window (<Mono>li-also</Mono> <Mono>data-count</Mono>, <Mono>li-also-toggle</Mono>{' '}
        <Mono>aria-expanded</Mono>, <Mono>li-also-list</Mono>, <Mono>li-also-item</Mono> <Mono>data-id</Mono>,
        with <Mono>canSeparate</Mono>: <Mono>li-also-separate</Mono>, <Mono>li-also-sure</Mono>,{' '}
        <Mono>li-also-separate-yes</Mono> / <Mono>-no</Mono>, <Mono>li-also-error</Mono>), the widget&apos;s count
        (<Mono>li-also-count</Mono>), and in the Captures window <Mono>li-cap-merged</Mono>{' '}
        <Mono>data-count</Mono> and <Mono>li-cap-merge-error</Mono>. Pepper: <Mono>local_info</Mono> gives an
        entry&apos;s <Mono>also_reported_as</Mono> (up to five: title, day, url) and a capture&apos;s merge
        problem. Reports: <Mono>local.items</Mono> lists entries only, with <Mono>other_reports</Mono> (Other
        reports of it) and <Mono>kept_apart</Mono> (Kept apart); <Mono>local.captures</Mono> has{' '}
        <Mono>merge_problem</Mono>; the weather subject leaves copies out. Tests:{' '}
        <Mono>api/test/local-info-merge.test.mjs</Mono> (against a stand-in Claude).
      </P>
      <InfoBox title="Limits">
        Scheduled search runs count the group's monthly Pepper allowance with no person (<Mono>addUsage()</Mono>{' '}
        person null); a Run now from the page counts the same way. Since migration 242 the searches
        themselves count too (<Mono>searches: searchesIn(u)</Mono>: 2,500 units each, up to five a run, and{' '}
        <Mono>ai_usage.web_searches</Mono>); before, only the tokens did. Captures don&apos;t need the
        group&apos;s web search switch, which is for Pepper&apos;s chat. The web search is tested only against a
        stand-in Claude (the exact server-tool block shapes): first live use, run a capture and check the
        findings and <Mono>last_error</Mono>. Open-Meteo's free API is for non-commercial use — before real
        franchisees rely on the weather, buy an Open-Meteo API plan and save its key on the Platform page
        (Services tab, 22 Nov 2026: <Mono>services/weatherKey.js</Mono>, sealed in <Mono>platform_secrets</Mono>{' '}
        as <Mono>open_meteo_key</Mono>, checked with one call before saving, <Mono>GET/PUT/DELETE
        /api/platform/weather-key</Mono>); with a key the captures go to Open-Meteo&apos;s customer hosts with{' '}
        <Mono>apikey</Mono> (<Mono>meteoUrl()</Mono>; a stand-in host set in the two URL env vars is kept). Searches store what the
        model read on a page: dates can be wrong or stale, which is why every captured item keeps its source
        link and can be hidden. No push or alerting; the calendar is pull-only. Flags (migration 248) change
        nothing on the calendar, and what Pepper learns is words added to the search&apos;s ask, not a filter:
        a later run can still find something staff flagged not relevant. Learning reads at most the 60 most
        recently flagged findings, weighs every person&apos;s flag the same, and is tested only against a
        stand-in Claude: first live use, flag a few findings, press Learn now and read what it says before
        the next run. Flags on weather forecasts are only shown (a forecast has no search to tune). Bulk delete
        never touches the past, and a capture&apos;s next run can bring back what it deleted: to keep a
        finding off for good, hide it (or turn the capture off first). Merging (migration 249) is only as good
        as Pepper&apos;s reading of a few words per finding: it can miss a repeat worded very differently or, now
        and then, put two different things together (Not the same undoes that for good). It compares a finding
        only with others of the same kind at the same venue within a day of it, never typed-in events or the
        weather, and there is no way to put two entries together by hand. Not the same is for one report and
        lasts for ever (it isn&apos;t per pair). Delete future entries leaves the capture&apos;s own reports that
        sit inside another capture&apos;s entry. Merging is tested only against a stand-in Claude: first live
        use, run two captures of one kind at a venue and look at what was put together.
      </InfoBox>
      <H3>The list: Today and the kept place</H3>
      <P>
        <Mono>LocalInfo.jsx</Mono> keeps the month (<Mono>maca_local_info_month</Mono>) and the scroll place
        (<Mono>maca_local_info_scroll</Mono>, with its month and view) in sessionStorage: the visit only. The pane{' '}
        (<Mono>li-pane</Mono>) is restored once per mount, after the items and the permissions load (the View
        notice above the list goes when they do, and scroll anchoring would move the place by its height); a
        clamp is retried a few frames while saving is held off. <Mono>li-today</Mono> goes to this month and, in
        the list, scrolls to the first day on or after today; another month starts at the top.
      </P>
    </section>
  )
}
