// src/pages/docs/stored-keys.jsx
// The Docs page's "Stored keys" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'stored-keys'
export const label = 'Stored keys'
export const order = 60

// ── STORED KEYS ─────────────────────────────────
export function Section() {
  return (
    <section id="stored-keys" data-doc="">
      <H2>Stored keys</H2>
      <P>
        Integration keys saved in the database are sealed (migration 179,{' '}
        <Mono>services/vault.js</Mono>): AES-256-GCM with a master key from the environment,{' '}
        <Mono>SECRETS_KEY</Mono> (32 bytes, base64 or hex), so a leaked dump or backup doesn&apos;t
        hand them over. A sealed value is <Mono>v1:</Mono> + base64(iv | tag | ciphertext), a fresh
        iv every time. Hints (last four characters) sit beside them in plain text for display, and no
        route ever returns a key.
      </P>
      <DataTable
        head={['Column', 'Sealed on save in', 'Unsealed in']}
        rows={[
          ['platform_secrets.value (anthropic_api_key)', 'saveKey() (ai/apiKey.js)', 'activeKey()'],
          ['platform_secrets.value (kiosk_preview_key)', 'previewSecret() (kioskSvc.js)', 'previewSecret()'],
          ['loyverse_connections.access_token', 'POST / PATCH /api/loyverse/connections', 'ownConnection(), loadLink() (routes/loyverse.js)'],
          ['gloriafood_venue_links.poll_key', 'PUT /api/gloriafood/venues/:id/link', 'pollVenue() (gloriafoodSvc.js); the link route compares a typed key with the unsealed one'],
          ['venue_email_settings.provider_api_key, provider_secret, smtp_pass', 'POST / PATCH /api/email-templates/settings/:venueId', 'emailCredentials() (emailSvc.js), loadSendgridKey() (emailMonitoring.js)'],
          ['pos_card_accounts.secret', 'POST / PATCH /api/pos/card-accounts', 'the card machine adapters (services/cardSvc.js)'],
          ['pos_receipts.email_to (a guest\'s address until their counter order is paid, migration 210)', 'kioskReceipt() (receiptSvc.js)', 'sendWaitingReceipts(), then cleared'],
        ]}
      />
      <P>
        <Mono>unseal()</Mono> returns a value without the prefix as it is: keys saved before 179 are
        sealed by <Mono>sealStoredSecrets()</Mono>, run at API start in system mode (each row is
        updated only if it still holds the plain value, so several processes doing it at once is
        harmless). <Mono>checkVault()</Mono> runs first: in production the API exits without a valid{' '}
        <Mono>SECRETS_KEY</Mono>; in development and tests a fixed key derived from a constant is used,
        so every process agrees. Every deploy runs <Mono>scripts/ensure-secrets-key.sh</Mono> before
        migrating: it adds a random <Mono>SECRETS_KEY</Mono> to <Mono>api/.env</Mono> when there is none
        (chmod 600) and never changes an existing one. The preload (<Mono>src/preload.js</Mono>) reads{' '}
        <Mono>api/.env</Mono> on every start, so PM2 picks it up without a restart flag.
      </P>
      <InfoBox type="warn">
        Back up <Mono>api/.env</Mono> with the key in it. Changing or losing <Mono>SECRETS_KEY</Mono>{' '}
        makes every stored key unreadable: <Mono>unseal()</Mono> throws &quot;A stored key could not be
        read&quot;, and the keys have to be typed in again where they were set up (Platform page, Cash Recon
        settings, Booking emails). There is no rotation yet; the <Mono>v1:</Mono> prefix leaves room for one.
      </InfoBox>
    </section>
  )
}
