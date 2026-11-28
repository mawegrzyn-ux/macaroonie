// src/pages/help/integrations.jsx
// The Help page's "Integrations" section (sales from other tills: Loyverse and
// Square, the item mapping, the readers).
// Help.jsx gathers every file in this folder (except parts.jsx) and shows
// them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'integrations'
export const label = 'Integrations'
export const order = 165

export function Section() {
  return (
    <section id="integrations" data-help="">
      <H2>Integrations</H2>
      <P>
        If some of your venues sell through another till (Loyverse or Square; Oracle Simphony
        later), Macaroonie keeps their sales too: every receipt with its items, variants, modifiers,
        discounts, taxes, tips and payments, with the money exactly as that till recorded it. Open{' '}
        <strong>Money &gt; Integrations</strong>. Anyone with Cash reconciliation can see the page;
        Manage can sync and fetch history; owners and admins connect accounts and link venues.
      </P>
      <H3>Connect a Loyverse account</H3>
      <DataTable
        head={['Step', 'What to do']}
        rows={[
          ['1. Make a token', 'In the Loyverse Back Office open Integrations > Access tokens and add a token.'],
          ['2. Connect a till', 'Tap Connect a till, give the account a name and paste the token. It is checked with Loyverse, stored encrypted and never shown again.'],
          ['3. Link a venue', 'On the account tap Link a venue: choose the venue, its Loyverse store and when its trading day starts. Each store can be linked to one venue.'],
        ]}
      />
      <P>
        When you connect, Macaroonie registers a webhook with Loyverse so new and changed receipts
        arrive within a minute or two. If Loyverse doesn&apos;t take it, the page shows an address to add
        in Loyverse yourself (shown once; tap <strong>New webhook address</strong> to make another).
        Either way, every connection is checked every 15 minutes.
      </P>
      <H3>Connect a Square account</H3>
      <P>
        Tap <strong>Connect a till</strong> and choose <strong>Square</strong>. There are two ways in:
      </P>
      <DataTable
        head={['Way', 'What to do']}
        rows={[
          ['Sign in with Square', 'Shown when your Macaroonie server has been set up for it. Tap it, sign in to Square and allow Macaroonie to read your items and orders; Square brings you back to Integrations with the account connected. Macaroonie renews the sign-in by itself.'],
          ['Paste an access token', 'On Square\'s Developer Dashboard open your application, then Credentials, and copy the access token. Choose Production for your live sales, or Sandbox for a Square test account, and paste the token. It is checked with Square, stored encrypted and never shown again.'],
          ['Link a venue', 'On the account tap Link a venue: choose the venue, its Square location and when its trading day starts. Each location can be linked to one venue; its last 13 months come in the background.'],
        ]}
      />
      <P>
        With a pasted token Macaroonie sets up Square&apos;s webhook itself, so new orders arrive within a
        minute or two, and Square signs every call to it. After Sign in with Square it can&apos;t: copy the
        webhook address shown, add it in Square&apos;s Developer Dashboard (Webhooks, with the events
        order.created, order.updated and catalog.version.updated), then tap <strong>Signature key</strong>{' '}
        on the account and paste the key Square gives the subscription. Until then sales still arrive
        every 15 minutes.
      </P>
      <InfoBox>
        A Square item&apos;s variations (Regular, Large) are what was sold: on Item mapping each variation
        sits under its item, and modifiers under their list, so you can map a variation to a dish (or a
        dish and an option) and the variations together to one of your option groups. Square returns
        are kept as refunds linked to the order they return. Cash Recon&apos;s Fill from the till is for
        Loyverse only for now: Square&apos;s sales show in the &quot;every till&quot; reports, Today and Pepper.
        Disconnecting a signed-in account also gives Macaroonie&apos;s access back to Square.
      </InfoBox>
      <H3>History</H3>
      <P>
        Linking a venue fetches its last 13 months of receipts in the background. The bar under the
        venue shows how far it has got; it carries on by itself if it is interrupted.{' '}
        <strong>Fetch history</strong> starts it again (receipts already kept are updated, never
        doubled).
      </P>
      <H3>What each connection shows</H3>
      <DataTable
        head={['Item', 'What it means']}
        rows={[
          ['Active / Syncing / Late / Paused / Needs attention', 'Late means no good sync for over 50 minutes; Needs attention means the till refused the token (replace it, or sign in with Square again).'],
          ['Last sync', 'When it last worked, and how many receipts it read and saved.'],
          ['Sync now', 'Checks for new receipts straight away, in the background.'],
          ['Receipts kept', 'Per venue: how many, how many refunds and cancellations, and the first and last day.'],
          ['Pause / Resume', 'A paused connection is not synced until it is resumed.'],
          ['Disconnect', 'Removes the account, its venue links and every sale kept from it (asks first). Cash Recon days already filled keep their figures.'],
        ]}
      />
      <InfoBox>
        Refunds are kept as their own receipts, linked to the sale they refund; a cancelled receipt
        stays, marked cancelled. Customers are kept only as Loyverse&apos;s customer number: never their
        name, email or phone. Reports that show these sales beside your own till&apos;s come next.
        Cash Recon&apos;s Fill from Loyverse still reads Loyverse directly for now.
      </InfoBox>
      <H3>Item mapping</H3>
      <P>
        Item mapping says what the other till&apos;s items are on your Macaroonie menus, so its sales
        count as your dishes and options. Tap <strong>Item mapping</strong> on a connection. Pick a venue
        at the top, or leave it on every venue. On the left is the till&apos;s catalogue: each item,
        its variants and the modifier options, with what each one becomes now and its sales in the last
        30 days. Tap anything to map it. Each rule has its own <strong>Save rule</strong>.
      </P>
      <DataTable
        head={['Rule', 'What it does']}
        rows={[
          ['Map to a dish', 'An item (every variant) or one variant becomes one of your dishes, with options if you pick them (Large / Oat: Flat white with Size Large and Milk Oat), more dishes for a bundle, or a combo. A modifier option becomes one of your options, or a dish of its own (a side sold as a modifier).'],
          ['Combination', 'An item (and variant) sold with certain modifiers becomes a combo or a dish: Burger with Make it a meal becomes your Burger meal. The modifiers become part of it.'],
          ['Option axis', 'A variant option (Size) or a modifier group becomes one of your option groups, value by value, on whichever dish the item maps to. One axis rule maps the size of every item.'],
          ['Ignore', 'Not a sale (a gift card, a deposit): left out of what was sold and of coverage.'],
          ['Keep as sold', 'Reported under the till\'s own name, not as one of your dishes.'],
          ['Pattern', 'Everything whose code is, or starts with, some text (BTL-), whose name contains a word (Bottle), or that is in one of the till\'s categories becomes one dish. Made with Pattern under Rules.'],
          ['Category to a section', 'Everything in a till category that no other rule maps is counted under one of your menu sections in reports, not as a dish.'],
        ]}
      />
      <P>
        A rule for one venue beats a rule for every venue. A variant&apos;s rule beats its item&apos;s,
        and a combination beats both. A modifier with no rule stays on the receipt as a note. Each rule
        applies from a day (<strong>From</strong>; left empty, from the start of the stored sales), so
        a change can leave earlier sales as they were. Patterns come after every rule made for an item:
        a code that is the same first, then a code that starts the same (the longer first), then a name,
        then a category, then a category to a section.
      </P>
      <H3>Suggestions</H3>
      <P>
        With a venue picked, <strong>Suggestions</strong> lists what is still not mapped there with the
        best match on that venue&apos;s menus: the same product code or barcode first, then a name like
        it (a variant&apos;s Large and Oat find your Size and Milk options on that dish); the price and
        category settle a tie. Each shows how sure it is and why. Those at 90% or more are ticked.
        Tap <strong>Accept</strong> on one, or <strong>Accept ticked</strong>; another match under a row
        swaps it. Nothing is saved until you accept, and each becomes a rule for that venue.
      </P>
      <P>
        When what you accept has the same shape (three or more variants called Large all going to your
        Size: Large, or three items to one dish whose codes start the same), a box asks
        <strong> Make it a pattern rule?</strong> One tap saves a single rule that covers every item
        like them, today&apos;s and ones the till adds later. <strong>No thanks</strong> leaves it.
      </P>
      <H3>Ask Pepper</H3>
      <P>
        <strong>Ask Pepper about what&apos;s left</strong> sends up to 40 of the items the suggestions
        didn&apos;t tick, with this venue&apos;s menu, and Pepper proposes a rule for each (a dish, a
        dish with options, an option axis, ignore or keep as sold) with its reason and how sure it is.
        Accept them as you would suggestions. Pepper only sees names and prices, never anything that
        identifies a record; anything it proposes that isn&apos;t on this venue&apos;s menus is left out.
        It uses your Pepper allowance and needs Pepper switched on.
      </P>
      <H3>Create missing dishes</H3>
      <P>
        For a venue moving to your menus: in <strong>Create missing dishes</strong>, tick what the other
        till sells that you don&apos;t have, choose a section of one of the venue&apos;s menus and tap
        <strong> Create</strong>, then confirm. Each becomes a dish at the till&apos;s price there; its
        variants become an option group (Size: Regular, Large) with this dish&apos;s own price for each,
        and they are mapped as they are made. They go into the menu&apos;s draft: publish the menu when
        you&apos;re ready. Needs Menus manage as well.
      </P>
      <H3>Copy from another venue</H3>
      <P>
        With the venue to copy to picked, choose the venue to <strong>Copy from</strong> and tap
        <strong> See what will be copied</strong>. Its own rules are matched to this venue&apos;s menus by
        dish, option and section name; you see what will be copied, what can&apos;t be matched (left
        out) and what this venue already has a rule for. Nothing is saved until you tap
        <strong> Copy</strong> and confirm.
      </P>
      <H3>Preview, coverage and money</H3>
      <P>
        <strong>Preview</strong> in the rule window shows what the last 30 days&apos; sales would become
        with your change, line by line, before anything is saved. <strong>Coverage</strong> at the top
        is the share of the last 30 days&apos; item sales that is mapped, kept as sold or counted under a
        section (ignored items left out), per venue, with the items not mapped yet, biggest first: tap one to map it. Saved
        rules are applied to the stored sales in the background; coverage moves when that is done.
      </P>
      <InfoBox>
        A rule never changes money. Each receipt keeps the till&apos;s amounts; when one line becomes a
        dish and its options (or a bundle), its amount is shared out by your list prices, the
        remainder on the dish, so the parts add up to what the till charged. Delete asks you to
        confirm first. Anyone with Cash reconciliation can look, see suggestions and preview a copy;
        Manage saves and deletes rules, accepts suggestions, asks Pepper and copies.
      </InfoBox>
      <H3>Where the imported sales show</H3>
      <P>
        Once a venue&apos;s receipts are stored they are read everywhere Macaroonie shows sales:
      </P>
      <DataTable
        head={['Where', 'What you see']}
        rows={[
          ['Reports', 'Three subjects under Till sales put your own till and the other till together, with a Till column saying which: Sales, every till (checks and receipts), Dishes sold, every till (mapped items as your dishes, the rest by the name they were sold under, a category bucket under its section) and Payments, every till. The Till sales subjects you had before stay your own till only. Six starter reports under Till sales read them, one tap each: Sales by day, every till; Sales by till (ours against Loyverse); Dishes sold, every till; Sales by section, every till; Payments by tender, every till; and Items still to map (another till\'s items the mapping doesn\'t place yet, most sold first). The other Till sales starters (Sales by day, Sales by dish...) are our own till only.'],
          ['Mapping coverage', 'A figure on Dishes sold, every till: the share of the other till\'s item sales that is mapped, kept as sold or counted under a section, over the report\'s days (the Item mapping page shows the same over the last 30 days).'],
          ['Cash Recon', 'Fill from Loyverse reads the stored receipts (see Cash Recon, Fill from Loyverse).'],
          ['Home', 'The day at a glance shows the day\'s sales by till, for people who can see Till reports.'],
          ['Pepper', 'Ask "what did Ware take yesterday?": for a venue on Loyverse Pepper answers from the stored receipts and says so. Questions about sales across tills are answered from the subjects above.'],
        ]}
      />
      <P>
        Sales count the way your own till counts them: receipts that weren&apos;t cancelled, on the
        trading day they fall on. A Loyverse refund is a receipt of its own on the day it was made,
        counted under Refunded, never taken off the day&apos;s sales. Money is what each till
        recorded. Another till&apos;s tip is shown on the receipt&apos;s biggest payment.
      </P>
    </section>
  )
}
