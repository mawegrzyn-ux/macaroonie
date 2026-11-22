# Estimates against actuals

The owner asked (22 Nov 2026) to record, for every feature step, the estimate made before it
and what it actually took, with the model and effort used, so estimates get more accurate over
the next 50 or so backlog items. Revise the scale after each feature, and compare the next
feature's estimates with its actuals.

## How each step is recorded

- **Estimate**: written before the step starts, in agent sessions (the scale below), and never
  changed afterwards. A revised scale applies to the next feature, not the current one.
- **Build**: from the first tool call on the step to its commit (code, tests, Help, Docs, notes,
  changelog done and checked).
- **Merge**: from opening the pull request to merging it (CI and fixes). Waiting for the agent to
  come back to a green pull request counts: it is real time to done.
- **Total**: build plus merge. Deploy time is noted but not counted (the server, not the work).
- **Model and effort**: from the session (`get_session`: `session_context.model`, `effort_level`).
- **Cost**: the session's `cost_usd` only updates between turns, so it is read where a step
  starts and ends on a turn boundary, else left blank.
- Times are UTC from the container clock. Steps that overlap (one building while another waits
  on CI) are timed on their own clocks and the overlap noted.
- **Detail** (since 22 Nov 2026): `node scripts/session-timings.mjs --log <session log> --from <ISO>
  --to <ISO> --commits <a>..<b>` reads the session's own log (`~/.claude/projects/<project>/<session>.jsonl`)
  and gives, for the window: tool calls and model messages, time in tools by phase (find and read
  code, edits, test runs, builds, waits for background runs and CI, pull requests), the model's own
  time between calls, the slowest calls, tokens and an estimated cost at list prices, and the lines
  the commits changed by kind (code, tests, docs and notes, migrations). Phases are guessed from the
  tool and the shell command's words. Add its numbers to the step's detail below.

## Scale used for the 22 Nov 2026 backlog estimates

One session = one focused agent task of roughly 2 to 4 hours ending in a tested pull request.
XS under half a session, S about 1, M 2 to 3, L 4 to 8, XL more than 8.

## Steps

| Feature step | Estimate | Build | Merge | Total | Size | Model / effort | Notes |
|---|---|---|---|---|---|---|---|
| 48.1 Catalogue type: migration, shared rule, release, editor | 1.5 to 2 sessions (3 to 8 h) | 9 min (18:00:08 to 18:08:53) | 13 min (PR #491 opened 18:13:10, CI green 18:19:00, merged 18:26:30) | **22 min** | 15 files, +326 lines, migration 267 | claude-opus-5-5 / high | Plus 4 min showing the owner D1 to D4 before. Design fully written in `docs/CATALOGUE.md`; followed the tax inheritance path. Merge waited 7 min on the agent after CI went green. No browser check. Deploy 699 to 700 not counted. |
| 48.2 Allergen surfaces leave non-food out | 1 to 2 sessions (2 to 8 h) | 14 min (18:13:21 to 18:27:07) | 5 min (PR #492 opened 18:27:51, CI green 18:32:23, merged 18:32:32) | **19 min** | 16 files, +133 lines | claude-opus-5-5 / high | Built while 48.1's CI ran (overlap about 6 min). 65 related test files (391 tests) run once. |
| 48.3 Kitchen skips retail and services | 1 session (2 to 4 h) | 6 min (18:28:03 to 18:34:02) | 5 min (PR #493 opened 18:34:15, CI green 18:39:03, merged 18:39:08) | **11 min** | 15 files, +71 lines | claude-opus-5-5 / high | Built while 48.2's CI ran. Not covered by a test: the online order and kiosk paths (the till rule is). No per-section switch back on. |
| 48.4 Codes, barcodes, option codes, till scan | 2 to 3 sessions (4 to 12 h) | 12 min (18:39:19 to 18:50:59) | 5 min (PR #494 opened 18:51:13, CI green 18:56:25, merged 18:56:30) | **17 min** | 20 files, migration 268, a new table | claude-opus-5-5 / high | Chose a new table for option codes over the plan's reuse of the price rows (they mean "own price" to the editor, reports and release). Till scan not tried with a real scanner; kiosk and online ordering don't scan. |
| 48.5 Menu or Catalogue words, group setting | 1 session (2 to 4 h) | 7 min (18:56:46 to 19:04:05) | 6 min (PR #495 opened 19:04:15, CI green 19:10:07, merged 19:10:12) | **13 min** | 15 files, migration 269 | claude-opus-5-5 / high | About 4 of the 7 min was waiting on the related tests. The website's own words and the phone app's Menus tile aren't changed. |
| 48.6 Type in reports | 1 session (2 to 4 h) | 25 min (19:04:25 to 19:29:54) | 6 min (PR #496 opened 19:29:58, CI green 19:35:58, merged 19:36:05) | **31 min** | 10 files | claude-opus-5-5 / high | About 12 min went on a smart builder test that failed: the new dish fields, linked into every subject reaching dishes, pushed Dishes sold out of DETAIL_BUDGET. Fixed by keeping product code and barcode out of reports. Built while 48.5's CI ran. |
| Timing script and feature 48's detail (not a backlog item) | not estimated | 1.8 min (19:36:36 to 19:38:21) | 6 min (PR #497 opened 19:43:11, CI green 19:48:54, merged 19:48:59) | **8 min** | script +165, docs +57 | claude-opus-5-5 / high | Build: 7 tool calls, 15 messages, 0.6 min of the model's time, about $3. Merge: 5 calls, 5.7 of its 6 min waiting on CI, about $0.90. A docs-and-script change still waits a full CI run. |
| 44.11.1a Deep link plumbing: what each page accepts, `useDeepLink()`, `pageLink()` | revised scale: 20 to 30 min build + 6 merge | | | | | | Estimated 22 Nov 2026 19:56 before starting. Built by a fresh agent (cost test). |
| 44.11.1b Six pages open at a venue, day or week, and tab (Timeline, Bookings, Rota, Food safety, Online orders, Cash Recon) | revised scale, doubled (the plan doesn't look inside the pages): 40 to 60 min build + 6 merge | | | | | | |
| 44.11.1c `open_page` links with context, and one page matcher (its own scorer and synonyms folded into the menu search) | revised scale: 20 to 40 min build + 6 merge | | | | | | One pull request for 1a to 1c (one CI run). |

## Running totals

| Features done | Steps | Estimated (h, low to high) | Actual (h) | Actual / estimate (midpoint) |
|---|---|---|---|---|
| 48 Menus as catalogues | 6 of 6 merged | 17 to 48 (8.5 to 12 sessions) | 1.88 (113 min) | about 0.06 (actual / estimate midpoint of 32.5 h) |

## The backlog estimates being tested (22 Nov 2026)

From the backlog review of 22 Nov 2026 (all open work / the parts that matter, in sessions).
Kept here unchanged so actuals can be compared with them.

| Item | All open | Matters | | Item | All open | Matters |
|---|---|---|---|---|---|---|
| 4 RBAC | 1 to 1.5 | 1 | | 30 Card machines | 9 to 14 | 2.5 |
| 5 Custom domains | 1 to 1.5 | 1 | | 31 Venue wizard | 3 | 1.5 |
| 6 Email loose ends | XS | XS | | 32 Invoices | 2 to 4 | 0.7 |
| 8 Test suite | 5 to 9 | 2 | | 33 Kiosk analytics | 3 to 4 | 1 |
| 9 More phone pages | 2 to 3 | 1 | | 34 Loyalty | 12 to 20 | 2.5 |
| 13 Sticky headers | XS | XS | | 35 Android app | 4 to 8 | 1.5 |
| 14 Web ordering | 12 to 17 | 3 | | 36 Stripe | 9 to 14 | 2.5 |
| 15 Pepper | 10 to 20 | 2.5 | | 37 Today | 1 | 0.5 |
| 16 Purchasing | 15 to 28 | 6.3 | | 38 Use level | 2 to 4 | 1 to 2 |
| 17 Loyverse | 2 | not code | | 39 Order flows | 5 to 7 | 2.5 |
| 18 POS | 18 to 35 | 6.5 | | 40 Menu entries | 4 to 6 | 0 |
| 19 Deliveroo file | 4 to 8 | 2 | | 41 Report builder | 8 to 15 | 2.5 |
| 20 GloriaFood | 3 to 5 | 1 | | 43 Local info | 4 to 6 | 1 |
| 21 Publishing | 4 to 7 | 3 | | 44 leftovers (1, 6, 8, 9) | about 5 | about 5 |
| 22 Menu screens | 5 to 7 | 1.5 | | 44.11 Pepper-first steps 0 to 8 | 32 to 55 | 0 to 4: about 20 |
| 23 Kitchen screens | 10 to 18 | 3.5 | | 45 Platform board | 2 to 4 | 1 |
| 24 Tax and types | 3 to 6 | 2.5 | | 46 Phase 3 worker | 1 to 2 | 0 |
| 25 Combos | 4 to 8 | 2.5 | | 47 Sales import | 16 to 24 | 1, 2, 4: about 10 |
| 26 Kiosks | 4 to 8 | 1.5 | | 48 Catalogues | 7 to 10 | 1 and 2: about 3 |
| 27 Installer | 3 | 1 | | | | |
| 28 New location | 2 | not code | | | | |
| 29 Kiosk previews | 2 | 0 | | | | |

Item 48's steps as estimated: 1: 1.5 to 2, 2: 1 to 2, 3: 1, 4: 2 to 3, 5: 1, 6: 1.

## What feature 48 says about the scale (22 Nov 2026)

- All six steps together: estimated 8.5 to 12 sessions (17 to 48 hours); actual 113 minutes from first tool call to the last merge, about 4 to 11% of the estimate. Build was 73 minutes of it, merging (CI and waiting) 40.
- Per step the build took 6 to 25 minutes; a merge 5 to 13 minutes, nearly all of it CI (about 5 minutes since CI runs in parallel parts).
- What made it fast: the design was written (`docs/CATALOGUE.md`), the decisions were taken first, the steps followed paths the code already had (tax inheritance, the release diff), and one agent kept the context from step to step. Steps were built while the previous one's CI ran.
- What cost time: one test that failed for a reason the plan didn't foresee (the smart builder's budget, 12 minutes), and the related test runs (2 to 5 minutes each).
- Not counted: the owner's review, a browser check of the editor and the till scan, a real barcode scanner.
- **Revised scale for the next planned feature** (a design written and decisions taken, one area, one agent): estimate each step in minutes, about 10 to 30 minutes to build plus about 6 minutes to merge; a step with a migration and a new table at the top of that range; double it for a step that touches something the plan didn't look at. Keep the old session scale for work with no design yet, or that needs live accounts or devices.

## Detail by step (from `scripts/session-timings.mjs`)

Model claude-opus-5-5 at high effort for every step. "Tools" is time inside tool calls (a test run,
a build, a wait), "model" the model's own time between them (reading results, deciding, writing the
next edit). Cost is estimated from each message's tokens at list prices; cached reads are most of it
(the session's context was about 550,000 tokens, re-read on every message).

| Step | Wall | Calls / messages | Tools by phase | Model | Changed (files, +lines) | Tokens out / cached read | Cost |
|---|---|---|---|---|---|---|---|
| 48.1 | 8.8 min | 38 / 69 | tests 4.0, builds 0.7, reading code 0.1 (18 calls), edits 0.1 (9) | 2.2 min | code 5 (+140), tests 2 (+128), docs 7 (+43), migration (+15) | 50k / 36M | about $9 |
| 48.2 | 13.8 min | 28 / 55 | tests 10.1 (one run of 65 files blocked 10 min in the foreground), builds 0.4 | 1.6 min | code 7 (+51), tests 2 (+61), docs 7 (+21) | 41k / 32M | about $8 |
| 48.3 | 6.0 min | 37 / 61 | waiting on background tests 1.3, tests 0.7, builds 0.6, reading 22 calls | 1.6 min | code 7 (+35), tests 1 (+17), docs 7 (+19) | 37k / 39M | about $9 |
| 48.4 | 11.7 min | 32 / 59 | waiting on background tests 6.3, tests 0.9, builds 0.4 | 2.1 min | code 8 (+260), tests 3 (+75), docs 8 (+33), migration (+28) | 60k / 40M | about $10 |
| 48.5 | 7.5 min | 26 / 40 | waiting on background tests 4.3, tests 0.5, builds 0.3 | 1.5 min | code 7 (+109), tests 2 (+43), docs 6 (+20), migration (+7) | 31k / 29M | about $7 |
| 48.6 | 25.5 min | 46 / 76 | finding and rerunning a failing test 8.1, waiting on background tests 9.6, waiting on 48.5's and its own CI 10.2 | 2.1 min | code 1 (+13), tests 1 (+26), docs 8 (+15) | 57k / 58M | about $13 |
| **48 whole** (18:00 to 19:36) | **96 min** | **233 / 406** | **tests 24.2, background waits 22.7, CI waits 20.3**, builds 2.3, pull requests 1.0, reading code 0.5 (88 calls), edits 0.5 (37 calls), git 0.3 | **12.6 min** | code 22 (+598), tests 4 (+350), docs and notes 18 (+201), migrations 3 (+50) | 323k / 263M | **about $62** |

### What was quick and what was slow

- **Writing the code was the smallest part.** Edits took 0.5 minutes of tool time over 37 calls,
  reading code 0.5 minutes over 88 calls, and the model's own time 12.6 minutes in all. About 70% of
  the 96 minutes was waiting: test runs (24 min), background test runs (23 min) and CI (20 min).
- **Quick: code that followed an existing path.** The type on menu, section and dish (48.1) copied
  the tax inheritance through the schema, the load, the tree save, the copy body and the release;
  the kitchen skip (48.3) was one flag set where lines are made and one filter where they're sent;
  the word (48.5) one shared rule used in four places. Each was 1.5 to 2 minutes of the model's time.
- **Quick: shared rules with unit tests.** `shared/catalogue.js` (types, barcodes, codes, words) was
  written and tested in seconds each; unit tests run in under a second.
- **Slow: finding a cause the plan didn't foresee.** 48.6 added three report fields in under a
  minute, then a smart builder test failed: the fields, linked into every subject that reaches dishes,
  pushed Dishes sold out of the builder's budget. Finding it took about 12 minutes (a debug print,
  then comparing the subjects listed in full with and without the change).
- **Slow: the broad test runs.** Running every related API test file after each step took 4 to 10
  minutes (36 to 65 files). Running them in the background while writing the docs hid most of it;
  48.2's run was started in the foreground and blocked the agent for 10 minutes.
- **Slow: CI.** About 5 to 6 minutes per pull request with the API tests in parallel parts. Steps
  2 to 6 were built while the previous step's CI ran, so most of it overlapped.
- **Expensive: a long session.** About $62 for the feature, most of it re-reading the session's
  context (about 550,000 tokens) on each of 406 messages. The same steps in a fresh agent with a
  small context would cost a fraction; the time would be about the same, since waiting dominates.

### What to change next time

- Start broad test runs in the background from the first one, and write the docs meanwhile.
- Run the smart builder test (`reports-smart.test.mjs`) whenever a report field is added to a
  subject many others link to.
- For cost, build a feature in a fresh agent (or a new session) that reads only the plan and the
  area notes, not in a session that already holds a day of context.

