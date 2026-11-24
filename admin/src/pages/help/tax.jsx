// src/pages/help/tax.jsx
// The Help page's "Tax, Order Types & Streams" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'tax'
export const label = 'Tax, Order Types & Streams'
export const order = 320

// ── TAX, ORDER TYPES & REVENUE STREAMS ─────────────
export function Section() {
  return (
    <section id="tax" data-help="">
      <H2>Tax, Order Types &amp; Revenue Streams</H2>
      <P>
        Three separate things, each in one place:
      </P>
      <DataTable
        head={['What', 'Where', 'What it does']}
        rows={[
          ['Tax rates', 'Menus → Tax rates', 'Your list of rates (Standard 20%, Zero 0%, Reduced 5%...). One is the default. A location can charge another % for a rate.'],
          ['Order types', 'Store tech → Order types', 'How an order is served: Eat in, Take out, Delivery, Collection and any you add (Drive thru, Staff meal...). They decide how tickets behave and can change a dish\'s tax.'],
          ['Revenue streams', 'Store tech → Revenue streams', 'Groups of tills for reporting sales by place or device (Restaurant, Bar, Kiosk). A stream picks which order types its tills offer and what each asks for. It doesn\'t decide tax.'],
        ]}
      />

      <H3>Tax rates</H3>
      <P>
        <strong>Add rate</strong>: a name and a %, and optionally a different % at a location. The
        rate marked <strong>Default</strong> is used for any dish that has no rate set anywhere;
        <strong> Make default</strong> moves it. Drag rates into the order they appear in lists.
        Removing a rate takes it off the lists; you can't remove the default, or a rate a menu
        still uses (the message names the menus). Sales already made keep the rate they had.
      </P>

      <H3>Setting a dish&apos;s tax</H3>
      <P>
        The <strong>Tax</strong> box is in the menu&apos;s Settings, each section&apos;s panel and each
        dish&apos;s panel. Pick a <strong>Rate</strong>, or leave it as the default wording (the same as
        what it sits under). Then add <strong>exceptions</strong> for when a different rate applies:
        tap the order types it is for (none picked = any), optionally a location and the revenue
        streams there, then the rate to charge.
      </P>
      <DataTable
        head={['Which wins', '']}
        rows={[
          ['Dish, section, menu', 'A dish\'s own setting wins over its section\'s, a section\'s over its menu\'s, and the menu\'s over the default rate. A setting with a rate or an exception that matches the sale counts; a blank one passes to the level above.'],
          ['Within one setting', 'The exception that names the sale most closely wins: one for a revenue stream beats one for an order type, which beats one for a location only. One naming a stream and a type beats one naming just the stream. No matching exception: the setting\'s own rate.'],
        ]}
      />
      <P>
        Example: the <em>Sandwiches</em> section has rate Standard and an exception
        <em> Take out, Delivery, Collection → Zero</em>, so cold sandwiches are 20% eaten in and 0% to
        take away. A hot toastie in that section gets its own rate, Standard, and is 20% whichever
        way it is sold, because the dish&apos;s setting wins over the section&apos;s exceptions.
      </P>
      <InfoBox type="info">
        Two exceptions that could both apply to the same sale at different rates are flagged in red
        and Save stays off until one changes. Under each Tax box a line shows what it gives for every
        order type. <strong>Menus → Tax rates → Check</strong> shows every dish&apos;s rate for each
        order type at a location and revenue stream, exactly as the till, online ordering and the
        Deliveroo file work it out.
      </InfoBox>
      <P>
        Tax settings are part of the menu: like a price change, a new rate reaches the till, online
        ordering, menu screens and the Deliveroo file when you publish the menu. Changing the % of a
        rate on the Tax rates page applies straight away.
      </P>

      <H3>Order types</H3>
      <P>
        <strong>Store tech → Order types</strong> lists them for every location: add, rename, give
        a colour (used on the till and kitchen tickets) and drag into order. Removing one takes it
        off every till, stream and filter (<strong>Put back</strong> brings it back); checks and
        orders already taken keep it. Order types are used by the till&apos;s buttons, tax exceptions,
        kitchen flow links, the kitchen screens&apos; tabs, tickets and receipts, Till reports, online
        ordering (Ordering setup picks the type collection orders count as) and the Deliveroo file
        (its settings pick the type, Delivery to start with). The charges a till check gets come from its
        revenue stream and order type together: Store tech → <strong>Charges</strong> (see Till (POS) →
        Charges and discounts).
      </P>

      <H3>Revenue streams</H3>
      <P>
        <strong>Store tech → Revenue streams</strong>, per location: a name, which order types its
        tills offer and, for each one, <strong>Name</strong> and <strong>Tent</strong>: No, Ask
        (can be skipped) or Must (the check can&apos;t go to the kitchen or be paid without it).
        <strong> New checks start as</strong> picks the type a new check starts with. Each stream
        also picks its menus and a colour, whether its checks ask for guests, number seats and use
        courses (see Till (POS) → Guests, seats and courses), whether a receipt prints when one of its
        checks is paid (Ask each time, Always print, Don&apos;t print) and how the till asks for a new
        order&apos;s order type, name and tent number (One screen or Two steps). A till can have its own
        of each (Tills tab). A till belongs to one (Tills
        tab) and a floor area can name one; staff can move a check to another on the till (More →
        Revenue stream). Till reports show sales by stream and by order type.
      </P>

      <H3>On the till</H3>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Counter</strong> and <strong>New tab</strong>: the till takes over the screen to ask the order type, then the customer name or tent number that type asks for, with keys on the screen (one screen, or two steps: see Till (POS) → Asking for the order type, name and tent number); then tap dishes.</li>
        <li><strong>A check</strong>: More → <strong>Order type</strong> changes it (items already on the check take the new type&apos;s tax) and the name or tent number, on the same screen; More → <strong>Tent number</strong> sets just the tent.</li>
        <li>A detail the type must have and the check is missing is asked for at <strong>Send</strong> and <strong>Pay</strong>.</li>
        <li>The order type, customer name and tent number print on kitchen tickets and receipts and show on the kitchen screens.</li>
      </ul>
    </section>
  )
}
