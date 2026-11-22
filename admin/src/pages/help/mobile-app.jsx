// src/pages/help/mobile-app.jsx
// The Help page's "Mobile App" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'mobile-app'
export const label = 'Mobile App'
export const order = 240

// ── MOBILE APP ──────────────────────────────
export function Section() {
  return (
    <section id="mobile-app" data-help="">
      <H2>Mobile App</H2>
      <P>
        Visit <strong>ops.macaroonie.com</strong> on a phone (signed in with your usual
        account) for a phone-sized version of the app, starting with the H&amp;S Dashboard.
        It's the same data and the same Tick all/log actions as the desktop page — just
        laid out in a single column for a phone screen instead of a resizable grid.
      </P>
      <H3>Installing it as an app</H3>
      <P>
        On <strong>ops.macaroonie.com</strong>, use your browser's <strong>Add to Home
        Screen</strong> (Safari: Share → Add to Home Screen; Android Chrome: menu → Add to
        Home screen or the install banner). It installs under its own name, <strong>
        Macaroonie Ops</strong>, with its own icon — separate from the main desktop app if
        you also have that installed — and opens straight into the mobile section, full
        screen, no browser address bar. Because it has its own address, Android installs it as
        a separate app too. The first time you open it you sign in again (and pick your
        restaurant, if you have more than one). If you installed it earlier from
        macaroonie.com/mobile, remove that icon and add it again from ops.macaroonie.com.
      </P>
      <P>
        The top bar shows the restaurant you&apos;re working in next to the page&apos;s title
        (<strong>Ops</strong> on the home screen). If your account is connected to more than one
        restaurant, the switch button (two arrows) next to sign out picks another; the page you
        were on opens again in that restaurant. The phone app keeps it until you switch again, and
        signing in again opens the restaurant you sign in to. The office and the phone app each
        remember their own choice, so switching on one doesn&apos;t switch the other.
      </P>
      <H3>Notices for tasks due and late</H3>
      <P>
        The <strong>Notices</strong> tile (and Settings → Notices in the office) turns on notices for the
        phone or computer you are using: <strong>Turn on notices here</strong>, then allow them when the
        browser asks. You get a notice when one of today&apos;s tasks is <strong>due soon</strong> (half an
        hour before a task with a time, like a fridge check) and when it goes <strong>late</strong> (a check
        missed, yesterday&apos;s cash-up not done), each once, and only for tasks you can do. Choose which
        venues and areas, switch due soon or late off, and set quiet hours (venue time) when nothing is
        sent; then <strong>Save</strong>. <strong>Send a test</strong> checks it works, and Your devices lists
        where notices go. Tapping a notice opens the Today page. On an iPhone, add the app to the home screen
        first: Safari only shows notices for an app on the home screen.
      </P>
      <H3>The Macaroonie Office app</H3>
      <P>
        <strong>Macaroonie Office</strong> is the phone app for Android (an iPhone version is planned). It
        shows the same phone pages, signs you in through the phone&apos;s browser (Google sign-in works),
        and adds what a web page can&apos;t do well: notices that always arrive, Pepper listening through the
        phone&apos;s own speech recognition, and a barcode scanner (the <strong>Scan</strong> button in a
        supplier order&apos;s Add an item). Turn notices on in its Notices page as above. It is a different
        app from Macaroonie Player, the app on tills, kitchen screens, kiosks and menu screens.
      </P>
      <P>
        More mobile-optimised pages will appear on the <strong>/mobile</strong> hub screen
        over time — it's a home screen of tiles, two to a row, one per available mobile module,
        with <strong>Pepper</strong> in a bar at the bottom (for people who can use it): type a
        question and tap Send, or hold the microphone, speak and let go. The Pepper page opens with your
        question sent in your current chat.
        <strong> Expenses</strong> is the second one: it shows a whole week (Monday to
        Sunday) of petty cash expenses, with the week's cash, card and VAT totals at the top.
        Use the arrows to move a week back or forward, tap the week to jump to any date, or
        <strong> Back to this week</strong>. Each day has its own <strong>Add</strong> button,
        and tapping an expense opens it to edit (snap a receipt photo with your phone's
        camera). Submitted days are marked and locked. <strong>Purchasing</strong> is the third: pick a
        list, fill in quantities and place the order, then send, print and book in deliveries, the
        same screens as the desktop Purchasing page. <strong>Cash Up</strong> is the fourth: a plain list of the
        week's days with status, income and variance at a glance — tap a day to open the
        full declaration, which also lists the <strong>wages paid today</strong> (they count in
        that day's variance; wages with no Paid on day only count in the week).{' '}
        <strong>Wages</strong> is the fifth: the week's wages list, one card per person with Total,
        Paid (tap <strong>Full</strong> to pay the cash part), Paid on and Notes. Typing a Paid
        amount or tapping Full sets Paid on to today when you're on this week. On the phone the
        Bank transfer column and Paid on for all are left out (a person paid partly by bank
        shows the bank amount under their name); use the desktop Wages page for those. Tap{' '}
        <strong>Save</strong> to keep changes.
      </P>
      <P>
        On the phone the <strong>H&amp;S Dashboard</strong> is for logging checks only: switch
        between your dashboards with the tabs (the small arrows scroll them when there are
        more), tick checklists and enter temperatures. Adding, removing and arranging widgets
        and dashboards is done on the H&amp;S Dashboard in the office admin. It shows any widget
        the dashboard holds, cash and rota ones included, with the same date bar as the desktop.
        The dashboards you make on the Dashboards page aren&apos;t on the phone.
      </P>
      <P>
        <strong>Today</strong> is the first tile: the same list as Home in the office
        (Late, Now, Next, Later) in one column. Fridge, hold, cooking and checklist tasks open
        their form right there; the rest open the phone&apos;s own page (Purchasing on the order,
        Cash Up, Online orders), or the office site when the phone has no page for it (the H&amp;S
        action log). The other tiles show how many things there are to do in their area today:
        a red number when one of them is late, amber otherwise. The numbers are for the venue
        picked on the Today page (its name shows on the Today tile when you have more than one).
      </P>
      <P>
        If you open the regular desktop admin portal on a phone held upright, you'll see a
        pop-up offering to switch to this mobile view — tap <strong>Open mobile
        view</strong> to jump straight there, or <strong>Stay on this page</strong> to keep
        using the desktop layout. It only offers once; dismissing it (either way) won't ask
        again on that phone.
      </P>
      <P>
        Beyond that one-time pop-up, whenever you're on a phone-sized screen you'll also see
        a small floating <strong>Mobile view</strong> button in the bottom-left corner of the
        regular desktop admin pages — tap it any time to jump to <strong>/mobile</strong>. The
        Ops app itself has no link back to the standard view: it's the phone app, and the full
        admin is at office.macaroonie.com.
      </P>
      <InfoBox type="tip">
        This is the same login and the same restaurant data as the desktop admin portal —
        there's nothing extra to set up. If you're not signed in, it takes you through the
        normal login first.
      </InfoBox>
    </section>
  )
}
