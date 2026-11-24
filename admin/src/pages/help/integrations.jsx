// src/pages/help/integrations.jsx
// The Help page's "Integrations" section (sales from other tills, phase 1).
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
        name, email or phone. Matching Loyverse items to your Macaroonie dishes, and reports that show
        these sales beside your own till&apos;s, come next. Cash Recon&apos;s Fill from Loyverse still reads
        Loyverse directly for now.
      </InfoBox>
    </section>
  )
}
