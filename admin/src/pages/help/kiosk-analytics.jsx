// src/pages/help/kiosk-analytics.jsx
// The Help page's "Kiosk analytics" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'kiosk-analytics'
export const label = 'Kiosk analytics'
export const order = 410

// ── KIOSK ANALYTICS ───────────────────────────────
export function Section() {
  return (
    <section id="kiosk-analytics" data-help="">
      <H2>Kiosk analytics</H2>
      <P>
        Every kiosk records each guest&apos;s visit as it happens: which screens they saw and for how long, every
        dish they opened, what they picked and changed, what they took out of the order, where they touched
        (including touches on things that don&apos;t answer), and how the visit ended. <strong>Store tech → Kiosk
        analytics</strong> sums the visits up and plays any visit back, step by step, on the kiosk itself. It needs
        Till reports (View); operators have it, viewers don&apos;t.
      </P>
      <InfoBox type="info">
        Nothing a guest types is recorded: a name or tent number is kept only as how many letters it had (it plays
        back as dots), and touches on the kiosk&apos;s keyboard and number pad are recorded at the keyboard&apos;s
        middle, not on the key. Visits aren&apos;t linked to a card, a customer or a person.
      </InfoBox>

      <H3>What counts as a visit</H3>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>A visit starts with the first touch on the start screen and ends when the kiosk goes back to it: after the order number screen, <strong>Start again</strong>, the &quot;Still there?&quot; timeout, or 45 seconds without a touch on the start screen (a guest who touched and walked away).</li>
        <li>How it ended: <strong>Ordered</strong>, <strong>Started again</strong>, <strong>Timed out</strong>, <strong>Walked away</strong>, or <strong>Cut short</strong> (the kiosk was reloaded, switched off or updated mid-visit; the visit is kept up to that point).</li>
        <li>The kiosk sends finished visits within a minute, and keeps them while it is offline (up to about 40) to send when it is back. Previews, shared preview links and the design editor are never recorded.</li>
        <li>To stop a design&apos;s kiosks recording, switch off <strong>Record guests&apos; visits</strong> in the design&apos;s <strong>Timing and access</strong> panel (on unless you turn it off).</li>
      </ul>

      <H3>The analytics overview</H3>
      <P>
        Pick <strong>Today</strong>, <strong>7 days</strong>, <strong>30 days</strong> or your own days (up to 92),
        and optionally one kiosk or one design. Days follow the venue&apos;s time.
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Tiles</strong>: visits, how many ordered (and the share of visits), orders taken and the average order, how long ordering takes, visits that gave up with something in the order (and what was left in it), touches per visit (and the share on things that don&apos;t answer: a button that looks tappable but isn&apos;t), and how many used the allergens screen and the reach button.</li>
        <li><strong>How far guests got</strong>: touched the screen, opened the menu, opened a dish, added to the order, looked at the order, name or number, paying, ordered. The biggest drop shows where guests stop.</li>
        <li><strong>How visits ended</strong>, and for those that gave up, the screen they were on last.</li>
        <li><strong>Time on each screen</strong>: the average time on the start screen, the menu, choosing a dish (a dish&apos;s page or a meal deal&apos;s steps), the order, paying and so on, over the visits that saw it.</li>
        <li><strong>Changes of mind</strong>: started again, timed out, dishes opened and left without adding, dishes taken out of the order, &quot;Start again?&quot; asked and how often the guest kept ordering, &quot;Still there?&quot; asked and answered, cards declined, card machine not available.</li>
        <li><strong>Dishes</strong>: per dish, how often it was opened, how long guests looked at it, how often it was added (and how many), taken out, or left without adding. A dish opened often and rarely added is worth a look (its picture, its price, its options).</li>
        <li><strong>By hour</strong> (visits and orders) and <strong>By kiosk</strong>.</li>
      </ul>

      <H3>Playing a visit back</H3>
      <P>
        The <strong>Visits</strong> tab lists visits newest first, with the kiosk, how it ended, how long it took,
        the order (or what was left in it) and the touches; filter by how it ended. Tap a visit to play it back: the
        kiosk is shown as the guest saw it (with the design and menu), each touch as a ring where the finger landed
        (red: a touch on nothing that answers), scrolling put back where the guest scrolled.
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Play</strong> / <strong>Pause</strong>, the slider to jump to any moment, step back and forward, speeds 1x to 8x, and <strong>Skip long pauses</strong> (on unless you untick it: a pause of more than a couple of seconds plays as a short one).</li>
        <li>The <strong>Steps</strong> list says what happened in words (&quot;Opened Wings&quot;, &quot;Touched Lemon pepper&quot;, &quot;Added 2 x Wings&quot;, &quot;Removed Fries&quot;, &quot;Left Burger without adding it&quot;, &quot;Touched nothing that answers&quot;, &quot;Typed on the keyboard&quot;), with the time and how long the guest stayed on each step. Tap a step to jump there.</li>
        <li><strong>This visit</strong> sums it up: how it ended, the order, dishes added, when the first dish was added, touches, the language.</li>
        <li>The playback uses the design and the menu as they are now: a note says when the design has changed since the visit (or was deleted: the kiosk&apos;s design now is used). Dishes and prices show as the menu is now: a dish taken off the menu since doesn&apos;t show in the playback (a note under it says so), but the steps still name it.</li>
        <li>The playback can&apos;t be touched and never sends anything. Visits are played back for 90 days; after that only their summary (in the list and the overview) is kept, for 400 days.</li>
      </ul>
    </section>
  )
}
