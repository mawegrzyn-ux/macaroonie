# Working in parallel: separating the code so several agents can build at once

**Status: a plan for the user to decide on (22 Nov 2026). Nothing in it is built.** The decisions to
make are section 9.

The ask (OUTSTANDING 46, 22 Nov 2026): the user agreed with the recommendation not to split the API
into microservices (one codebase, one database, one deploy), and set the outcome: *"be able to use
multiple agents to code in parallel"*, with deployment time kept short (a note, not a priority:
section 7). This plan is phases 1 and 2 of that: separating the code so agents working on different
areas don't edit the same files, and the guard rails that keep it that way. Running the background
jobs in a process of their own (the old step 1 of item 46) is section 8, later and optional.

## 1. What "done" looks like

- Two agents given different areas (say Kitchen and Loyalty) each make a feature, with its Help
  section, Docs section, changelog entry, routes, menu link, Pepper tools, tests and notes, and their
  two pull requests merge in either order **without a conflict**. Today that is impossible: both edit
  the same ten files (section 2).
- The only files several agents share are small, rarely changed and named: `shared/` rules an area
  doesn't own, `api/src/config/` (the core), the migration folder (each adds its own file), and
  `CLAUDE.md`. A change to one of them is said in the pull request's title.
- An agent can run the tests on the same machine as another agent without either wiping the other's
  test database, queues or files.
- CI tells an agent whether its pull request is good in well under the time it takes today.
- What the app does, how it is deployed and how long a deploy takes don't change in phases 1 and 2.

## 2. What collides today (measured 22 Nov 2026)

Files touched by most of the last 300 commits (`git log -300 --name-only`):

| File | Commits | Why every feature touches it | Size |
|---|---|---|---|
| `admin/src/pages/Docs.jsx` | 68 | the technical docs: one page, every area's section | 12,995 lines |
| `admin/src/pages/Help.jsx` | 63 | the operator guide: one page, every area's section | 9,581 lines |
| `CHANGE.md` | 63 | each entry is added at the top, so any two entries conflict | 4,608 lines |
| `CLAUDE.md` | 65 | mostly before the notes were split into areas on 21 Nov 2026 | now 28 KB |
| `api/test/support/fixtures.mjs` | 21 | one function makes every area's test rows (238 steps) | 728 lines |
| `api/test/reports-catalogue.test.mjs` | 19 | it pins the counts of subjects, tables and decisions | |
| `api/src/reports/catalogue/decisions.js` | 16 | every new table needs a line in it | |
| `api/src/reports/catalogue/index.js`, `starters/index.js` | 13 | lists of every area's subject and starter files | |
| `api/src/ai/prompts.js` | 13 | one line per area listing Pepper's tools | |
| `admin/src/main.jsx` | 13 | every page's route (118 routes) | 383 lines |
| `api/src/app.js` | 12 | every route file's registration (97) | 347 lines |
| `docs/claude/OUTSTANDING.md` | 12 | the backlog for every area | |
| `api/src/server.js`, `api/src/jobs/queues.js` | 10, 9 | every background job's queue and worker | |
| `shared/navSearch.js` | 9 | every page's search words and description | 463 lines |
| also | | `api/src/routes/nav.js` (`ROUTE_CATALOG`), `api/src/config/defaultNav.js` (`DEFAULT_NAV_TREE`), `api/src/config/modules.js` (`MODULES`), `api/src/ai/chat.js` (the words for each tool's activity), `api/src/ai/tools/index.js` (the tool list), `api/test/tenant-sweep.test.mjs` (`KINDS`), `api/src/services/platformStatus.js` (`JOBS`) | |

Rule 21 alone (a new admin page) touches six of these. A feature in any area usually touches
Help, Docs, `CHANGE.md`, the notes and two or three lists.

Not files but shared all the same, on one machine:
- **The test database.** `npm test` empties the database it runs on (rule 27), so two agents running
  tests against one database break each other's runs.
- **Redis.** The job queues have no prefix of their own (`api/src/jobs/queues.js` connects with
  `REDIS_URL` alone). A test run, a dev server and another agent's run all share the queues. On
  22 Nov 2026 the tenant sweep failed because a dev server on the same database and Redis sent the
  sweep's queued emails mid-run.
- **Folders.** The tests' private files go to one fixed temporary folder (`test/support/register.mjs`).

Migrations are **not** a collision: the runner (`api/scripts/migrate.js`) tracks each file by its
name, so if two branches both add a `267_...` file, both apply. Only the convention needs writing
down (3.13).

How tangled the areas are in the code: a rough name-based map of the 587 API and admin files to the
22 areas finds about 276 of 2,240 relative imports (those not into `shared/`) crossing from one
area into another (most common: menus, website and the shell into Pepper's files; website into
bookings; the till into the hub and menus). That is a starting estimate for phase 2's check (4.2),
not a list of problems: many are fine, through a service meant to be shared.

## 3. Phase 1: split the shared files (no change to what the app does)

The pattern is the same everywhere: **instead of one list that every area edits, each area has its
own file, and the list is gathered from the files.** Adding a feature then means adding or editing
files in its own area. Where the order matters (Help sections, the menu, Pepper's prompt), each
file carries its own order number, and ties are broken by name, so two new files never fight over a
place.

For the admin (Vite), the gathering is `import.meta.glob(...)`. For the API (Node), a small loader
reads a folder (`fs.readdirSync`) at start, or an area file lists what it adds. Both are standard and
need no new packages.

### 3.1 The Help page

- **Today:** `admin/src/pages/Help.jsx`, one file: a `SECTIONS` list (id and label) and 54
  `<section id=...>` blocks, plus the helpers `H2`, `H3`, `P`, `Mono`, `InfoBox`, `DataTable`.
  Pepper's `how_do_i` reads this file's source (`api/src/ai/helpIndex.js`, BM25 over its H2 and H3
  passages); `shared/help.js` makes the anchors (`helpSlug()`); `api/test/pepper-help-briefing.test.mjs`
  checks the index.
- **Proposed:** `admin/src/pages/help/` with one file per section, named after its id
  (`kitchen.jsx`, `loyalty.jsx`, ...), each exporting `{ id, label, order, Section }`, and
  `help/parts.jsx` with the helpers. `Help.jsx` keeps the page (the side list, the search, scrolling)
  and gathers the sections with `import.meta.glob('./help/*.jsx', { eager: true })`, sorted by
  `order`. The 54 sections today map onto the 22 areas; most areas have one to four.
- **Pepper's help:** `helpIndex.js` reads every file in `admin/src/pages/help/` in the same order
  instead of one file. Passages, anchors and links stay the same; `HELP_SOURCE_FILE` becomes
  `HELP_SOURCE_DIR`.
- **Checked by:** the page's text before and after, compared (a browser check prints both, which must
  be the same); the help index's passages before and after, compared (the same headings, text and
  links); `pepper-help-briefing.test.mjs`.
- **Bundle:** unchanged in size (the same text). The sections can later be loaded on demand
  (`eager: false`) to make the page lighter; not needed now.

### 3.2 The Docs page

The same pattern: `admin/src/pages/docs/<id>.jsx` for its 47 sections, `docs/parts.jsx` for
`H2`, `H3`, `P`, `Mono`, `Code`, `DataTable`, `InfoBox`. Nothing reads its source. Checked by
comparing the page's text before and after.

### 3.3 The changelog

- **Today:** `CHANGE.md`, newest at the top; every pull request adds at line 7, so any two conflict.
  Nothing in the code reads it (the in-app What's new page reads the `changelog_entries` table).
- **Proposed:** `changes/` with one file per change, `YYYY-MM-DD-<area>-<slug>.md` (a title line,
  then the bullets as now). `CHANGE.md` keeps everything up to the switch, with a line at the top
  pointing at `changes/`. A small script, `node scripts/changelog.js`, prints them all newest first
  (the old file after), for reading or pasting. The end-of-session rule in `CLAUDE.md` changes from
  "prepend to CHANGE.md" to "add a file to changes/".

### 3.4 The admin's routes

- **Today:** `admin/src/main.jsx` holds all 118 `<Route>`s (11 pages loaded on demand).
- **Proposed:** `admin/src/routes/<area>.jsx`, each exporting its routes as a list
  (`[{ path, element, shell: 'office' | 'mobile' | 'bare' }]`), with its pages' imports (on demand
  where they are today). `main.jsx` keeps the providers, the sign-in gate and the shells, and gathers
  the area files. The order of routes doesn't matter to React Router (it ranks by path), so the files
  need no order.
- **Checked by:** every address in the route list before and after (a script prints the paths from
  both), and the browser checks that open pages.

### 3.5 The API's route registration

- **Today:** `api/src/app.js` registers 97 plugins in a fixed order: first the infrastructure
  (helmet, CORS, rate limits, multipart, JWT, views, static files, the host sites: `platformSite`,
  `posSite`, `screenSite`, `installerSite`, `loyaltySite`, the payment webhooks), then the feature
  routes, most with a prefix.
- **Proposed:** the infrastructure stays in `app.js` in its order (the host sites' `onRequest` hooks
  must come first). The feature routes move to one file per area, `api/src/areas/<area>.js`,
  exporting `routes: [[plugin, { prefix }], ...]`; `app.js` loads every area file and registers
  them after the infrastructure. Fastify routes don't depend on their order, so the area files need
  no order.
- **Checked by:** `app.printRoutes()` before and after (the same routes, methods and prefixes), and
  the whole API suite with the tenant sweep (which walks every route).

### 3.6 The menu: pages, search words, descriptions, the standard menu

- **Today:** four lists per page in three files: `ROUTE_CATALOG` (`api/src/routes/nav.js`: path,
  label, module), `DEFAULT_NAV_TREE` (`api/src/config/defaultNav.js`: where it sits in the standard
  menu), `NAV_KEYWORDS` and `NAV_DESCRIPTIONS` (`shared/navSearch.js`). Plus a migration that adds the
  link to menus already saved (rule 21).
- **Proposed:** one record per page in its area's file, `shared/nav/<area>.js`:
  `{ path, label, module, keywords, description, section, order }`. The four lists are built from
  them (`shared/nav/index.js`), so `ROUTE_CATALOG`, `DEFAULT_NAV_TREE`, `NAV_KEYWORDS` and
  `NAV_DESCRIPTIONS` keep their shapes and every reader stays as it is. The migration for saved menus
  is still needed (it is a file of its own, so it doesn't collide).
- **Checked by:** the four lists before and after compared with `deepEqual` in a test, and the
  `nav-default` test's replay of every nav migration.

### 3.7 Modules and permissions

`api/src/config/modules.js` (`MODULES`, `MODULE_GROUPS`) is touched only when an area gets a new
module (a few times a month). It is the core of access control, so the plan **leaves it as one file**
and names it as a shared file (a change said in the pull request's title).

### 3.8 Pepper: tools, the prompt's lines, activity words

- **Today:** `api/src/ai/tools/` already has one file per area, but `tools/index.js` imports and
  spreads each, `api/src/ai/prompts.js` has one line per area naming its tools, and `api/src/ai/chat.js`
  has a map of every tool's activity words (`kitchen_report: 'Looked at kitchen speed'`).
- **Proposed:** each tool file also exports its prompt line (`promptLine`) and each tool its
  activity words (`activity` on the tool). `tools/index.js` gathers the folder (sorted by file name),
  `prompts.js` joins the lines in that order, and `chat.js` reads `activity` from the tools.
- **Why the order is fixed by name:** the system prompt is cached by the model provider; the same
  text in the same order on every request keeps the cache. Sorting by file name keeps it stable.
- **Checked by:** the system prompt's text before and after compared (it must be the same), the
  tools' names and schemas before and after, and the Pepper tests.

### 3.9 Background jobs

- **Today:** a job is added in three places: its queue in `api/src/jobs/queues.js`, its worker and
  repeat in `api/src/server.js`, its row on the Platform status in `JOBS`
  (`api/src/services/platformStatus.js`).
- **Proposed:** one file per job, `api/src/jobs/<name>.js`, exporting
  `{ name, label, every, queue, start(log) }`. `queues.js`, `server.js` and `JOBS` gather the folder.
  This is also what phase 3 (a worker process) would need: it starts the same list.
- **Checked by:** the queue names and repeat settings before and after, and the platform status test.

### 3.10 The report catalogue

- **Today:** the subjects are already one file per area (`api/src/reports/catalogue/*.js`), but
  `catalogue/index.js` lists them, `starters/index.js` lists the starter files, every new table needs
  a line in `catalogue/decisions.js`, and `reports-catalogue.test.mjs` pins exact counts
  (`{ subject: 129, planned: 0, settings: 57, out: 57 }`, 243 tables, 119 covered tables, the
  derived subjects, which subjects read some tables).
- **Proposed:** `index.js` and `starters/index.js` gather their folders (the catalogue's areas keep
  the order of `AREAS`, which stays in `index.js`). Each area's catalogue file exports its own
  `decisions` (the tables it doesn't report on, and why), and `decisions.js` gathers them. The test
  keeps every check that matters (each table decided once, each id column linked or skipped, every
  starter runs) and drops the exact counts, which only measured that nobody had added a table. The
  counts move to `node api/scripts/report-catalogue.js`, which prints them.
- **Checked by:** the catalogue's subjects, decisions and starters before and after compared.

### 3.11 Test fixtures and the tenant sweep's id kinds

- **Today:** `fillTenant()` in `api/test/support/fixtures.mjs` makes a whole tenant through the API
  in 238 steps, every area's rows in one function, in an order (venues and menus first, then what
  hangs off them). The tenant sweep's `KINDS` maps each id name in a route to its tables.
- **Proposed:** `api/test/support/fixtures/<area>.mjs`, each exporting `{ order, fill(ctx) }`;
  `fillTenant()` runs them by `order` and passes along what earlier ones made (`ctx.ids`), exactly
  as today's steps do. `KINDS` entries move beside each area's fixtures (`kinds` exported) and the
  sweep gathers them.
- **Checked by:** the rows `fillTenant()` makes before and after (counts per table compared), and the
  tenant sweep.

### 3.12 The notes

- `CLAUDE.md` and the area notes were split on 21 Nov 2026 (`docs/claude/areas/`,
  `docs/claude/history/`): already one file per area.
- `docs/claude/OUTSTANDING.md` (48 numbered items over every area) moves into one file per area,
  `docs/claude/outstanding/<area>.md`, with cross-area items (architecture, infrastructure) in
  `docs/claude/outstanding/general.md`. Item numbers stay as they are (history refers to them).
- `CLAUDE.md` gets the working rules of 4.6 and its file table the new folders. It stays a shared
  file, changed only when a rule that applies everywhere changes.

### 3.13 Migrations

A written convention, nothing to build:
- Name a new migration `NNN_<area>_<slug>.sql`, NNN one more than the highest on `main` when the
  branch starts. Two branches with the same number both apply (the runner tracks names), in name
  order, so the area in the name also decides which of two same-numbered files runs first.
- A migration never depends on one in another open branch. When it must, the second waits for the
  first to merge.
- A nav link migration (rule 21) is one per page, as now.

### 3.14 Order of work, size, and how to keep behaviour the same

1. Help and Docs (3.1, 3.2) and the changelog (3.3): the biggest win; one session. All mechanical
   moves; checked by comparing the pages' text and Pepper's index before and after.
2. Routes, the menu lists, jobs, Pepper (3.4 to 3.9): one session. Checked by comparing the
   gathered lists, route table, system prompt and tool schemas before and after.
3. Catalogue, fixtures, notes, conventions (3.10 to 3.13): one session.

Each step is one pull request. Every step's "before and after" comparisons are scripts kept in
`api/scripts/` while the step is under way and dropped after. **Moving code conflicts with every open
branch that edits the same files**, so each step should merge when no other branch is open on those
files (the user's call when to pause other work). Git keeps the history of moved text: `git log
--follow` and `git blame -C` find it.

## 4. Phase 2: guard rails

### 4.1 The area map

A file, `areas.json` at the root, saying which paths belong to which area: the 22 areas of
`docs/claude/areas/` plus `core` (config, middleware, db, the shells) and `shared` (rules more than
one area uses, kept in `shared/`). Each area lists its globs in `api/`, `admin/`, `pos/`, `screen/`,
`hub/`, `shared/` (the rules it owns, such as `shared/pos/kitchen*.js` for Kitchen), its tests, its
Help and Docs files, its notes, nav and fixture files. A script lists files that no area claims or
that two claim; the first version is drafted from the key files in each area's notes and then
checked by hand.

### 4.2 An import check

`node scripts/check-areas.js`, run in CI:
- A file may import from its own area, `core`, `shared/`, and another area's **public** files only
  (each area names its public files in `areas.json`, such as `api/src/services/kitchenSvc.js` for
  what other areas may call).
- It starts with a **baseline**: the cross-area imports that exist when it is switched on (a rough
  estimate today: about 276) are listed in `areas-baseline.json` and allowed. A new one fails CI with
  the file, the import and the areas. The baseline only shrinks: a list of the worst pairs is kept to
  untangle when an area is being worked on anyway (no big clean-up project).

### 4.3 Saying what a pull request touches

A short check in CI comments on the pull request (or fails, decision D3) with the areas its files
belong to, from `areas.json`, and names any shared file it changes (`shared/` rules owned by another
area, `api/src/config/`, `CLAUDE.md`, a migration). An agent working on one area that finds it needs
a change in another area's files makes that a separate, small pull request first.

### 4.4 Faster CI

- **Today:** one job runs all 132 API test files one after another (`--test-concurrency=1`, one
  database), beside the migration check and the shared tests (which take about 30 seconds each).
  The API job is the long one: 18 minutes for 913 tests on pull request #489 (22 Nov 2026), of
  which the tenant sweep is about 2.5 minutes.
- **Proposed:** split the API tests into four to six parallel jobs (a GitHub Actions matrix), each
  with its own Postgres and Redis service, the files shared out by a fixed list so slow ones are
  spread; the tenant sweep (the slowest single file) as its own job. The total work is the same; the
  answer comes back several times sooner. It uses more GitHub Actions minutes (decision D4).
- Not proposed: running only the tests of the areas a change touches. The tenant sweep and the
  cross-area tests catch what an area's own tests miss, and they are the point of CI.

### 4.5 Test runs that don't collide on one machine

For agents working side by side on one computer (cloud sessions each have their own container and
need none of this):
- `scripts/test-env.sh <name>`: makes a test database `macaroonie_test_<name>` owned by the
  non-superuser test role, migrates it, and prints the environment to use.
- A Redis prefix for the queues (`QUEUE_PREFIX`, default `bull` as now) and a Redis database number
  per run, set by the same script.
- The tests' private and upload folders named after the run (`register.mjs` uses the run's name).

### 4.6 How agents work (rules for `CLAUDE.md`)

- One area per task. Read that area's notes first (as now); change files in that area's paths; name
  any shared file changed in the pull request's title.
- A branch per task, from the latest `main`; merge `main` in before opening the pull request.
- A Help section file, a Docs section file, a changelog file and the area's notes and outstanding
  file for every feature, all in the area's own files.
- Migrations by the convention of 3.13; a new table also gets its catalogue decision in its area's
  catalogue file and its fixture rows in its area's fixture file (rules 3 and 28 as now).
- A change to `shared/` that another area owns, `api/src/config/` or `CLAUDE.md`: its own small pull
  request first.

### 4.7 Merging

With several pull requests a day, two can each pass CI and still break `main` together. GitHub's
**merge queue** tests each one on top of the others before it merges (decision D5). Without it,
"require branches to be up to date before merging" does the same more slowly.

## 5. What doesn't change

- What the app does, its pages, routes, menus, permissions, Pepper's answers, reports and data.
- The database, migrations already applied, the deploy workflow, the server.
- The shared rules in `shared/` (rule 12): they stay one implementation each; only lists of them are
  gathered differently.

## 6. Risks

- **Open branches during the moves.** Each phase 1 step conflicts with any branch editing the files
  it moves. Mitigation: one step at a time, merged when nothing else is open on those files.
- **Something left out when gathering.** A section, route, tool or job missed by a glob or loader.
  Mitigation: every step compares the gathered result with the old one, item by item, before the old
  file goes.
- **Pepper's system prompt changing order** and losing the provider's cache. Mitigation: the order is
  fixed by file name and compared before and after (3.8).
- **The import check getting in the way.** Mitigation: it starts from a baseline and only refuses new
  crossings; the area map can name more public files when a crossing is meant.
- **More CI minutes** with parallel jobs (D4).

## 7. Deploy time (a note)

Today a deploy (`.github/workflows/deploy.yml`, over SSH) runs `npm install` for the API, the
migrations, `npm install` and a build for the admin, `npm install` and a build for the till app,
then a PM2 restart and a health check, every time, whatever changed. The builds are most of the time.
Ways to cut it, not part of phases 1 and 2:
- Skip the admin or till build when nothing under `admin/`, `pos/` or `shared/` changed since the last
  deploy (compare the commits).
- Build the admin and till in GitHub Actions and copy the built files, so the server only installs
  the API and restarts.
- `npm ci` with the lockfile instead of `npm install` (the till app has no lockfile yet: add one).

## 8. Phase 3, later and optional: background jobs in a process of their own

Item 46's first step: the BullMQ workers, sweeps and schedules (which run inside every API process
today) start in one worker process instead, from the same code (`ROLE=worker`), as a second entry in
`ecosystem.config.cjs`, restarted by the same deploy. It makes background work and requests stop
slowing each other down; it doesn't help agents work in parallel, so it waits. 3.9 prepares it.

## 9. Decisions for the user

- **D1** Phase 1 all at once (pause other work for about three sessions) or one step at a time between
  other work (each step needs a moment when no branch is open on the files it moves)?
- **D2** The changelog as one file per change in `changes/`, with `CHANGE.md` kept as the history
  (recommended), or keep `CHANGE.md` and accept a conflict on every pair of pull requests?
- **D3** The pull request area check (4.3): a comment only (recommended to start), or fail CI when a
  pull request touches more than one area without saying so?
- **D4** Parallel API test jobs in CI (4.4): faster answers for more GitHub Actions minutes. Yes or
  no?
- **D5** GitHub's merge queue (4.7), or "branches must be up to date" (slower), or neither?
- **D6** How agents will run: cloud sessions (each its own container, nothing more needed) or several
  on one computer (4.5 needed)?
