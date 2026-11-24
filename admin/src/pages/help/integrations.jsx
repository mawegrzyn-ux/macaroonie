// src/pages/help/integrations.jsx
// The Help page's "Integrations" section (sales from other tills, phases 1
// and 2: the item mapping).
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
        If some of your venues sell through another till (Loyverse today; Square and Oracle Simphony
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
          ['Active / Syncing / Late / Paused / Needs attention', 'Late means no good sync for over 50 minutes; Needs attention means Loyverse refused the token (replace it).'],
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
        ]}
      />
      <P>
        A rule for one venue beats a rule for every venue. A variant&apos;s rule beats its item&apos;s,
        and a combination beats both. A modifier with no rule stays on the receipt as a note. Each rule
        applies from a day (<strong>From</strong>; left empty, from the start of the stored sales), so
        a change can leave earlier sales as they were.
      </P>
      <H3>Preview, coverage and money</H3>
      <P>
        <strong>Preview</strong> in the rule window shows what the last 30 days&apos; sales would become
        with your change, line by line, before anything is saved. <strong>Coverage</strong> at the top
        is the share of the last 30 days&apos; item sales that is mapped or kept as sold (ignored items
        left out), per venue, with the items not mapped yet, biggest first: tap one to map it. Saved
        rules are applied to the stored sales in the background; coverage moves when that is done.
      </P>
      <InfoBox>
        A rule never changes money. Each receipt keeps the till&apos;s amounts; when one line becomes a
        dish and its options (or a bundle), its amount is shared out by your list prices, the
        remainder on the dish, so the parts add up to what the till charged. Delete asks you to
        confirm first. Anyone with Cash reconciliation can look and preview; Manage saves and deletes
        rules. Suggestions (matching names and Pepper) come next.
      </InfoBox>
    </section>
  )
}
