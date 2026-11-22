// src/pages/help/widget.jsx
// The Help page's "Booking Widget" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P } from './parts.jsx'

export const id = 'widget'
export const label = 'Booking Widget'
export const order = 280

// ── WIDGET ──────────────────────────────────────
export function Section() {
  return (
    <section id="widget" data-help="">
      <H2>Booking Widget</H2>
      <P>
        The booking widget is an embeddable piece of your website that lets guests book a table
        directly, without calling the restaurant. It enforces all your booking rules automatically.
      </P>

      <H3>Testing the widget</H3>
      <P>
        Before embedding on your website, use the built-in test page at{' '}
        <strong>Widget Test</strong> in the sidebar. This runs the full booking flow in your
        browser so you can confirm slots appear correctly and bookings land in the Timeline.
      </P>

      <H3>Guest booking flow</H3>
      <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
        <li><strong>Party size</strong> — guest enters the number of covers.</li>
        <li><strong>Date</strong> — guest picks a date from the calendar.</li>
        <li><strong>Time slot</strong> — available slots are shown based on your schedule and current bookings.</li>
        <li><strong>Guest details</strong> — name, email, phone (optional), and special notes.</li>
        <li><strong>Payment</strong> (if the venue takes a deposit): the guest pays by card, Apple Pay or Google Pay.</li>
        <li><strong>Confirmation</strong> — booking reference shown; confirmation email sent.</li>
      </ol>

      <H3>Hold timer</H3>
      <P>
        Once a guest selects a slot, it is temporarily reserved with a countdown timer (based on
        your hold time limit in Booking Rules, default 5 minutes). If the guest doesn't complete
        the booking within the countdown, the slot is released for others. This prevents guests
        from "parking" on a popular slot indefinitely.
      </P>

      <H3>Embedding on your website</H3>
      <P>
        Add the following script tag to your website, replacing <code className="bg-muted px-1 rounded text-xs">YOUR_VENUE_ID</code> with
        your venue's UUID (found on the Venues page):
      </P>
      <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-4 overflow-x-auto mb-4 leading-relaxed">
{`<script
  src="https://your-domain.com/widget/loader.js"
  data-venue-id="YOUR_VENUE_ID"
  defer
></script>
<div id="macaroonie-widget"></div>`}
      </pre>

      <H3>Customising the widget appearance</H3>
      <P>
        The widget reads CSS custom properties from your website for theming. Add these to
        your website's CSS to match your brand:
      </P>
      <pre className="bg-gray-900 text-green-300 text-xs rounded-lg p-4 overflow-x-auto mb-4 leading-relaxed">
{`:root {
  --booking-accent: #d97706;     /* Button and highlight colour */
  --booking-radius: 8px;         /* Border radius */
  --booking-font: 'Your Font';   /* Font family */
}`}
      </pre>
    </section>
  )
}
