// src/pages/docs/tech-stack.jsx
// The Docs page's "Tech Stack" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, DataTable } from './parts.jsx'

export const id = 'tech-stack'
export const label = 'Tech Stack'
export const order = 30

// ── TECH STACK ──────────────────────────────────
export function Section() {
  return (
    <section id="tech-stack" data-doc="">
      <H2>Tech Stack</H2>
      <DataTable
        head={['Layer', 'Technology', 'Purpose']}
        rows={[
          ['API runtime', 'Node.js 22, ESM', 'Native ES modules, no build step'],
          ['API framework', 'Fastify 4', 'Low overhead, built-in schema validation'],
          ['DB client', 'postgres.js (raw SQL)', 'Direct SQL — matches migrations exactly, no ORM magic'],
          ['Auth', 'Auth0 JWT + JWKS', 'Offloads auth entirely; multitenancy via Auth0 Organisations'],
          ['Payments', 'Stripe Connect', 'Each restaurant is a Connect account; platform takes fee'],
          ['Queue', 'BullMQ + Redis', 'Email jobs, hold expiry sweep fallback'],
          ['Validation', 'Zod', 'API request bodies and admin portal form schemas'],
          ['Admin UI', 'React 18, Vite', 'SPA with hot module replacement in dev'],
          ['Data / cache', 'TanStack Query v5', 'Server state, cache invalidation, background refetch'],
          ['Drag & drop', '@dnd-kit/core', 'Timeline drag-to-reschedule (mouse + touch sensors)'],
          ['Realtime', 'ws (WebSocket) + Redis pub/sub', 'Timeline, orders and till live updates; rooms keyed by venue_id, relayed between API processes through Redis'],
          ['Deployment', 'Ubuntu 24.04, Nginx, PM2', 'Single Lightsail instance'],
        ]}
      />
    </section>
  )
}
