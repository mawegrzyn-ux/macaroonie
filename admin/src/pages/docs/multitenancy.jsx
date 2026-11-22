// src/pages/docs/multitenancy.jsx
// The Docs page's "Multitenancy & RLS" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, Code, DataTable, InfoBox } from './parts.jsx'

export const id = 'multitenancy'
export const label = 'Multitenancy & RLS'
export const order = 50

// ── MULTITENANCY ────────────────────────────────
export function Section() {
  return (
    <section id="multitenancy" data-doc="">
      <H2>Multitenancy &amp; RLS</H2>
      <P>
        Every tenant table has a <Mono>tenant_id uuid</Mono> column, row-level security enabled{' '}
        <strong>and forced</strong> (migration 176), and one policy:
      </P>
      <Code>{`USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
       OR current_setting('app.bypass_rls', true) = 'on')`}</Code>
      <P>
        The app&apos;s database role owns the tables, and a table&apos;s owner isn&apos;t held to RLS
        unless the table forces it: before 176 the policies stopped nothing. Now a query sees only the
        rows of its transaction&apos;s tenant, or every row in <strong>system mode</strong>, and a
        query with neither (one on the bare <Mono>sql</Mono> pool) sees no tenant rows and can&apos;t
        write one. <Mono>NULLIF</Mono> is there because a pooled connection that had the setting in an
        earlier transaction returns <Mono>&apos;&apos;</Mono>, not NULL. Superusers skip RLS even when
        forced: production connects as <Mono>macaroonie_user</Mono> (not a superuser, owner of the
        tables), and the tests and CI run as a role that isn&apos;t one either.
      </P>
      <DataTable
        head={['Helper (config/db.js)', 'Use it for']}
        rows={[
          ['withTenant(tenantId, fn)', 'Everything that knows its tenant (every admin route, req.tenantId): a transaction with app.tenant_id set (set_config(..., true), so it ends with the transaction).'],
          ['tenantSql(tenantId)`...`', 'One statement in a tenant\'s transaction, as a tagged template (same as withTenant(tenantId, tx => tx`...`)).'],
          ['systemSql / withSystem(fn)', 'A second, small pool (5 connections) whose connections start in system mode (app.bypass_rls = \'on\' as a connection startup parameter). Only for work that crosses tenants on purpose: finding the tenant from a token, slug, device, push address or id (public pages, widget, ordering, MCP, access tokens, devices, webhooks, memberships in auth.js); background jobs and sweeps; the platform pages. A system query still filters tenant_id where it can.'],
          ['sql', 'The main pool. No tenant rows: only for global tables (platform_admins, platform_secrets, platform_interest, backlog_items) or inside withTenant().'],
        ]}
      />
      <Code>{`// A route: the caller's tenant
const rows = await withTenant(req.tenantId, tx =>
  tx\`SELECT * FROM venues WHERE id = \${venueId} AND tenant_id = \${req.tenantId}\`
)

// Finding the tenant first (a push address, a slug): system mode
const [link] = await systemSql\`SELECT tenant_id, venue_id FROM gloriafood_venue_links WHERE push_token = \${token}\`

// WRONG: no tenant, no system mode -> 0 rows, silently
const rows = await sql\`SELECT * FROM venues WHERE id = \${venueId}\``}</Code>
      <InfoBox type="warn">
        RLS failures are <strong>silent</strong>: the query returns 0 rows (or an UPDATE changes
        none), not an error. A path that finds its tenant itself and forgot system mode simply finds
        nothing. <Mono>api/test/system-paths.test.mjs</Mono> covers every such path (public pages,
        widget, ordering, website, till and screen pairing, MCP and access tokens, memberships,
        GloriaFood push, the feature board, platform pages, background jobs).
      </InfoBox>
      <DataTable
        head={['Special case', 'Policy']}
        rows={[
          ['feature_requests, feature_request_upvotes', 'One board every tenant reads and upvotes: a read-all policy (board_read) beside the tenant one; writes are still per tenant.'],
          ['screen_pairings', 'An unclaimed pairing (tenant_id NULL) is any tenant\'s to find by its code; routes/screens.js claims it inside the claiming tenant\'s transaction.'],
          ['table_combination_members', 'No tenant_id: a row is visible when its combination is (EXISTS on table_combinations).'],
          ['sweep_expired_holds()', 'pg_cron calls it with no tenant: it switches system mode on for its DELETE and back (a function\'s SET clause can\'t name a custom setting without superuser).'],
          ['Global tables', 'platform_admins, platform_secrets, platform_interest, backlog_items, schema_migrations: no tenant_id, no RLS; access is gated in the API.'],
        ]}
      />
      <P>
        Migrations run in system mode (<Mono>scripts/migrate.js</Mono> connects with{' '}
        <Mono>app.bypass_rls = on</Mono>), so a data migration sees every tenant&apos;s rows. A new
        table with a <Mono>tenant_id</Mono> must enable and force RLS with the same{' '}
        <Mono>tenant_isolation</Mono> policy in its own migration (176 only covered the tables that
        existed then; see 177&apos;s <Mono>kds_flows</Mono>). Only a table&apos;s owner can force RLS:
        176 refuses to run, listing them, when some tenant tables belong to another role (fix: as
        postgres, <Mono>ALTER TABLE ... OWNER TO macaroonie_user</Mono>).
      </P>
      <H3>Still filter tenant_id yourself</H3>
      <P>
        RLS is the backstop, not the filter. Every query still says{' '}
        <Mono>tenant_id = $&#123;req.tenantId&#125;</Mono> itself (it also helps the planner), and a
        row loaded by an id from the request must be checked to be the caller&apos;s, so another
        tenant&apos;s id is a clean 404. Routes whose URL carries a venue id
        (<Mono>/api/venues/:id/...</Mono>: schedules, venue settings, test data) register{' '}
        <Mono>requireOwnVenue(param)</Mono> from <Mono>middleware/venue.js</Mono> after{' '}
        <Mono>requireAuth</Mono>. System-mode code has no backstop at all, so its filters are the
        only ones. Test any route you touch with a second tenant&apos;s rows in the database, as a
        role that isn&apos;t a superuser.
      </P>
      <H3>Ids in the body: the venue guard and the route's own checks</H3>
      <P>
        A tenant filter on the row being changed isn't enough: a request can also name other
        rows in its body (a venue, a section, a staff member, an option group), and a route that
        inserts those ids as given makes the caller's rows point at another tenant's (and an
        override's sittings, or a wage default's staff names, could cross over). The
        cross-tenant sweep (Testing below), and a read of the routes it pointed at, found this in
        eight routes taking a venue id in the body and ten taking other ids. Two layers now
        stop it:
      </P>
      <DataTable
        head={['Layer', 'What it checks']}
        rows={[
          ['refuseOtherTenantsVenues (middleware/venue.js)', 'Added to every route by app.js (onRoute, last in the route\'s preHandlers, so after requireAuth). Any key venue_id / *_venue_id or venue_ids / *_venue_ids in the query string or JSON body, at any depth, naming a venue of another tenant: 404 "Venue not found". An id that is no venue at all passes (the route deals with it; a stale id in saved page blocks mustn\'t stop a save). Requests without a tenant (public pages) are left alone.'],
          ['The route', 'Every other id in a body: a table\'s section (venues.js), a combination\'s tables, a staff member\'s role (rota.js), a Cash Recon day\'s income sources, payment channels and SC sources and a wage week\'s staff (cashRecon.js assertVenueRows()), online ordering\'s menus (orders.js), a dish\'s option groups and options (upsertMenuTree() drops ids that aren\'t the tenant\'s, like unknown dietary codes), an override\'s sittings (schedules.js), translation keys (saveTranslations() skips keys for words the tenant hasn\'t got).'],
        ]}
      />
      <P>
        The venue guard can't know what a <Mono>design_id</Mono> or a <Mono>staff_id</Mono> is,
        so a new route that takes another kind of id in its body must check it itself, and the
        sweep only covers it once the fixtures make a row with that id.
      </P>
      <H3>Connection pooling</H3>
      <P>
        The API connects straight to Postgres (postgres.js pools, no pooler in front).{' '}
        <Mono>withTenant()</Mono> sets the tenant for its transaction only, so it is safe with any
        pooling. <Mono>systemSql</Mono> relies on a connection startup parameter: behind a
        transaction-mode pooler (PgBouncer) that wouldn&apos;t reach Postgres per transaction, and{' '}
        <Mono>withSystem()</Mono> would have to set <Mono>app.bypass_rls</Mono> with{' '}
        <Mono>set_config(..., true)</Mono> at the start of each transaction instead.
      </P>
    </section>
  )
}
