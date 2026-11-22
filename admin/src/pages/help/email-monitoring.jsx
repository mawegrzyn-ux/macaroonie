// src/pages/help/email-monitoring.jsx
// The Help page's "Email Monitoring" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'email-monitoring'
export const label = 'Email Monitoring'
export const order = 470

// ── EMAIL MONITORING ─────────────────────────────
export function Section() {
  return (
    <section id="email-monitoring" data-help="">
      <H2>Email Monitoring</H2>
      <P>
        The <strong>Email monitor</strong> page (sidebar, under the Emails section)
        shows what your venue is sending and what&apos;s being blocked at the SendGrid
        gateway. It&apos;s split into two sections.
      </P>

      <H3>What went out</H3>
      <P>
        Aggregate stats from SendGrid for the selected window (last 7 / 30 / 90 days):
        requested, delivered, opens, clicks, bounces, spam reports, plus delivery /
        open / bounce rates.
      </P>
      <P>
        Below the cards is a daily breakdown table (one row per day) and the local send
        log — every email Macaroonie tried to send, with status, recipient, subject, and
        provider. Cross-reference the two: if a row in the local log shows
        &ldquo;sent&rdquo; but the recipient claims they didn&apos;t receive it, look
        at the SendGrid bounces column for that day.
      </P>

      <H3>What&apos;s in (suppressions)</H3>
      <P>
        Four lists showing addresses SendGrid is currently blocking:
      </P>
      <DataTable
        head={['List', 'Meaning', 'When to remove']}
        rows={[
          ['Bounces',        'Recipient mailbox rejected the message (usually invalid address or full mailbox).', 'Once the recipient confirms the issue is fixed.'],
          ['Blocks',         'ISP blocked our IP or content (looks like spam to them).', 'After contacting the ISP or modifying email content.'],
          ['Spam reports',   'Recipient marked one of our emails as spam.', 'Only with the recipient\'s explicit re-opt-in.'],
          ['Invalid emails', 'Address malformed at SendGrid validation (typo, missing @, etc.).', 'Never — fix the source data.'],
        ]}
      />
      <P>
        Hover an entry → trash icon appears (owner only) → click to remove and let
        future emails to that address through. Useful when a guest&apos;s mailbox was
        temporarily full and they&apos;re asking why they&apos;re not getting reminders.
      </P>

      <InfoBox type="info">
        Monitoring currently shows SendGrid data only. If your venue uses Postmark,
        Mailgun, or SES, this page shows a banner explaining that monitoring isn&apos;t
        wired up for that provider yet — but the local send log still works.
      </InfoBox>
    </section>
  )
}
