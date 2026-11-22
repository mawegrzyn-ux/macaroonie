// src/pages/docs/services.jsx
// The Docs page's "Services & Jobs" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, Code } from './parts.jsx'

export const id = 'services'
export const label = 'Services & Jobs'
export const order = 450

// ── SERVICES ────────────────────────────────────
export function Section() {
  return (
    <section id="services" data-doc="">
      <H2>Services &amp; Jobs</H2>
      <div className="space-y-4">
        {[
          {
            name: 'broadcastSvc.js',
            path: 'src/services/broadcastSvc.js',
            desc: 'Sends a WebSocket message to all admin clients subscribed to the venue. Call after every booking mutation.',
            code: "broadcastBooking('booking.created', booking)\nbroadcastBooking('booking.updated', booking)",
          },
          {
            name: 'WebSocket server',
            path: 'src/config/ws.js',
            desc: 'Runs on the same HTTP server. Auth via ?token= query param (Auth0 JWT), or ?pos_device=&secret= for a till (room pos:<venueId>). Rooms keyed by venue_id. The API runs as several PM2 processes and a socket belongs to one of them, so broadcast() delivers locally and publishes on Redis (channel macaroonie:ws); the other processes relay it to their sockets (each message carries its origin, so none is delivered twice). With Redis down only the sending process\'s clients hear it; the pages also poll.',
            code: "// Client subscribes:\n{ type: 'subscribe', venue_id: '<uuid>' }\n\n// Server pushes after mutations:\n{ type: 'booking.created' | 'booking.updated', booking: { ... } }",
          },
          {
            name: 'BullMQ queues',
            path: 'src/jobs/queues.js',
            desc: 'Redis-backed queues, a worker each, started by server.js in every API process: notifications (booking and order emails), hold-sweep (every minute: expired holds, online orders past their time, due menu releases), review-scrape (Apify reviews, jobs/reviewScrapeWorker.js), website-publish (scheduled publishes, jobs/publishWorker.js), gloriafood-poll (every minute), ai-cleanup (hourly: Pepper chat retention and audit clean-up, ai/erase.js cleanUpAi()). Repeat jobs are added at start-up and need Redis; BullMQ keeps one repeat per name however many processes add it.',
            code: null,
          },
          {
            name: 'DB helpers',
            path: 'src/config/db.js',
            desc: 'Core database abstraction. Handle carefully.',
            code: "// withTenant — transaction with RLS context\nawait withTenant(tenantId, async tx => {\n  const [row] = await tx`SELECT * FROM bookings WHERE id = ${id} AND tenant_id = ${tenantId}`\n  return row\n})\n\n// withSystem — system mode (migration 176), only to find the tenant first\nawait withSystem(async tx => {\n  const [t] = await tx`SELECT tenant_id FROM tenant_site WHERE subdomain_slug = ${slug}`\n  return t\n})",
          },
        ].map(item => (
          <div key={item.name} className="border rounded-lg p-4">
            <div className="flex flex-wrap items-baseline gap-2 mb-1">
              <span className="font-semibold text-sm">{item.name}</span>
              <code className="text-xs text-muted-foreground">{item.path}</code>
            </div>
            <p className="text-sm text-muted-foreground mb-3">{item.desc}</p>
            {item.code && <Code>{item.code}</Code>}
          </div>
        ))}
      </div>
    </section>
  )
}
