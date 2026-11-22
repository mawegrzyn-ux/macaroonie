// src/pages/docs/architecture.jsx
// The Docs page's "Architecture" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, P, Mono, Code } from './parts.jsx'

export const id = 'architecture'
export const label = 'Architecture'
export const order = 20

// ── ARCHITECTURE ────────────────────────────────
export function Section() {
  return (
    <section id="architecture" data-doc="">
      <H2>Architecture</H2>
      <Code>{`┌──────────────────────────────────────────────────────────┐
│                    Guest / Operator                       │
└──────────────┬───────────────────────────┬───────────────┘
               │ Booking Widget             │ Admin Portal
               │ (iframe / Ember.js)        │ (React / Vite)
               ▼                            ▼
┌──────────────────────────────────────────────────────────┐
│                   Fastify API  (:3000)                   │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ /slots  │  │/bookings │  │/payments │  │/venues  │  │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬────┘  │
│       └────────────┴─────────────┴──────────────┘       │
│               withTenant() / Row-Level Security          │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
   ┌───────────▼──────────┐  ┌────────────▼──────────┐
   │  PostgreSQL 16        │  │  Redis 7 / BullMQ     │
   │  RLS per tenant       │  │  Email & hold sweep   │
   └──────────────────────┘  └───────────────────────┘
               │
   ┌───────────▼──────────┐
   │  Auth0 (JWT / JWKS)  │
   │  Org-scoped tokens   │
   └──────────────────────┘`}</Code>
      <P>
        Infrastructure: single AWS Lightsail instance (Ubuntu 24.04). Nginx reverse-proxies{' '}
        <Mono>/api</Mono> to port 3000 and serves the admin SPA as static files.
        PM2 manages the Fastify process with auto-restart.
      </P>
    </section>
  )
}
