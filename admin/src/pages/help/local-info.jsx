// src/pages/help/local-info.jsx
// The Help page's "Local Info" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P } from './parts.jsx'

export const id = 'local-info'
export const label = 'Local Info'
export const order = 30

// ── LOCAL INFO ──────────────────────────────────
export function Section() {
  return (
    <section id="local-info" data-help="">
      <H2>Local Info</H2>
      <P>
        <strong>Local info</strong> (main menu, under Today) collects what's happening around your
        venues — the weather, roadworks and traffic, local events, and incidents — so a manager
        planning the week ahead (or looking back over last week) can see it in one place. Some of it
        is captured automatically on a schedule; anything else your team types in by hand.
      </P>
      <H3>The calendar and the list</H3>
      <P>
        The page shows a month calendar with a coloured chip per item (red = warning, amber = worth
        knowing, grey = info); on a phone the chips become dots. Tap a day to see everything on it —
        weather first, then incidents, traffic and events, loudest first. Switch to <strong>List</strong> for
        the same items day by day. Pick a venue at the top right, or <strong>Every venue</strong> to see
        the whole group; an item saved for every venue shows everywhere. Use the arrows to move
        between months and <strong>Today</strong> to come back: in the list it also scrolls to today.
        The list opens at today, and while you use the app the page remembers the month and where you
        had scrolled to, so coming back from another page lands where you were.
      </P>
      <H3>Captures</H3>
      <P>
        <strong>Captures</strong> sets up the automatic part, per venue. A <strong>Weather</strong> capture
        needs only a place ("Ware, Hertfordshire") and fills the next seven days from the Open-Meteo
        forecast, day by day and hour by hour — no account or key needed. Once a day or an hour has passed,
        the capture records the weather it had (Open-Meteo&apos;s figures for the venue&apos;s spot, from
        weather models run on what was observed, not a weather station on the street) and keeps what was
        forecast for it; each run reads the last seven days again too, so a weekly capture still records
        every day. A weather entry says <strong>Forecast</strong> until its day is over, then{' '}
        <strong>Recorded</strong> with <strong>Forecast was</strong> underneath, and{' '}
        <strong>By the hour</strong> opens its hours: recorded hours grey, forecast hours dashed with the
        chance of rain. A capture that runs every few hours keeps today&apos;s hours freshest. <strong>Traffic</strong>, <strong>Events</strong> and{' '}
        <strong>Incidents</strong> captures use Pepper's web search: give them a place, optionally one
        website to search (like your local paper) and words to look for, and they store what they find
        with a link to the source. Each capture runs once a day (in the early morning), every few hours,
        or once a week — your choice — and <strong>Run now</strong> runs it in the background straight
        away. If a run fails (a place the map doesn't know, or the search couldn't run), the reason shows
        on the capture's row and it tries again at its next scheduled time.
      </P>
      <H3>Your own events</H3>
      <P>
        <strong>Add an event</strong> records anything you know is coming: a street market, a festival,
        a planned road closure, an inspection. Give it a day (or a first and last day), an optional time,
        place, link (a web address starting with https://) and severity, and choose one venue or every venue. Typed-in events can be edited and
        deleted; captured items can't be edited — <strong>hide</strong> one instead and it stays hidden even
        when the capture runs again. <strong>Show hidden</strong> brings hidden items back into view so you
        can unhide them.
      </P>
      <H3>Deleting entries in bulk</H3>
      <P>
        Each capture in <strong>Captures</strong> has <strong>Delete future entries</strong>. Pick the first day
        (today at the earliest) and, if you like, a last day; leave it at <strong>No end</strong> for
        everything from that day on. Before you delete it counts what that capture found in those days: the
        entries that will be deleted, the ones people flagged as relevant or not (these are hidden instead, so
        Pepper keeps learning from the flags), and the ones someone already hid (these stay hidden, so the
        capture doesn't add them again). An entry counts by the day it starts. Tap <strong>Delete N
        entries</strong>, then <strong>Yes, delete</strong>. Past days are never touched. The capture's next run
        can find some of the same things again: turn the capture off first if you want them to stay gone.
        If another capture found the same event too (see The same event found more than once), deleting this
        capture's entry leaves the other capture's report on the calendar in its place, and the count says how
        many; this capture's reports that sit under another capture's entry are left as they are.
        You can also ask Pepper, for example "delete the traffic entries for Ware from next Monday" or
        "clear everything mentioning the marathon": it can pick a venue (or only the events saved for every
        venue), a capture, typed-in or captured entries, kinds, severities, words and days, and shows a card
        with how many and the first few before anything is deleted.
      </P>
      <H3>Relevant or not relevant</H3>
      <P>
        Everything a capture found (not the events you type in) has two buttons on its row: a thumbs up
        for <strong>Relevant</strong> and a thumbs down for <strong>Not relevant</strong>, each with how many of
        your team picked it. They're on the list, in the day window and on the dashboard widget; on a phone
        they show as the thumbs and their counts. Tap one to add your flag, tap it again to take it off, or
        tap the other to change your mind. Everyone has their own flag, so the counts are the team's view: a
        road closure across town that five people marked not relevant probably isn't. A flag changes nothing
        on the calendar (hide an item to take it out of view); it tells Pepper what your venue finds useful.
      </P>
      <H3>Saying why you flagged it</H3>
      <P>
        When you flag something, a box opens under the buttons asking why. Type a short reason (up to 200
        characters) and press <strong>Save note</strong>, or <strong>No note</strong> to leave it at the flag.{' '}
        <strong>Say why</strong> opens the box again later, and once you have a note the button reads{' '}
        <strong>Change your note</strong>: change the words, or empty the box and press{' '}
        <strong>Take the note off</strong>. Your note shows under the buttons as <strong>Your note</strong>;
        other people's notes show under it with their names. A note belongs to its flag: switch to the other
        thumb and the old note goes (the box opens again for the new reason), and taking your flag off takes
        the note with it. Like a flag, a note changes nothing on the calendar. Pepper reads the notes when it
        learns from the flags and gives a reason more weight than a thumb alone, so "too far away" or "our
        regulars go every year" tunes the search better than a flag with nothing said.
      </P>
      <H3>Pepper learns from the flags</H3>
      <P>
        For a <strong>Traffic</strong>, <strong>Events</strong> or <strong>Incidents</strong> capture, Pepper reads
        the flags on what it found and works out what its search should look for and what it should leave
        out (say, farmers markets in Ware yes, events in London no). It does this before the capture's next
        run whenever a flag was added, changed or taken off since it last learned, and the search then uses
        those words beside your own <strong>Also look for</strong> words, which always stay. In{' '}
        <strong>Captures</strong> each capture shows its flags and what Pepper learned (<strong>Looks
        for</strong>, <strong>Leaves out</strong>, and a sentence on why). <strong>Learn now</strong> does it
        straight away instead of waiting for the next run, and <strong>Forget what Pepper learned</strong>{' '}
        (it asks first) puts the search back to your own words until new flags come in. To keep a
        capture's search exactly as you set it, switch <strong>Learn from staff flags</strong> off in its
        Edit: the flags still show. If every flag on a capture is taken off, it forgets what it learned at
        its next run, and changing a capture's kind starts afresh. A weather forecast has no search to tune,
        so flags on the weather are only shown. Pepper reads the 60 most recently flagged findings; learning
        counts towards the group's Pepper allowance like the searches do (Learn now also towards your own
        daily share). If it couldn't learn before a run, the reason shows on the capture and the run goes
        ahead with what it learned before.
      </P>
      <H3>The same event found more than once</H3>
      <P>
        Different searches and websites often report the same thing in other words: "Ware Christmas lights
        switch-on", "Christmas lights in Ware" and "Festive lights night" can all be one evening. After each
        run of a <strong>Traffic</strong>, <strong>Events</strong> or <strong>Incidents</strong> capture (Run now
        included), Pepper compares what was just found with what the venue's captures of that kind already
        hold around the same days, and puts the reports of one event or incident together into one entry. The
        entry shows once on the calendar, the list, the widget and the Today page, with <strong>2 other reports
        of this</strong> under it: tap that to see each report as it was found, with its days, place and source
        link. Things that are only alike stay apart (two different markets, a quiz night held every week, two
        events at the same place), and so does anything more than a day apart.
      </P>
      <P>
        The report kept on show is the loudest (a warning before a notice), then the one that runs longest, then
        the first found. If someone hid one of the reports, the whole entry stays hidden. Flags on the reports
        move to the entry (each person's latest flag counts), and every capture with a report in it learns from
        them. A report shown under an entry can't be hidden, flagged or deleted on its own: change the entry
        instead. If Pepper put two different things together, open the reports and tap <strong>Not the
        same</strong> on the one that doesn't belong, then <strong>Yes, on its own</strong>: it becomes an entry
        of its own again and is never put together with anything after that (people with Local info Manage can
        do this). In <strong>Captures</strong>, each capture says how many of its findings sit under another
        entry; if Pepper couldn't compare after a run, the reason shows there, the run itself still counts, and
        whatever wasn't compared is looked at after the next run. Weather is never merged (each day's forecast
        is one entry already), and neither are the events you type in. Comparing counts towards the group's
        Pepper allowance like the searches do.
      </P>
      <H3>On dashboards</H3>
      <P>
        The <strong>Local info</strong> widget (Add widget, under Local info) shows the week ahead from the
        dashboard's selected day. Its options can flip it to <strong>Look back</strong> (the week up to the
        selected day — handy on a retrospective dashboard next to the cash and rota widgets) and hide any
        of the four kinds. The <strong>Today</strong> page shows the coming week for its venue under the
        greeting (see Today: This week). You can also ask Pepper things like "what's on around Ware this
        weekend?" — it reads the same items — or tell it to run a capture.
      </P>
      <H3>Who can do what</H3>
      <P>
        Local info is its own module in Access. <strong>View</strong> sees the calendar, list and widget and
        can flag what the captures found as relevant or not; <strong>Manage</strong> adds events, hides items,
        sets up captures, uses Learn now and Forget, and deletes entries in bulk. Captured searches count
        towards the group's monthly Pepper allowance (what Pepper reads and writes, plus 2,500 units for
        each web search it makes, up to five a run); the weather doesn't.
      </P>
    </section>
  )
}
