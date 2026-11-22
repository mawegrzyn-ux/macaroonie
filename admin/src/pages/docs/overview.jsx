// src/pages/docs/overview.jsx
// The Docs page's "Overview" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Code } from './parts.jsx'

export const id = 'overview'
export const label = 'Overview'
export const order = 10

// ── OVERVIEW ────────────────────────────────────
export function Section() {
  return (
    <section id="overview" data-doc="">
      <H2>Overview</H2>
      <P>
        Macaroonie is a multitenant restaurant table booking platform for the F&amp;B / QSR franchise sector.
        Operators register their restaurant as a tenant. Each tenant configures venues, tables, opening schedules,
        booking rules, and deposit requirements via this admin portal. Guests book through an embeddable booking
        widget (iframe / Ember.js). Owner: Obscure Kitty.
      </P>
      <H3>Repo structure</H3>
      <Code>{`/
├── api/          Node.js API (Fastify)
├── admin/        React admin portal (Vite)
├── migrations/   PostgreSQL migration files (001–021, run in order)
├── setup.sh      One-shot Lightsail server setup
├── deploy.sh     Subsequent deployments
└── CLAUDE.md     Developer context: the index and rules (notes per area in docs/claude/)`}</Code>
    </section>
  )
}
