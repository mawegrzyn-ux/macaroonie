// src/pages/help/customers.jsx
// The Help page's "Customers & GDPR" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'customers'
export const label = 'Customers & GDPR'
export const order = 150

// ── CUSTOMERS & GDPR ────────────────────────────────
export function Section() {
  return (
    <section id="customers" data-help="">
      <H2>Customers &amp; GDPR</H2>
      <P>
        Macaroonie automatically builds a customer database as bookings are confirmed. Every time a
        booking is made with an email address, a customer profile is created or updated. You can search,
        view, and manage customer records from the <strong>Customers</strong> page in the sidebar.
      </P>

      <H3>Searching for a customer</H3>
      <P>
        Go to <strong>Customers</strong> and type in the search box at the top. You can search by
        name, email address, or phone number. Results appear immediately as you type. Click any
        customer row to open their full profile in the right-hand panel.
      </P>

      <H3>Customer profile</H3>
      <P>
        The detail panel shows the customer's contact details and their full booking history — date,
        venue, table, covers, and status for every booking linked to their record.
      </P>

      <H3>Customer search while taking a booking</H3>
      <P>
        When creating a new booking via the <strong>+ New booking</strong> button, as you type a
        name, email, or phone number in the guest details step, a panel appears to the right of the
        booking form showing matching customer records. Clicking a match pre-fills the name, email,
        and phone fields automatically — no need to type everything out for returning guests.
      </P>

      <H3>GDPR — Exporting a customer's data</H3>
      <P>
        If a customer requests a copy of all personal data held about them (a Subject Access Request
        under GDPR), open their profile from the Customers page and click{' '}
        <strong>Export customer data (JSON)</strong>. This downloads a JSON file containing their
        contact details and the full history of their bookings with your venue.
      </P>

      <H3>GDPR — Anonymising a customer</H3>
      <P>
        If a customer requests that their personal data be deleted (a Right to Erasure request under
        GDPR), open their profile and click <strong>Anonymise all personal data</strong>. You will be
        asked to confirm twice before anything changes.
      </P>
      <P>
        Anonymisation <strong>replaces</strong> all identifying information — name, email, phone, and
        notes — with placeholder values. All their linked bookings are also anonymised. The records
        themselves are retained for audit and financial purposes, but no personal information remains.
        This process cannot be undone.
      </P>
      <InfoBox type="warn">
        Anonymisation is permanent and irreversible. Once confirmed, the customer's personal details
        cannot be recovered. Only proceed when you have received a valid erasure request.
      </InfoBox>
      <H3>Deleting a test customer</H3>
      <P>
        Owners also see <strong>Delete this customer</strong> at the bottom of a customer&apos;s profile,
        for clearing out test and demo records. It asks twice. The customer record goes for good, but
        their bookings, online orders and loyalty membership stay, no longer linked to it, and still show
        the name and contact details written on them. For a real guest asking to be forgotten, use{' '}
        <strong>Anonymise</strong> instead: that removes their details everywhere.
      </P>
      <P>
        Anonymising also covers the customer&apos;s online orders: name, email, phone, notes and
        allergy information are removed, and they come off the newsletter. The export includes
        their online orders and what they agreed to at checkout.
      </P>
      <P>
        It covers Pepper too: their name, email and phone are taken out of Pepper&apos;s chats,
        the website chat and Pepper&apos;s Activity, and a chat they were in is closed (see
        Pepper → Guests&apos; details in Pepper&apos;s chats).
      </P>

      <H3>Newsletter</H3>
      <P>
        Guests join your newsletter by ticking the optional newsletter box when they order online.
        A newsletter icon shows next to subscribers in the customer list, and the{' '}
        <strong>Newsletter</strong> button above the list shows only subscribers. A
        customer&apos;s profile shows when and how they subscribed.
      </P>
      <P>
        If someone asks to stop receiving it, open their profile and tap{' '}
        <strong>Unsubscribe</strong>, then <strong>Yes, unsubscribe</strong>. Staff can&apos;t
        subscribe anyone: only the guest can, so you always have their own agreement. Ordering
        again without ticking the box does not unsubscribe them.
      </P>
    </section>
  )
}
