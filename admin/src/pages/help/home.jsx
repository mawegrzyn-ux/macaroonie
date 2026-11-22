// src/pages/help/home.jsx
// The Help page's "Home" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'home'
export const label = 'Home'
export const order = 15

export function Section() {
  return (
    <section id="home" data-help="">
      <H2>Home</H2>
      <P>
        <strong>Home</strong> is the first page you see after signing in, and the first link in the main menu.
        It is the place to start a shift: the ask bar, your pins, a hello with the day at a glance (bookings and covers,
        parties of 8 or more, how many people are on the rota, and whether the venue is closed today), then
        everything that needs doing at the venue, and the week ahead. Pick the venue at the top right if you
        work at more than one; the page remembers it.
      </P>
      <P>
        Everyone who signs in has Home, whatever their role: each person sees the tasks of the areas their
        role can open (the rest are named under the tasks, so nobody is told something is fine when it simply
        isn&apos;t theirs to see). The tiles that used to be the home page are on the <strong>Overview</strong>{' '}
        page (Home section of the menu), and an old link to the Today page opens Home.
      </P>
      <H3>The ask bar</H3>
      <P>
        The box at the top of Home finds a page or asks Pepper. Type a few letters or what you want to do
        (<strong>&ldquo;rota&rdquo;</strong>, <strong>&ldquo;fridge temperatures&rdquo;</strong>,{' '}
        <strong>&ldquo;change staff pay&rdquo;</strong>) and the pages that fit show straight away, with what
        each is for and where it sits in the menu, then any saved reports whose name fits. Tap one to open
        it. Finding a page this way never waits for Pepper and works with Pepper switched off.
      </P>
      <P>
        The last row is always <strong>Ask Pepper</strong> with your words. Tap it, tap{' '}
        <strong>Ask</strong>, or press <strong>Enter</strong> without picking a row, and Pepper opens at the
        side with a new chat that starts with your question. When Pepper answers with a page, it shows a
        card with the page&apos;s name, where it sits in the menu, the venue, day or tab it opens at, and{' '}
        <strong>Open</strong>. With a keyboard, the arrow keys move through the rows, Enter opens the one lit,
        and Escape clears the box. Under the bar, a few questions for the day (Brief me on today, What is
        booked for tonight?) ask Pepper in one tap.
      </P>
      <P>
        The same bar opens over any other page: tap <strong>Search or ask</strong> at the top of the menu (or
        the magnifying glass on the narrow menu), press <strong>Ctrl+K</strong> (Cmd+K on a Mac), or press{' '}
        <strong>/</strong> when you aren&apos;t typing in a box. On Home those keys go to the bar at the top of
        the page.
      </P>
      <H3>Your pins</H3>
      <P>
        Pins are your own shortcuts: the pages you open most, one tap away. Tap <strong>Pin a page</strong> (or{' '}
        <strong>Edit pins</strong> once you have some), then tap a page under <strong>Add a page</strong>; type a
        few letters in <strong>Find a page</strong> to narrow the list. You can pin up to 12 pages, and only pages
        in your own menu.
      </P>
      <P>
        A pin can open its page at one venue, and on pages with tabs at one tab: Rota at Ware, or Food safety on
        its Holds tab. Pick them in the pin&apos;s row; <strong>Any venue</strong> and <strong>First tab</strong>{' '}
        leave the page as it opens normally. Give a pin a name of your own in its <strong>Own name</strong> box, or
        leave it empty to use the page&apos;s name. Drag a row by its grip (the six dots) to change the order, and
        tap the cross to take a pin off. Nothing changes until you tap <strong>Save pins</strong>; Cancel leaves
        your pins as they were.
      </P>
      <InfoBox type="info">
        Pins are kept with your login, not in the browser, so the same pins show on the office computer, the
        tablet at the host stand and your phone&apos;s browser. Nobody else sees them, and nobody is told what
        you pinned. If your role loses a page, its pin stops showing.
      </InfoBox>
      <H3>This week: weather and local news</H3>
      <P>
        Under the tasks, <strong>This week</strong> shows the venue&apos;s next seven days from Local
        info. First a forecast for each day: the highest and lowest temperature, and the rain when there is
        1 mm or more; a day with a weather warning is red, one worth knowing about amber, and a day the
        forecast hasn&apos;t reached stays empty. Then up to five local news items (roadworks, events,
        incidents), the soonest first and the loudest first on the same day, each with when and where it is
        on and a <strong>Source</strong> link when it has one. <strong>3 more in Local info</strong> (or
        however many are left) opens the rest.
      </P>
      <P>
        Between the days and the news, <strong>Today by the hour</strong> shows the rest of today, from the
        hour before now: each hour&apos;s weather and temperature, with the chance of rain for the hours ahead
        (dashed) and how much fell for an hour already past (grey, recorded). Swipe it sideways for the
        evening.
      </P>
      <P>
        The forecast comes from the venue&apos;s Weather capture; the news from its other captures and the
        events your team types in, including those saved for every venue (Local info → Captures, Add an
        event). The card shows for people whose role can see Local info. When nothing is held for the week,
        people who can manage Local info get a line pointing at it and everyone else sees nothing. On the
        phone, the Today page shows the same card under the greeting.
      </P>
      <H3>Where the tasks come from</H3>
      <P>
        Tasks are worked out from your own set-up and records, not by Pepper, so the list is
        there even when Pepper is switched off. They update every minute and when you tap Refresh.
      </P>
      <DataTable
        head={['Task', 'Shows when']}
        rows={[
          ['Fridge and freezer check', 'A check time in Food safety settings has fridges not logged yet'],
          ['Hot and cold hold check', 'A hold check time has stations not logged yet'],
          ['Cooking checks', 'A cooking session has fewer checks than it needs'],
          ['Corrective action needed', 'A reading (fridge, hold, cooking or delivery) is out of range with no corrective action'],
          ['A checklist', 'A checklist due today, this week or this month is not finished'],
          ['H&S action', 'An open action log entry is due today or overdue'],
          ['Send the order to...', 'A supplier order is waiting to be sent (Late once the supplier\'s cutoff for its delivery day has passed)'],
          ['Book in the delivery from...', 'A supplier order sent earlier is due to arrive today, or its day has gone and it was never booked in (Late)'],
          ['Supplier orders waiting for approval', 'Someone asked for an order and you can approve orders'],
          ['Today\'s cash-up', 'The venue is open today; due when it closes (the latest doors close, else last orders, on the booking schedule). It goes once the day is submitted'],
          ['Cash-up for ... not submitted', 'Yesterday\'s cash-up isn\'t submitted (and the venue was open). Earlier days of the last week too, once the venue uses Cash Recon: a cash-up started or submitted on any day of this week or last'],
          ['Wages to pay for the week of ...', 'Last week\'s cash wages aren\'t all paid: what is due in cash (each total less what goes by bank) is more than what has been marked paid'],
          ['Online orders waiting', 'Online orders are waiting to be accepted'],
        ]}
      />
      <P>
        A task goes away by itself once the record exists: log the reading, tick the checklist, send the
        order. Closed days expect no fridge, hold or cooking checks when your group follows opening days
        in H&amp;S settings. You only see the areas your role can see; the page says which ones it left out.
      </P>
      <H3>Late, Now, Next and Later</H3>
      <DataTable
        head={['Group', 'Means']}
        rows={[
          ['Late', 'More than 30 minutes past its time, or overdue by nature (a reading needing an action, an earlier day\'s cash-up, last week\'s wages)'],
          ['Now', 'Due within 30 minutes either side, or due some time today with no set time'],
          ['Next', 'Due in the next two hours'],
          ['Later', 'Later today, or due this week or month'],
        ]}
      />
      <H3>Doing a task from the page</H3>
      <P>
        Each task has one button. Fridge, hold and cooking checks, checklists, cash-ups and wages open
        right on the page, the same forms as the Food safety, Checklists and Cash Recon pages: type the
        readings, tick the tasks or fill the day in, then tap <strong>Done</strong>. <strong>Open the full
        page</strong> takes you to the page itself. Other tasks (a supplier order, online orders) open their
        page. If your role can only view an area, the button says <strong>View</strong> and the form is read
        only.
      </P>
      <H3>Cash-ups and wages on Home</H3>
      <P>
        <strong>Do the cash-up</strong> (or <strong>Carry on</strong> for a day already started) opens the
        day&apos;s declaration: income, service charges and tips, takings, expenses, the wages paid that day
        and the notes, as on the Cash Recon day page. It saves as you go, and the foot of the window says
        whether it is saved. When the day is right, tap <strong>Submit</strong>: the task goes. An owner or
        admin sees <strong>Unsubmit</strong> instead once it is submitted. Submit only appears once the
        day&apos;s figures have loaded, so a quick tap can&apos;t save an empty day over them.
      </P>
      <P>
        <strong>Pay wages</strong> opens last week&apos;s wages list (who, the total, what was paid in cash and
        on which day, the notes), the same list as the Wages page. Mark what you hand over, or tap
        <strong> Pay everyone in full</strong>, then <strong>Save</strong>. The list saves only on Save: if you
        close it with changes not saved, it asks first (<strong>Keep editing</strong>,
        <strong> Close without saving</strong> or <strong>Save and close</strong>). The task goes once every
        cash wage is paid.
      </P>
      <P>
        On the phone, the Today page does the same, and <strong>Open the full page</strong> goes to the phone&apos;s
        Cash Up and Wages pages. The Cash Up and Wages tiles on the phone show how many of these are waiting.
        Doing a cash-up or paying wages needs Manage on Cash reconciliation; with View you can look but not
        change anything.
      </P>
    </section>
  )
}
