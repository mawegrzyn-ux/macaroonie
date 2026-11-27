// src/pages/help/price-creep.jsx
// The Help page's "Price creep and cost alerts" section (inventory phase 7b,
// 27 Nov 2026): the dishes a supplier price change took over their cost
// target or limit, on Menu margins, Today, rules, Pepper's why_cost_changed
// and the reports. Help.jsx gathers every file in this folder (except
// parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'price-creep'
export const label = 'Price creep and cost alerts'
export const order = 376.5

export function Section() {
  return (
    <section id="price-creep" data-help="">
      <H2>Price creep and cost alerts</H2>
      <P>
        A dish can creep past its cost target without anyone touching the menu: chicken goes up 12% on a price list and
        the platter that was on target is now over it. Macaroonie checks this every time a supplier price changes in
        the app, and tells you which dishes crossed their cost target or limit, by how much and why.
      </P>
      <H3>When it is checked</H3>
      <DataTable
        head={['A price changes when you', 'Where']}
        rows={[
          ['Add or edit a supplier price (its price or its pack size)', 'Inventory, an item\'s supplier prices'],
          ['Give a venue its own price, or take it away', 'Inventory, an item\'s venue prices'],
          ['Import a supplier\'s price list by product code', 'Inventory, Update prices'],
          ['Import the inventory with prices', 'Inventory, Import'],
          ['Apply an invoice\'s prices after a delivery (for every venue or this venue)', 'Purchasing, a delivery\'s Update the price list from the invoice'],
        ]}
      />
      <P>
        Only the dishes whose recipes use the item are looked at (also through prep recipes, such as a stock inside a
        soup, and the meal deals that hold those dishes), on your live menus, at each venue the price is for and each
        order type, at today&apos;s menu price. A dish that was at or under its target and is now over it, or was over
        its target and is now over its limit, is a <strong>cost alert</strong>. A trial run of an import or a price list
        changes nothing and makes no alert.
      </P>
      <P>
        A meal deal is judged at the dishes that give it its highest cost % (the top of its range on Menu margins), so
        its alert names what moved in those: in a &quot;choose a main&quot; deal, the chicken in the platter a guest can
        pick, even when the platter isn&apos;t the first choice. When a price list moves several items, the ones that
        went up are named first.
      </P>
      <InfoBox>
        A change of usual supplier, a supplier price switched off, a recipe change or a new menu price isn&apos;t a price
        change: those are picked up within the hour by the regular look at dishes over their cost target (Today and your
        rules still hear about them), but they make no cost alert.
      </InfoBox>
      <H3>On Menu margins</H3>
      <P>
        When dishes crossed and nobody has looked yet, a banner across the top of <strong>Menu margins</strong> says so,
        for the venue picked (or every venue on the group&apos;s prices): &quot;4 dishes crossed 35% since 1 Dec:
        Chicken thighs up 12%&quot;. <strong>See them</strong> opens the list of the last 90 days (further back when an
        alert nobody has seen yet is older): each dish at its venue and order type, its cost % before and after, the %
        it crossed, what moved (each ingredient&apos;s cost per kg, litre or each before and after, and what that did
        to one serving), where the change came from and who made it. With Costing manage, <strong>Mark as seen</strong>{' '}
        (on the banner, or at the foot of the list) clears every one at the venue for everyone; the list keeps who saw
        each one.
      </P>
      <H3>Today, rules and Pepper</H3>
      <P>
        Today&apos;s <strong>dishes over the cost target</strong> card adds the same line and opens the list. If a new
        dish crosses after you skipped or finished the card, it comes back; marking the alerts seen doesn&apos;t bring
        it back. A rule such as &quot;when a dish goes over
        35%, tell the owner&quot; now tells at the moment of the price change instead of within the hour, and still only
        once for each crossing.
      </P>
      <P>
        Ask Pepper &quot;why did the chicken platter&apos;s cost go up since 1 November?&quot;: it compares what one
        serving costs now with what the same recipe cost at that day&apos;s supplier prices, lists the ingredients whose
        price moved and what each did to a serving, gives the cost % then and now, and lists the cost alerts for the
        dish. For a meal deal it compares the dishes that give it its highest cost %, then and now, and says which they
        are. Recipes keep no history, so it compares prices only, on today&apos;s recipe, and says when the recipe was
        changed since.
      </P>
      <H3>Reports and who sees what</H3>
      <P>
        In Reports, <strong>Cost alerts</strong> is a subject (ask for &quot;price rises&quot; or &quot;cost creep&quot;),
        and the starter <strong>Dishes that crossed the cost limit</strong> lists this month&apos;s so far. Cost alerts
        need Costing view; the supplier&apos;s name and pack beside a change need purchasing prices too.
      </P>
    </section>
  )
}
