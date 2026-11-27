// src/pages/help/menu-engineering.jsx
// The Help page's "Menu engineering and scenarios" section (inventory phase
// 7a, 27 Nov 2026): Menu margins' Engineering tab (stars, plough-horses,
// puzzles and dogs from what sold) and Scenarios tab (price and cost changes
// at the real mix, Push prices into a menu's draft), Pepper and the reports.
// Help.jsx gathers every file in this folder (except parts.jsx) and shows them
// by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'menu-engineering'
export const label = 'Menu engineering and scenarios'
export const order = 376

export function Section() {
  return (
    <section id="menu-engineering" data-help="">
      <H2>Menu engineering and scenarios</H2>
      <P>
        Two tabs of <strong>Menu margins</strong> (main menu, under Stock) help you decide prices and what stays on
        the menu, from what your guests really buy: <strong>Engineering</strong> sorts each menu section&apos;s dishes
        into four kinds, and <strong>Scenarios</strong> lets you try price and cost changes and see what they would
        do to your cost % and gross profit before you change anything.
      </P>
      <H3>Engineering: stars, plough-horses, puzzles and dogs</H3>
      <P>
        Pick a venue (or every venue), a menu (or every menu) and the days (the last 28 days to yesterday at first;{' '}
        <strong>This month</strong> and <strong>Last 28 days</strong> are one tap). Each section&apos;s dishes are
        judged against the other dishes of the same section on two things, from what really sold:
      </P>
      <DataTable
        head={['', 'Sells well (popular)', 'Sells little']}
        rows={[
          ['Earns at least the section\'s average per sale (profitable)', 'Star: keep it as it is and give it the best place on the menu', 'Puzzle: move it up the menu, rename or describe it better, or have staff suggest it'],
          ['Earns less', 'Plough-horse: look at its cost or its price (a cheaper ingredient, a smaller portion, a small rise)', 'Dog: consider taking it off, or rework it'],
        ]}
      />
      <P>
        <strong>Popular</strong> means the dish&apos;s share of the section&apos;s units sold is at least 70% of an
        equal share: in a section of five dishes an equal share is 20%, so a dish is popular from 14%.{' '}
        <strong>Profitable</strong> means its gross profit per unit (what it took net of VAT and discounts, less what
        its recipe cost) is at least the section&apos;s average gross profit per unit sold. Pounds of margin decide it;
        the cost % is shown beside them.
      </P>
      <P>
        The <strong>four boxes</strong> chart shows one section at a time: across, the dish&apos;s share of the
        section&apos;s units; up, its gross profit per unit; the dashed lines are the popularity share and the
        section&apos;s average. Tap a dot (or a row of the table) to see the dish&apos;s figures and what to do. Pick
        another section above the chart. Each section&apos;s table lists every dish with its kind, units, share, GP per
        unit, total GP and cost %.
      </P>
      <InfoBox>
        A <strong>meal deal</strong> counts as one dish of the section it sits in, by the deals sold: its gross profit is
        what the deal took less the cost of the dishes picked in it. The burger picked inside a deal adds nothing to
        your Mains: the till sold a deal. Units that couldn&apos;t be costed (a dish with no recipe, an option with no
        rule, an item with no price) count for popularity but are left out of gross profit, never counted as free: a
        dish none of whose units could be costed shows as <strong>Not costed</strong> and isn&apos;t on the chart.
        Open items typed in on the till, services and dishes no longer on a menu aren&apos;t engineered.
      </InfoBox>
      <P>
        Gross profit, cost % and the four kinds come from what the till took, so they need till reports view as well
        as Costing view; without it the tab shows units, shares and which dishes are popular.
      </P>
      <H3>Scenarios: what if?</H3>
      <P>
        <strong>New scenario</strong> (Costing manage) starts one: give it a name, pick the menu, the venue (its
        supplier prices and its sales; or the group&apos;s prices and every venue&apos;s sales), a revenue stream if you
        like, the order type (its VAT and its sales) and how many days of sales make the mix. Then{' '}
        <strong>Add a change</strong>, as many as you need: a <strong>price</strong> or a <strong>cost</strong>, of
        every dish, a section or one dish, up or down by a percentage or by a figure, or set to a figure. A price
        change rounds new prices to 1p, 5p, 10p, 50p or £1, up, to the nearest or down. Changes apply in order, each on
        top of the ones above it: drag the grip to change the order.
      </P>
      <P>
        The figures follow as you change it. <strong>At the real mix</strong> shows the cost % weighted by what really
        sold, the gross profit and net sales at those units (with till reports view), and the cost, before and after,
        with the change in gross profit. Under it every section lists each dish with its units, price, cost, GP per
        dish and cost %, before (struck through) and after. A dish with no cost is left out of both sides and named,
        never counted as free. A meal deal is costed at the dishes guests pick most in it and priced with what those
        picks add; a cost change for a dish picked in a deal reaches the deal too.
      </P>
      <P>
        <strong>Save</strong> keeps the scenario; nothing on the menu changes. Saved scenarios are listed at the top:{' '}
        <strong>Open</strong>, <strong>Copy</strong> or delete one (it asks again). <strong>Export CSV</strong>{' '}
        downloads every dish before and after with the totals. Anyone with Costing view can look; saving needs Costing
        manage.
      </P>
      <H3>Push prices</H3>
      <P>
        When a saved scenario has price changes, <strong>Push prices to the menu&apos;s draft</strong> (Costing manage
        and Menus manage) first lists every price that will change, with where the menu is sold, and changes nothing
        until you tap <strong>Push</strong>. A dish has one price on a menu, so its new price applies wherever that menu
        is sold; only the VAT differs by order type. A dish priced by its options (Small and Large) has those options&apos;
        prices changed as its own, never the option group&apos;s for every dish; extras keep their prices; a meal
        deal&apos;s own price changes, not what its picks add.
      </P>
      <InfoBox type="warning">
        Push prices only changes the menu&apos;s <strong>draft</strong>. Nothing goes live (tills, online ordering, the
        website, Deliveroo) until you publish the menu on the Menus page, now or at a date and time. If the draft already
        has other changes that aren&apos;t live, the preview says so: publishing puts those live too. A scenario works
        on the draft, so after a push its &quot;before&quot; is the new price.
      </InfoBox>
      <H3>Pepper and reports</H3>
      <P>
        Ask Pepper &quot;which dishes are dogs on the lunch menu?&quot; or &quot;what are my stars in Mains this
        month?&quot;: it reads the Engineering tab. Ask it to &quot;save a scenario with every price up 5% to the next
        10p&quot; and it shows the cost % and gross profit at the mix on a card before saving; pushing the prices and
        publishing stay yours, on the pages. In Reports, <strong>Menu engineering</strong> and{' '}
        <strong>Cost scenarios</strong> are subjects, and the starter <strong>Menu engineering this month</strong> lists
        every dish sold this month with its kind and what to do.
      </P>
    </section>
  )
}
