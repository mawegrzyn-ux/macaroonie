// src/pages/help/emails.jsx
// The Help page's "Booking Emails" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'emails'
export const label = 'Booking Emails'
export const order = 440

// ── BOOKING EMAILS ────────────────────────────────
export function Section() {
  return (
    <section id="emails" data-help="">
      <H2>Booking Emails</H2>
      <P>
        Macaroonie automatically sends emails to guests when bookings are confirmed,
        modified, cancelled, or coming up soon. You can customise the templates, choose
        your email provider, and control what guests can do from the email link.
      </P>

      <H3>Getting started</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Go to <strong>Emails</strong> in the sidebar (mail icon).</li>
        <li>
          Emails work <strong>out of the box</strong> with the built-in templates and
          your platform's SendGrid key. No setup needed for basic confirmation +
          reminder emails.
        </li>
        <li>
          To customise, switch to the <strong>Templates</strong> tab and edit the subject
          line or HTML body for each email type.
        </li>
        <li>
          To change provider or configure reminders, use the <strong>Settings</strong> tab.
        </li>
      </ol>

      <H3>The 3 tabs</H3>
      <DataTable
        head={['Tab', 'What it does']}
        rows={[
          ['Templates', 'Edit the subject and HTML body for each email type. Insert merge fields, preview with sample data, reset to the built-in default.'],
          ['Settings',  'Choose email provider (SendGrid, Mailgun, SES, SMTP), configure sender identity, reminder timing, and guest self-service permissions. Keys and passwords are stored encrypted and never shown again: a saved one shows as "Saved, ends 1a2b". Leave the box empty to keep it, type a new one to replace it, or press Remove (then Save) to take it off.'],
          ['Sent emails', 'Audit log of recent deliveries — see what was sent, when, to whom, and whether it succeeded or failed.'],
        ]}
      />

      <H3>Email types</H3>
      <DataTable
        head={['Type', 'When it sends', 'What it contains']}
        rows={[
          ['Confirmation', 'Immediately when a booking is confirmed (free or paid).', 'Booking details + a "View or manage your booking" button linking to the guest manage page.'],
          ['Reminder',     'Automatically, X hours before the booking (configurable per venue, default 24h).', 'Booking details + a reminder to contact the venue if they can\'t make it.'],
          ['Modification', 'When the guest modifies their booking (date, time, or covers) from the manage page.', 'Updated booking details.'],
          ['Cancellation', 'When the booking is cancelled (by the guest from the manage page, or by an operator).', 'Cancelled booking details.'],
        ]}
      />

      <H3>Merge fields</H3>
      <P>
        Templates use <Mono>{'{{field_name}}'}</Mono> placeholders that get replaced with
        real booking data when the email is sent. Click any field pill in the editor to
        insert it into the body.
      </P>
      <DataTable
        head={['Field', 'Example value']}
        rows={[
          ['{{guest_name}}',        'John Smith'],
          ['{{venue_name}}',        'Wingstop Covent Garden'],
          ['{{booking_date}}',      'Friday 15 May 2026'],
          ['{{booking_time}}',      '19:30'],
          ['{{booking_end_time}}',  '21:00'],
          ['{{covers}}',            '4'],
          ['{{table_label}}',       'T5'],
          ['{{booking_reference}}', 'WS-A3F2'],
          ['{{manage_link}}',       'Link to view/modify/cancel the booking'],
          ['{{guest_notes}}',       'Window seat please'],
          ['{{venue_address}}',     '42 Long Acre, London WC2E 9LG'],
          ['{{venue_phone}}',       '+44 20 7946 0958'],
        ]}
      />
      <InfoBox type="tip">
        The most important field is <Mono>{'{{manage_link}}'}</Mono> — this is the URL
        guests click to view, modify, or cancel their booking. Always include it in your
        confirmation and reminder templates.
      </InfoBox>

      <H3>Editing a template</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Select the email type tab (Confirmation / Reminder / Modification / Cancellation).</li>
        <li>Edit the <strong>subject line</strong> — merge fields work here too.</li>
        <li>Edit the <strong>HTML body</strong>. Click merge field pills above the editor to insert them.</li>
        <li>The link, image and <strong>BTN</strong> (button) tools ask under the toolbar: type the address (example.com gets https:// in front; mailto:, tel: and merge fields such as <Mono>{'{{manage_link}}'}</Mono> work too, picked from the list) and, for a button, its words, then <strong>Add</strong> (or Enter). An image needs a web address. With the words on a link, the link tool shows <strong>Change link</strong> and <strong>Remove link</strong>.</li>
        <li>Click <strong>Preview</strong> to see the email rendered with sample data in a preview panel.</li>
        <li>Click <strong>Save template</strong>.</li>
        <li>To go back to the built-in default, click <strong>Reset to default</strong> or <strong>Delete custom</strong>.</li>
      </ol>
      <InfoBox type="info">
        Templates are per-venue. Select the venue from the dropdown in the header bar.
        If a venue has no custom template, it uses the built-in default automatically.
      </InfoBox>

      <H3>Email providers</H3>
      <P>
        Each venue can use a different email provider. Configure it in the
        <strong> Settings</strong> tab.
      </P>
      <DataTable
        head={['Provider', 'Setup']}
        rows={[
          ['SendGrid (default)', 'Works out of the box with the platform API key. Optionally add a per-venue key for dedicated sending.'],
          ['Postmark',           'Recommended for transactional. Paste the Server API token from Postmark → Servers → your server → API Tokens. Strong deliverability, ~$15/10k emails, branded click tracking handled automatically (click.pstmrk.it with valid TLS).'],
          ['Mailgun',            'Requires an API key + Mailgun domain (e.g. mg.yourdomain.com) per venue. PICK THE REGION (US or EU) — EU accounts silently 401 if you leave it on US.'],
          ['AWS SES',            'Cheapest at scale. Uses AWS credentials + region. First-time use requires a one-off "production access" form to be approved by AWS (~24h).'],
          ['SMTP',               'Any SMTP server — Gmail, Outlook, self-hosted. Enter host, port, username, password.'],
        ]}
      />

      <H3>Sender identity</H3>
      <P>
        Set the <strong>From name</strong> (e.g. "Wingstop Covent Garden"),
        <strong> From email</strong> (must be verified with your provider), and an
        optional <strong>Reply-to</strong> address where guest replies land.
      </P>
      <InfoBox type="warn">
        If From email is not verified with your email provider, emails may be rejected
        or land in spam. Check your provider's domain verification docs.
      </InfoBox>

      <H3>Reminders</H3>
      <P>
        Reminders are sent automatically before each booking. Configure in Settings:
      </P>
      <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
        <li><strong>Enabled / disabled</strong> — toggle per venue.</li>
        <li><strong>Hours before</strong> — slider from 1 to 72 hours (default 24h = 1 day before).</li>
        <li>Each booking gets at most one reminder (tracked by <Mono>reminder_sent_at</Mono>).</li>
        <li>If a booking is cancelled before the reminder fires, it's skipped automatically.</li>
      </ul>

      <H3>Guest manage page</H3>
      <P>
        Every confirmation and reminder email includes a <strong>"View or manage your
        booking"</strong> button. This links to a page at{' '}
        <Mono>macaroonie.com/manage/{'<token>'}</Mono> where the guest can:
      </P>
      <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
        <li><strong>View</strong> their booking details (date, time, guests, table, status).</li>
        <li><strong>Modify</strong> the date, time, or number of guests (if allowed).</li>
        <li><strong>Cancel</strong> the booking with a double-confirmation (if allowed + within cutoff).</li>
      </ul>
      <P>
        The page is themed with the venue's brand colour and logo. No login is needed —
        the link itself authenticates the guest.
      </P>

      <H3>Guest permissions</H3>
      <P>Control what guests can do from their manage page. Set in Settings:</P>
      <DataTable
        head={['Setting', 'Default', 'What it does']}
        rows={[
          ['Allow guests to modify', 'On',  'Guests can change date, time, or covers.'],
          ['Allow guests to cancel', 'On',  'Guests can cancel their booking.'],
          ['Cancel cutoff (hours)',  '2h',   'Guests cannot cancel within this many hours of the booking. E.g. 2h = can\'t cancel less than 2 hours before.'],
        ]}
      />

      <H3>Sent emails log</H3>
      <P>
        The <strong>Sent emails</strong> tab shows the last 50 deliveries with:
        time, type, recipient, subject, and status. Statuses:
      </P>
      <DataTable
        head={['Status', 'Meaning']}
        rows={[
          ['Sent',    'Email delivered to the provider successfully.'],
          ['Queued',  'In the queue, waiting to be processed.'],
          ['Failed',  'Delivery failed — check the error message. The system will retry.'],
          ['Bounced', 'Email bounced (invalid address, full inbox, etc).'],
        ]}
      />

      <H3>Common issues</H3>
      <div className="space-y-2.5">
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Guests aren't receiving emails</p>
          <p className="text-sm text-muted-foreground">
            Check the <strong>Sent emails</strong> tab for failed deliveries. Common causes:
            invalid SendGrid API key, unverified sender domain, or the guest's email is
            incorrect. Walk-in bookings (<Mono>walkin@walkin.com</Mono>) are skipped automatically.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Reminder didn't send</p>
          <p className="text-sm text-muted-foreground">
            Check that <strong>Reminders</strong> are enabled in Settings for this venue.
            Also verify Redis is running — reminders use BullMQ delayed jobs. If the booking
            was created less than the reminder window ago, the reminder hasn't fired yet.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Guest can't modify or cancel from the email link</p>
          <p className="text-sm text-muted-foreground">
            Check <strong>Settings → Guest self-service</strong>. If "Allow guests to modify" or
            "Allow guests to cancel" is off, those buttons won't appear on the manage page.
            Also check the cancel cutoff — guests can't cancel within the cutoff window.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Emails going to spam</p>
          <p className="text-sm text-muted-foreground">
            Make sure your sending domain has SPF, DKIM, and DMARC records configured with
            your email provider. Use a professional From email (not a free Gmail/Yahoo address).
            Check your provider's domain authentication docs.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Logo next to the sender in Gmail / Apple Mail</p>
          <p className="text-sm text-muted-foreground">
            Inbox avatars use <strong>BIMI</strong>, not an image inside the email.
            Go to <strong>Emails → Settings → Inbox logo</strong>, upload a square SVG
            (solid background), then add the TXT record it shows at the DNS host for your
            From domain. You also need DMARC at <Mono>p=quarantine</Mono> or <Mono>p=reject</Mono>.
            Gmail and Apple Mail additionally require a Verified Mark Certificate (VMC)
            from DigiCert or Entrust. Yahoo and Fastmail show the logo without a VMC.
          </p>
        </div>
      </div>
    </section>
  )
}
