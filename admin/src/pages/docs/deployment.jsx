// src/pages/docs/deployment.jsx
// The Docs page's "Deployment" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, Code, DataTable, InfoBox } from './parts.jsx'

export const id = 'deployment'
export const label = 'Deployment'
export const order = 480

export function Section() {
  return (
    <section id="deployment" data-doc="">
      <H2>Deployment</H2>
      <H3>Hosts</H3>
      <DataTable
        head={['Host', 'Serves', 'Where']}
        rows={[
          ['office.macaroonie.com', 'The admin portal (admin/dist) plus the API paths', 'nginx: scripts/nginx-office-ops.sh'],
          ['ops.macaroonie.com', 'The same admin build; / goes to /mobile/, the SPA sends any non-/mobile route to /mobile (IS_OPS_HOST in lib/hosts.js), and the page links /ops.webmanifest (scope /) so Android installs it as its own app', 'nginx: scripts/nginx-office-ops.sh'],
          ['macaroonie.com (and www.)', 'The platform page: features, franchises, who it is for, roadmap (EPOS, kitchen screens, kiosks, loyalty; AI insights, AI assistant, MCP), how we build, team and the register-interest form (routes/platformSite.js, views/platform/landing.eta, plain HTML, edit the copy there). Other GETs 301 to the same path on office.; API paths (/api, /manage, /reservations, /widget-api, /ws, /webhooks, /uploads, /order-api) pass through; /sw.js is a service worker that removes itself so an admin installed on the apex stops showing', 'nginx: scripts/nginx-apex-landing.sh'],
          ['screens.macaroonie.com', 'The menu screens\' player (screen/, routes/screenSite.js), /screen-api and /ws', 'wildcard server block (nothing to set up)'],
          ['{slug}.macaroonie.com', 'Tenant sites (routes/siteRenderer.js). office, ops, pos and screens are in RESERVED_SUBDOMAINS', 'wildcard server block'],
          ['Custom domains (www.yourrestaurant.com)', 'Tenant sites, matched by tenant_site.custom_domain', 'nginx: the domain sync (scripts/custom-domains-sync.sh, systemd timer installed by the deploy) runs scripts/nginx-custom-domain.sh per verified domain (Website CMS → Custom domain lifecycle)'],
        ]}
      />
      <P>
        <Mono>services/platformHost.js</Mono> (<Mono>platformHostKind(host)</Mono>,{' '}
        <Mono>officeOrigin()</Mono>, <Mono>opsOrigin()</Mono>) is the API's one host check; the
        admin's is <Mono>lib/hosts.js</Mono> (<Mono>IS_OPS_HOST</Mono>, <Mono>IS_OFFICE_HOST</Mono>,{' '}
        <Mono>mobileHref()</Mono>, <Mono>standardHref()</Mono>), used by{' '}
        <Mono>MobileViewToggle</Mono> and <Mono>MobileSuggestModal</Mono> to switch host instead of
        route on office./ops. On any other host (localhost) both views stay in one origin.
        The platform page hook is global (<Mono>fastify-plugin</Mono>) and registered before every
        route plugin in <Mono>app.js</Mono>.
      </P>
      <H3>Moving to office / ops (one-off, in order)</H3>
      <ol className="list-decimal pl-5 space-y-1.5 text-sm mb-4">
        <li>DNS: the wildcard <Mono>*</Mono> record covers office and ops; without one, add A records for both.</li>
        <li><Mono>sudo DOMAIN=macaroonie.com bash scripts/nginx-office-ops.sh</Mono>: writes <Mono>sites-available/macaroonie-office</Mono> with HTTPS for both names (port 80 only answers ACME challenges and redirects). Certificate: <Mono>CERT_NAME</Mono> if given, else any certificate in <Mono>/etc/letsencrypt/live</Mono> covering both names (the <Mono>*.macaroonie.com</Mono> wildcard does), else <Mono>certbot certonly --webroot</Mono> on the existing certbot account (<Mono>CERTBOT_EMAIL</Mono> only if there is none). Certbot never edits the file. <Mono>DRY_RUN=1</Mono> prints the config.</li>
        <li>Auth0 (Applications → Macaroonie Admin → Settings): add office and ops to Allowed Callback URLs, Allowed Logout URLs and Allowed Web Origins; set Application Login URI to office.</li>
        <li>Check sign-in on office. and ops.</li>
        <li><Mono>sudo bash scripts/nginx-apex-landing.sh</Mono>: the apex <Mono>location /</Mono> and sw.js locations proxy to the API (backup kept; restored if <Mono>nginx -t</Mono> fails).</li>
      </ol>
      <P>
        Browser storage is per origin, so each person signs in once on the new address and their
        saved view settings (theme colour, timeline, last restaurant, shortcuts, launcher order) start
        from defaults once.
      </P>
      <P>
        If office returns the API's JSON 404 (<Mono>Route GET:/ not found</Mono>), the office block has no{' '}
        <Mono>listen 443</Mono> and the <Mono>*.macaroonie.com</Mono> tenant block is answering:{' '}
        <Mono>sudo nginx -T | grep -n "server_name\|listen"</Mono> shows it. If office redirects to itself,
        certbot's <Mono>if ($host = office…) {'{'} return 301 https://… {'}'}</Mono> sits in a block that now
        also serves 443. Both happened on the first run (Oct 2026, with <Mono>certbot --nginx</Mono>); running
        the current script again rewrites the file cleanly.
      </P>
      <H3>Register interest</H3>
      <P>
        <Mono>platform_interest</Mono> (migration 138): global, no RLS, like <Mono>backlog_items</Mono>.
        Written by <Mono>POST /api/platform-interest</Mono> (public, 5 per 10 minutes per IP,{' '}
        <Mono>consent: true</Mono> required, a filled <Mono>website</Mono> honeypot gets 204 and is not
        stored); read and changed by platform admins through <Mono>GET/PATCH/DELETE
        /api/platform/interest[/:id]</Mono> (status new | contacted | closed, notes). Admin UI:
        Platform page → Registered interest (<Mono>components/platform/InterestPanel.jsx</Mono>).
        With <Mono>INTEREST_NOTIFY_EMAIL</Mono> and <Mono>SENDGRID_API_KEY</Mono> set, each form is
        also emailed there (reply-to the sender).
      </P>
      <H3>Environment variables</H3>
      <DataTable
        head={['Variable', 'App', 'Description']}
        rows={[
          ['DATABASE_URL', 'API', 'postgres.js connection string (set by setup.sh)'],
          ['REDIS_URL', 'API', 'BullMQ + hold sweep. Update password to match Redis config.'],
          ['AUTH0_DOMAIN', 'API + Admin', 'Auth0 tenant domain'],
          ['AUTH0_AUDIENCE', 'API', 'JWT audience identifier'],
          ['STRIPE_SECRET_KEY', 'API', "Optional fallback for the platform's Stripe secret key (the Platform page's Payments tab wins). STRIPE_WEBHOOK_SECRET is gone (migration 220): the Connect webhook's secret is STRIPE_CONNECT_WEBHOOK_SECRET or the Payments tab."],
          ['VITE_AUTH0_DOMAIN', 'Admin', 'Auth0 domain for SPA login'],
          ['VITE_AUTH0_CLIENT_ID', 'Admin', 'Auth0 SPA client ID'],
          ['VITE_AUTH0_AUDIENCE', 'Admin', 'JWT audience (same as API)'],
          ['INTEREST_NOTIFY_EMAIL', 'API', 'Optional. Receives an email for each register-interest form on the platform page.'],
        ]}
      />
      <H3>Running locally</H3>
      <Code>{`# Prerequisites: Postgres 16, Redis 7, Node 22

# Apply migrations in order (001 → 023)
psql $DATABASE_URL -f migrations/001_tenants_users.sql
psql $DATABASE_URL -f migrations/002_venues.sql
psql $DATABASE_URL -f migrations/003_schedules.sql
psql $DATABASE_URL -f migrations/004_booking_rules.sql
psql $DATABASE_URL -f migrations/005_bookings.sql
psql $DATABASE_URL -f migrations/006_functions.sql
psql $DATABASE_URL -f migrations/007_seed_example.sql
psql $DATABASE_URL -f migrations/008_table_combinations.sql
psql $DATABASE_URL -f migrations/009_unallocated.sql
psql $DATABASE_URL -f migrations/010_allocation_rules.sql
psql $DATABASE_URL -f migrations/011_doors_close_time.sql
psql $DATABASE_URL -f migrations/012_reconfirmed_status.sql
psql $DATABASE_URL -f migrations/013_doors_close_per_sitting.sql
psql $DATABASE_URL -f migrations/014_schedule_exceptions.sql
psql $DATABASE_URL -f migrations/015_fix_get_available_slots.sql
psql $DATABASE_URL -f migrations/016_noslot_noshow_cancelled.sql
psql $DATABASE_URL -f migrations/017_seated_checked_out.sql
psql $DATABASE_URL -f migrations/018_customers.sql
psql $DATABASE_URL -f migrations/019_customer_visit_count.sql
psql $DATABASE_URL -f migrations/020_slot_start_filter.sql
psql $DATABASE_URL -f migrations/021_enable_arrived_status.sql
psql $DATABASE_URL -f migrations/022_slot_inclusive_last_order.sql
psql $DATABASE_URL -f migrations/023_sitting_names.sql

# API
cd api && cp .env.example .env   # fill in values
npm install && npm run dev        # :3000 with --watch

# Admin portal (separate terminal)
cd admin && cp .env.example .env  # fill in VITE_ values
npm install && npm run dev        # :5173, proxies /api → :3000`}</Code>
      <H3>Production deploy</H3>
      <P>
        Deployment is automated via <strong>GitHub Actions</strong> on every push. To deploy: run{' '}
        <Mono>git push</Mono> from the local laptop — the Actions workflow builds and restarts the
        API and admin portal automatically.
      </P>
      <InfoBox type="tip">
        Migrations are <strong>applied automatically</strong> by the deploy workflow
        via <Mono>api/scripts/migrate.js</Mono>. The runner tracks applied files in a
        <Mono>schema_migrations</Mono> table and only applies new ones — each in its
        own transaction. A failing migration aborts the deploy before the API restarts.
      </InfoBox>
      <H3>Migration runner</H3>
      <P>
        <Mono>api/scripts/migrate.js</Mono> is idempotent. Flags:
      </P>
      <DataTable
        head={['Flag / env', 'Effect']}
        rows={[
          ['--list',                  'Print applied/pending status for every file. No writes.'],
          ['--baseline',              'Mark ALL existing migration files as applied without running any SQL. Use once on a server whose schema was built manually.'],
          ['--baseline-up-to NNN',    'Same, but only mark files up to and including NNN.'],
          ['AUTO_BASELINE_UP_TO=NNN', 'Env var. On first run only (schema_migrations empty) AND with a pre-existing "tenants" table, auto-baseline up to NNN. No-op on every subsequent run. The deploy workflow sets this to 024 as a safety net for existing Lightsail deployments.'],
        ]}
      />
      <H3>Building from empty (CI)</H3>
      <P>
        The live server&apos;s schema was built up one deploy at a time, so nothing showed that
        the migrations no longer ran on an empty database: 062 and 063 truncated the order sheet
        tables one statement at a time, and 090 truncated <Mono>fs_hold_checks</Mono> on its own.
        Postgres refuses to truncate a table that another table references (even an empty one)
        unless both are in the same statement or <Mono>CASCADE</Mono> is given; all three now use
        one <Mono>TRUNCATE ... CASCADE</Mono>. 001 made{' '}
        <Mono>pg_cron</Mono> a hard requirement, which most hosted and CI Postgres don&apos;t have:
        001 now creates the extension only if it can (a notice otherwise), and 006 schedules the
        hold sweep with <Mono>cron.schedule()</Mono> only when the extension is there. The app&apos;s
        own BullMQ hold sweep (<Mono>holdSweepQueue</Mono>) is the primary sweep either way.
      </P>
      <P>
        <Mono>.github/workflows/ci.yml</Mono> runs on every pull request and every push to main:
        job <Mono>database</Mono> migrates an empty Postgres 16 (no pg_cron) from 001, runs the
        migrations a second time expecting "up to date", then starts the API against it with
        Redis and waits for <Mono>/api/health</Mono>; job <Mono>shared-tests</Mono> runs{' '}
        <Mono>node --test shared/test/*.test.mjs shared/pos/test/*.test.mjs</Mono>; job{' '}
        <Mono>api-tests</Mono> migrates its own empty <Mono>macaroonie_test</Mono> database and
        runs <Mono>npm test</Mono> in <Mono>api/</Mono> (below). Separate from the deploy
        workflow; a failing check doesn&apos;t block a push to main on its own (set up a branch
        rule in GitHub for that).
      </P>
      <H3>Testing: the API tests (api/test)</H3>
      <P>
        <Mono>npm test</Mono> in <Mono>api/</Mono> runs <Mono>api/test/*.test.mjs</Mono> with
        Node&apos;s test runner, one file at a time, against the real app (<Mono>buildApp()</Mono>,{' '}
        <Mono>app.inject()</Mono>, no network port). They empty the database first, so they
        refuse to run unless the database name in <Mono>DATABASE_URL</Mono> contains{' '}
        <Mono>test</Mono>; migrate it first (<Mono>node scripts/migrate.js</Mono>). They need
        Redis like the API. <Mono>LOG_LEVEL=info npm test</Mono> shows the API&apos;s log (silent
        otherwise). A run takes about four minutes. It uses the spec reporter, which ends with
        every failing test and its error, so the end of the CI job&apos;s log says what failed:
        the job also turns the Postgres service&apos;s log down to FATAL, because GitHub prints
        that log after the tests and the sweep makes thousands of expected errors.
      </P>
      <DataTable
        head={['File', 'What it is']}
        rows={[
          ['test/support/register.mjs + loader.mjs', 'Loaded with --import: every import of src/middleware/auth.js gets auth-stub.mjs instead.'],
          ['test/support/auth-stub.mjs', 'The real auth module with one change: requireAuth takes "Authorization: Bearer test:<auth0 sub>" plus X-Tenant-Id (no Auth0) and checks the person against users / platform_admins like the real one. Permissions, roles and modules are the real code.'],
          ['test/support/app.mjs', 'getApp(), as(sub, tenantId) (a client per person: get / post / put / patch / delete / request, with the internal-call header so tests aren\'t rate limited), ok() (throws with the API\'s message), closeApp().'],
          ['test/support/seed.mjs', 'resetAndSeed(): empties the tenants and the platform tables, makes the platform admin, then two tenants through POST /api/platform/tenants (Thai House = A, Other Co = B) with one person per role in A and an owner in B.'],
          ['test/support/fixtures.mjs', 'fillTenant(sub, tenantId, { mark, slug }): a tenant\'s data in every area, made through the API as its owner (venues, tables, schedule incl. overrides, exceptions and caps, bookings, holds, customers, menus with options, allergens and a release, rota and tips, Cash Recon days and wages, food safety, checklists, dashboards, purchasing, website, promotions, till, kitchen, screens, Pepper). Returns { ids, failed, writes }: writes is every write that worked (the sweep sends them again as the other tenant). The mark goes in names and notes.'],
          ['test/support/fake-claude.mjs', 'A stand-in Claude API: answers POST /v1/messages from a script, as a stream of server-sent events when asked; sets ANTHROPIC_BASE_URL.'],
          ['test/tenant-sweep.test.mjs', 'The cross-tenant sweep (below).'],
          ['test/ai-chat.test.mjs', 'Pepper\'s chat loop against the stand-in Claude: streamed turns, the JSON reply, busy chats, errors after the stream opened, withdrawn and refused messages, model routing.'],
          ['test/menu-order.test.mjs', 'A menu saved without positions keeps the order it was sent in (sections, dishes, options, groups, notes, the published copy too); dishes with equal positions come back by name.'],
        ]}
      />
      <H3>The cross-tenant sweep</H3>
      <P>
        Both tenants are filled with <Mono>fillTenant()</Mono> (B with its own mark, so A&apos;s
        mark <Mono>Zqx</Mono> appears only in A&apos;s data). Then, as B&apos;s owner:
      </P>
      <DataTable
        head={['Test', 'Fails when']}
        rows={[
          ['Every route that takes a parameter', 'Called with A\'s ids, and with B\'s own ids mixed in (B\'s venue with A\'s sitting): about 53,000 calls. A reply holds A\'s mark or an id of A\'s it wasn\'t sent; any of A\'s rows changes (an md5 per table over A\'s rows after each route); a 500. Ids come from every table with a tenant_id, one per table per tenant; named parameters (KINDS: venueId, sid, ...) get ids from their tables, :id gets all of them.'],
          ['Every write A made, sent again', 'Each write in fixtures\' writes, as A sent it and with each of A\'s ids in the address swapped for B\'s id from the same table (valid bodies, so the route gets past its validation): A\'s rows change, a record of A\'s named in the address is accepted, a reply holds an id of A\'s it wasn\'t sent, or a 500. Accepted with A\'s ids in the body only is listed, and left to the last test.'],
          ['None of B\'s rows point at A\'s', 'Any row of B\'s, as text (jsonb included), holds an id of A\'s; or a link table without a tenant_id (table_combination_members) joins two tenants\' rows.'],
        ]}
      />
      <P>
        Public routes (widget, ordering, website, devices, webhooks, MCP) are left out: they are
        reached by an id or token by design. A deliberate exception is listed with its reason:{' '}
        <Mono>ALLOWED_CHANGES</Mono> (B upvoting A&apos;s feature request: one shared board) and{' '}
        <Mono>ALLOWED_REFERENCES</Mono> (that upvote&apos;s row). A new table is swept as soon as
        the fixtures make a row in it; a new route as soon as it is registered. When you add a
        table or a route that takes ids, add a fixture step that makes a row (through the API) so
        its ids are tried. Statuses 503 (no Auth0 or AI key on the test server) aren&apos;t
        failures.
      </P>
      <H3>Typical deployment flow</H3>
      <Code>{`# From the developer's laptop:
git push origin main
# The GitHub Actions workflow then:
#   1. SSH to Lightsail
#   2. git fetch + hard reset to origin/main
#   3. npm install (api)
#   4. node scripts/migrate.js   (auto-baselines then applies pending)
#   5. npm install + build (admin, then the till app in pos/)
#   6. pm2 restart macaroonie-api
#   7. nginx patches (sudo): /manage on the apex, SPA cache headers,
#      http2 on every https listen (ensure-nginx-http2.sh), big media
#      uploads (ensure-nginx-media-upload.sh), 5 minutes for Pepper's
#      chat (ensure-nginx-ai-timeout.sh), domain sync
#   8. health check on /api/health: tries every 2 s for up to 30 s,
#      then fails the deploy with the last 30 PM2 log lines`}</Code>
      <P>
        <Mono>scripts/ensure-nginx-http2.sh</Mono>: nginx 1.24 warns{' '}
        <Mono>protocol options redefined for 0.0.0.0:443</Mono> when server blocks on one address disagree about{' '}
        <Mono>http2</Mono> (certbot writes <Mono>listen 443 ssl;</Mono>, the custom domain script{' '}
        <Mono>listen 443 ssl http2;</Mono>). http2 belongs to the listening socket, so once one block on an
        address has it every name there is served over HTTP/2 already; the script adds <Mono>http2</Mono> to the
        other <Mono>listen ... ssl</Mono> lines on that address (in the files <Mono>sites-enabled</Mono> points at),
        runs <Mono>nginx -t</Mono> (restores every file and fails if it doesn&apos;t pass) and reloads. It never
        removes http2 and leaves addresses where no block has it alone.
      </P>
      <P>
        <Mono>scripts/ensure-nginx-ai-timeout.sh</Mono>: every admin server block proxies{' '}
        <Mono>/api/</Mono> with <Mono>proxy_read_timeout 60s</Mono>, and a Pepper turn (several
        model calls, a photo to read, a menu to build) replies only at the end, so a turn over a
        minute showed a 504 while the API carried on and saved the reply. Rather than raise the
        timeout for every route, the script puts{' '}
        <Mono>{'location ^~ /api/ai/ { ... }'}</Mono> in front of each{' '}
        <Mono>location /api/</Mono> block, with that block&apos;s proxy_pass and limit_req,{' '}
        <Mono>proxy_read_timeout</Mono> / <Mono>proxy_send_timeout 300s</Mono> and buffering off.{' '}
        <Mono>^~</Mono> makes the prefix final, so no regex location can take those paths. The
        chat loop stops starting new steps after 240 s to answer inside that. Same safety as the
        other scripts (idempotent, <Mono>nginx -t</Mono> or restore). It and{' '}
        <Mono>ensure-nginx-media-upload.sh</Mono> both insert before the same{' '}
        <Mono>location /api/</Mono> line, so each looks for its own block in the text since the
        previous <Mono>/api/</Mono> block (that server block&apos;s locations), not in a fixed
        number of characters, or the other&apos;s insert would hide it and it would add itself
        again on every deploy.
      </P>
      <H3>First-time baselining</H3>
      <P>
        On a server whose schema was built with hand-run <Mono>psql</Mono> before the
        runner existed, the auto-baseline env var handles this transparently — the first
        deploy populates <Mono>schema_migrations</Mono> with 001–024 and then applies 025
        onwards. You can also trigger this explicitly from the Actions UI:
      </P>
      <Code>{`# Option 1 — auto on next deploy (already wired in deploy.yml)
#   AUTO_BASELINE_UP_TO=024 is set by the workflow; nothing to do.

# Option 2 — manual (GitHub Actions UI)
#   Actions → "DB — baseline migration tracker" → Run workflow
#   up_to = 024 (default)

# Option 3 — via SSH
cd /home/ubuntu/app/api && set -a; source .env; set +a
node scripts/migrate.js --baseline-up-to 024`}</Code>
    </section>
  )
}
