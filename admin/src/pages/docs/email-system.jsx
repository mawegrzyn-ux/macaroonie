// src/pages/docs/email-system.jsx
// The Docs page's "Email System" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'email-system'
export const label = 'Email System'
export const order = 100

// ── EMAIL SYSTEM ────────────────────────────
export function Section() {
  return (
    <section id="email-system" data-doc="">
      <H2>Email System</H2>
      <P>
        Pluggable email delivery with five providers, per-venue settings, monitoring,
        and a guest manage page. All bookings emails (confirmation, reminder,
        modification, cancellation) flow through one BullMQ queue.
      </P>

      <H3>Providers</H3>
      <DataTable
        head={['Provider', 'When to use', 'Config fields used']}
        rows={[
          ['sendgrid', 'Default. Free 100/day for trial. Provides Email Activity API for monitoring.', 'provider_api_key (or SENDGRID_API_KEY env)'],
          ['postmark', 'Recommended for transactional. Strong deliverability, $15/10k. Click tracking via shared click.pstmrk.it (no custom tracking domains supported by Postmark).', 'provider_api_key (Server Token), provider_domain (message stream, defaults to "outbound")'],
          ['mailgun',  'High-volume option. EU/US regions are different endpoints — use the dropdown.', 'provider_api_key, provider_domain (sending domain), provider_region (us|eu)'],
          ['ses',      'Cheapest at scale. AWS Lightsail account already in place. Production access required.', 'provider_api_key (access key id), provider_secret (secret access key; it was kept in provider_domain until migration 179), provider_region'],
          ['smtp',     'Fallback / self-hosted.', 'smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure'],
        ]}
      />
      <P>
        provider_api_key, provider_secret and smtp_pass are stored sealed (migration 179, see Stored keys)
        and never sent back: <Mono>GET .../settings/:venueId</Mono> returns them as null with{' '}
        <Mono>*_hint</Mono> (last four) for Manage, nothing for View (<Mono>secrets_hidden</Mono>). On
        save a string replaces the key, null removes it, empty or left out keeps it.{' '}
        <Mono>emailCredentials()</Mono> in <Mono>emailSvc.js</Mono> is the one place they are
        unsealed (booking, order and purchase order emails, the test send).
      </P>
      <P>
        The <Mono>provider_domain</Mono> column is overloaded across providers (Mailgun
        sending domain, Postmark message stream name, SES secret access key). The UI
        gates input fields by provider so users never see the overloading.
      </P>

      <H3>Routes</H3>
      <DataTable
        head={['Method', 'Path', 'Purpose']}
        rows={[
          ['GET',    '/api/email-templates/settings/:venueId',         'Read venue email settings'],
          ['POST',   '/api/email-templates/settings/:venueId',         'Upsert venue email settings (creates row if missing, updates all body fields)'],
          ['PATCH',  '/api/email-templates/settings/:venueId',         'Same as POST — both go through the same upsert helper'],
          ['POST',   '/api/email-templates/preview',                   'Render template with sample merge fields (no send)'],
          ['POST',   '/api/email-templates/send-test',                 'Send real test email through venue provider, no booking. Logged in email_log with template_type suffix _test.'],
          ['GET',    '/api/email-monitoring/summary?venue_id&days',    'One-shot: SendGrid stats + suppression lists + local log totals'],
          ['GET',    '/api/email-monitoring/suppressions/:type',       'Bounces / blocks / spam_reports / invalid_emails'],
          ['DELETE', '/api/email-monitoring/suppressions/:type/:email', 'Owner-only: clear a suppression so retries can flow'],
        ]}
      />

      <H3>Monitoring (SendGrid only)</H3>
      <P>
        <Mono>src/services/sendgridSvc.js</Mono> wraps the SendGrid Web API:
        <Mono> getStats</Mono> (daily breakdown), <Mono>getSuppressions</Mono>,
        <Mono> removeSuppression</Mono>, <Mono>pingApiKey</Mono>. <Mono>/email-monitoring</Mono>
        admin page combines the SendGrid data with the local <Mono>email_log</Mono> table
        for a complete &ldquo;what went out / what&apos;s in&rdquo; view. Other providers
        show a graceful banner; local log still works.
      </P>

      <H3>Guest manage page</H3>
      <P>
        SSR page at <Mono>/manage/{`{token}`}</Mono> via <Mono>src/routes/manageBooking.js</Mono>
        + Eta template. Guest authenticates via the <Mono>manage_token</Mono> UUID
        embedded in the email link. Allows modify date/time/covers OR cancel, gated by
        the venue&apos;s <Mono>allow_guest_modify</Mono> /
        <Mono> allow_guest_cancel</Mono> flags.
      </P>
    </section>
  )
}
