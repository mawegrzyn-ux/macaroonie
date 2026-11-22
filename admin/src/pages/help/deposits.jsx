// src/pages/help/deposits.jsx
// The Help page's "Deposits & Payments" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'deposits'
export const label = 'Deposits & Payments'
export const order = 110

// ── DEPOSITS ────────────────────────────────────
export function Section() {
  return (
    <section id="deposits" data-help="">
      <H2>Deposits &amp; Payments</H2>
      <P>
        A venue can take a deposit when guests book online. The guest pays by card in the booking
        widget, and the money goes straight to your own Stripe account (the one you connect for online
        orders). Bookings your staff add on the Timeline or the Bookings page take no deposit.
      </P>

      <H3>Turning deposits on</H3>
      <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
        <li>
          Connect your Stripe account first: <strong>Online orders</strong> &gt; <strong>Ordering setup</strong> &gt;{' '}
          <strong>Your Stripe account</strong> &gt; <strong>Connect Stripe</strong>. Guests can&apos;t pay a deposit
          until Stripe says your account can take payments.
        </li>
        <li>Open <strong>Booking rules</strong>, pick the venue and tick <strong>Take a deposit with online bookings</strong>.</li>
        <li>Choose <strong>One amount per booking</strong> or <strong>An amount per guest</strong>, and type the amount in pounds (for example 10 or 7.50).</li>
        <li>
          Under <strong>Refunded when the guest cancels at least this many hours before</strong>, type the hours
          (for example 24). Leave it empty to keep the deposit whenever a guest cancels.
        </li>
        <li>Press <strong>Save deposit rules</strong>.</li>
      </ol>
      <InfoBox type="warn">
        While deposits are on and Stripe isn&apos;t connected (or not ready yet), the Booking rules page says so in
        amber, and guests can&apos;t book that venue online at all: the widget asks them to phone instead.
      </InfoBox>

      <H3>What the guest sees</H3>
      <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
        <li>The widget says a deposit is taken (for example &quot;A deposit of £5.00 a guest&quot;) when they choose the party size.</li>
        <li>They pick a date and time, then type their details. Email is needed for a deposit: Stripe sends the receipt there.</li>
        <li><strong>Continue to payment</strong> holds the table for 15 minutes while they pay with card, Apple Pay or Google Pay.</li>
        <li>Once Stripe confirms the payment, the booking is made and the confirmation page shows the deposit paid.</li>
        <li>If they go back or give up, the table is let go and nothing is charged.</li>
      </ol>
      <P>
        The booking is only made once Macaroonie has checked with Stripe that the money was taken; what the guest&apos;s
        browser says is never enough. If the payment goes through but the table was taken in the meantime (the guest
        waited far too long), the deposit is refunded straight away and the guest is asked to pick another time.
      </P>

      <H3>When a guest cancels</H3>
      <P>
        Guests can cancel from the link in their confirmation email. If they cancel at least the hours you set before
        the booking, the deposit goes back to their card by itself, and the page tells them so. Later than that (or if
        you left the hours empty), the deposit is kept, and the page says that before they confirm.
      </P>

      <H3>Refunding a deposit yourself</H3>
      <P>
        Open the booking (Timeline or Bookings). The <strong>Deposit</strong> part of the booking shows what was paid,
        anything refunded and the cancellation rule. Owners and admins see <strong>Refund…</strong>: leave the amount
        empty to refund all that is left, or type part of it (for example 5), then press <strong>Yes, refund</strong>.
        You can refund in several parts. The money goes back to the guest&apos;s card, usually within 5 to 10 working days.
      </P>
    </section>
  )
}
