# Outstanding: shell

What is not built, known limits and follow-ups in this area (`docs/claude/areas/shell.md`). Item numbers are the old CLAUDE.md numbering, kept so earlier references still work; a new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending.

**9. More `/mobile` modules**
The `/mobile` shell + `MOBILE_MODULES` registry (see Key files) now has five modules:
H&S Dashboard, Expenses, Purchasing, Cash Up, and Wages (plus Allergens, Orders, Assistant and Dashboards since). Remaining candidates, in the
order they'd likely get used on a phone away from the host-stand tablet: Food safety
quick-log (temp/hold/cooking entry only, no equipment management), a booking lookup/manage
view, the H&S Action Log standalone.
When adding one: reuse the desktop page's data hooks/mutations/body components (not its
layout), register it in `src/mobile/registry.js`, and check whether its body components
already reflow at phone width before assuming they do (see the Common-mistakes entry on
canvas/SSR parity for the general shape of this risk — a shared body component drifting
between two renderers).

**10. `/mobile` device testing**
Built and verified via production build (`npm run build`) only — this environment has no
way to run a real browser against a live API/DB to click through the installed-PWA flow
end-to-end (Add to Home Screen on an actual iPhone/Android device, confirm the swapped
icon/name/manifest actually take effect, confirm `100dvh`/safe-area handling on a notched
device). Worth a real-device pass before treating this as fully verified.

**11. `/mobile` PWA install identity on Android — confirmed broken on real device, needs a subdomain** *(code done with migration 138: ops.macaroonie.com. Takes effect once `scripts/nginx-office-ops.sh` has been run and Auth0 allows ops.; still to confirm on a real Android device.)*
Real-device testing (item 10) surfaced that Android Chrome does not treat `/mobile` as a
separately-installable PWA the way iOS Safari does. Chrome ties "already installed?" to
the *origin*, not to which manifest is currently linked — since a WebAPK is already
installed for `macaroonie.com` (the main app, `scope: "/"`), Chrome's install flow offers
to open that existing app instead of creating a distinct "Macaroonie Ops" icon, regardless
of `MobileShell`'s manifest/link-tag swap. The only reliable fix is a genuinely different
origin for `/mobile` (e.g. `ops.macaroonie.com`), since PWA install identity on Android is
origin-scoped. **Pick this up together with the office/ops subdomain work discussed earlier**
— fold the `/mobile` PWA identity fix into that same subdomain rollout rather than doing a
one-off DNS/Nginx change just for this. Until then, "Create shortcut" (Chrome's fallback
option) is the only way to get a distinct icon/name on Android, and it's a browser
shortcut, not a standalone WebAPK.

**37. Today (the ops front door) — what's next** *(first slice shipped 30 Oct 2026; `docs/CHAT_FIRST.md` lists what is built)*
- Tasks are still worked out on every request (about 20 in-process route calls with the step 5 sources), and nothing is cached (H2 asks for it). A busy group may want a short cache keyed by venue and minute. The task store (owner, snooze, skip with a reason, done by hand, history, escalation) came with Pepper-first step 5 (23 Nov 2026, migration 278): item 55.
- Sources not covered yet (C1, C2): tips to pay, a rota not published (there is no publishing: step 5 added next week's rota still empty from Thursday), the Z report and end-of-day review, supplier order cutoffs (the supplier's cutoff and lead days per venue aren't readable through a route the feed can call), menu releases going live, promotions starting or ending, printers with failed or waiting tickets, big parties as tasks, cash variance over a threshold. Each is a function in `SOURCES`. (Cash-ups for the last week and last week's cash wages since 14 Nov 2026; failed booking emails, reviews to check, menu screens and tills offline while trading, sold out dishes and next week's empty rota since 23 Nov 2026, step 5d.)
- Cash Recon on Today (14 Nov 2026): a cash-up task for a day before yesterday shows only once the venue has a Cash Recon report on a day of this week or last (so a venue that doesn't use Cash Recon isn't told it missed six cash-ups); a venue that stops using it for two weeks loses the older tasks. The wages task is last week's only (an earlier unpaid week isn't listed: open the Wages page) and counts cash due, not bank transfers. The cash-up's due time is the day's latest doors close or last orders on the booking schedule; a venue with no sittings that day gets no time (Later). Tried in Chromium at 1280, 1015 and 390 px with a mouse, not on a real tablet or phone.
- Forms open in a sheet on the page, not inside the conversation; since 21 Nov 2026 Pepper opens one with a form card (`open_form`), but not inside the chat (F1 in the chat, F6 drafts across devices, F7 filling a form from words); Pepper reads the feed since step 5e (`my_tasks`, and `day_briefing`'s tasks part).
- No chat-first switch (G1, Q-A): `/today` is a menu link, not the landing page. No shared-device person switch (U2, Q-C). Push: task notices since 21 Nov 2026 (migration 262, Macaroonie Office and web push).
- Not tried on a real tablet at the host stand (the sheet's keypads come from the shared panels and were tested there).
- The week ahead (14 Nov 2026) shows only what Local info holds: no forecast without a weather capture at the venue (no other source), five headlines at most (the rest on Local info), nothing to dismiss a headline for the day, and a captured item's words and dates as the capture found them. Tried in Chromium with a mouse at 1280, 1015 and 390 px, not on a real tablet or phone.
- Other stored links still checked only by Zod's `url()`: the website's social, ordering and delivery links (`routes/website.js`), typed by staff with Website manage and shown on the group's own site; page builder block links aren't checked at all (block data is opaque). Move them to `webLink()` if staff accounts other than owners get Website manage.

**13. Audit remaining pages for the sticky-header-hides-hamburger bug**
*(Touch devices no longer affected: they get a burger rail and never see the floating button. The remaining audit only matters for non-touch screens below `lg`, and the spacer class to add is now `max-lg:notouch:pl-14`, not `pl-14 lg:pl-4`.)*
The `z-40` bump on `AppShell`'s hamburger button (see Common-mistakes) makes it clickable
on every page regardless of that page's own header z-index, so nothing is currently broken.
But pages whose own `position: sticky` top-of-page header sits at `z-10` or higher still
visually paint UNDER the (now-topmost) hamburger without the `pl-14 lg:pl-4` spacer, which
looks scruffy rather than actually blocking navigation. `CashRecon.jsx`'s 5 views got the
`pl-14` treatment as part of this fix; still to check (grep `sticky top-0 z-1\|sticky top-0
z-2` across `admin/src/pages`): `Menus.jsx`, `Website.jsx`,
`Timeline.jsx` — confirm each one's header is actually the page's own top-of-viewport
element (not a nested table `<thead>` or in-panel section header, which aren't at risk)
before adding `pl-14`.

**49. Deep links, step 1 follow-ups (Pepper-first, 22 Nov 2026)**

Built: the six pages open at a venue, day or week, and tab from their address, and Pepper's `open_page` builds such links. Not done: no other page accepts anything yet (add `accepts` to its record and read it with `useDeepLink()`); Today's cards and the phone pages don't build links with `pageLink()` yet; the menu search box and Pepper's menu search (`/api/ai/nav-search`) open pages without a venue or day; Cash Recon's settings view and the day view's own tabs, and Bookings' status filter, can't be linked; a link's venue is checked against the tenant's venues only (there are no per-person venue limits today). (Done 23 Nov 2026, the owner's choice: `open_page` searches the person's own menu beside the standard one, shows a renamed page by its own name with the standard name beside it, and still offers a page they can open that their menu leaves out, marked Not in your menu.) Checked in Chromium through the browser harness at 1280 px only, not on a tablet or the phone pages.

**50. Usage record, step 0a follow-ups (Pepper-first, 22 Nov 2026, migration 270)**

Built: `usage_events` (pages opened, menu searches with handed to Pepper and what they opened), written in batches from `admin/src/lib/usage.js`, the person's own record (`usage.mine`, `{me}`) and two group subjects with no person (`usage.pages`, `usage.searches`), 90 days. Not done:
- No browser check yet that a page change and a search reach `POST /api/usage/events` (the API side is tested; the admin side only built). First check: open three pages and search once, then read `usage_events`.
- Only the office sidebar's search box is recorded. Today's Ask Pepper bar on the phone (`AskPepperBar`) and the Pepper drawer aren't searches of the menu and aren't recorded; step 2's home bar should call `useSearchUse()` too.
- No sessions: "share of sessions that use the bar" (step 2's measure) needs a session id per sign-in or tab; add a `session` column then rather than guessing from times.
- No median: report figures are sum, average, smallest, largest and counts only, so "median time to the first task" has to wait for a median figure in the report engine.
- (Fixed 22 Nov 2026 before merging: a report on My pages and searches, or one showing it beside another subject, can't be scheduled, emailed or made a data link: `ownRecordOnly()` in `api/src/reports/catalogue/index.js`, 422 with a reason. The admin still offers those buttons on such a report; they fail with the reason.)
- Platform admins viewing another group are recorded in that group like members.

**52. One Home and the ask bar, step 2 follow-ups (Pepper-first, 22 Nov 2026, migrations 272 to 274)**

Built: pins kept on the server per person (12 at most, a venue and tab where the page takes them, an own name, drag to reorder), Home at `/` (the bar, pins, the day at a glance, the Today feed, the week ahead), the Overview at `/overview`, `/today` to `/`, the ask bar on Home and over any page (no model call for page and saved-report results; Enter, Ask or an ask under the bar hands the words to Pepper, into the remembered chat since 23 Nov 2026), nav cards for `open_page` in the chat, the Launcher retired (its tiles became pins). Not done:
- The phone app (`/mobile`) keeps its own hub and Today page: no ask bar there yet (the strategy puts it at the bottom, in thumb reach), and the phone hub doesn't show pins.
- For review (step 5) has a place on Home but nothing in it; suggestions after the pins with a reason (step 7) are not built, nor the Team signal (the plan's `suggest_to_team`: `show_in_launcher` was dropped, not renamed, so step 7 adds its own column). (Built 24 Nov 2026, step 7, migrations 282 to 284: suggestions after the pins, the Team signal as its own table `team_suggestions`, Your sites; follow-ups in item 60.)
- The bar's page rows have no context chips (venue, day or week, tab) as the mock-up shows: a page opens plain from the bar; a pin or Pepper's nav card can carry the context. A star to pin from a search row, a nav card or a menu link is not built (pins are added from the editor only).
- What a Pepper answer then opened isn't joined to the search in the usage record: a hand-over is kept as `pepper: true` with nothing opened. The `picked = 'pepper'` value is no longer written by anything.
- A pin can't carry a day or week (the plan's relative period: today, this week, next week): only a venue and a tab.
- Saved reports can't be pinned (`home_pins.path` must be a page of the person's menu).
- "cash up" in the bar lists Cash dashboard, Cash recon and Cash Recon link (/pos/recon) at the same score, Cash dashboard first by name; Pepper's `open_page` offers Cash recon through its phrase rule. A tie-break by how often the person opens a page would need the usage record (decision 8 allows a person's own record for their own results).
- On a 1280 px screen Pepper's drawer covers the right end of Home's bar, its Ask button included (Enter still works, and the drawer has its own box).
- The browser checks ran on the office at 1280 and 1015 px and a 1024 px touch tablet; no check at phone width of Home in the office shell (the phone app is the phone's front door).
- A pin whose page left the person's menu is not shown, and the next save drops it for good.

**55. The task store, escalation and the new Today sources, step 5 follow-ups (Pepper-first, 23 Nov 2026, migration 278)**

Built: per venue and task key an owner (a team member who can do it), a snooze (presets or a time today), a skip with a required reason, done by hand for the kinds the feed can't see finish, each change in `ops_task_log`; the actions under each task on Home and the phone's Today, Off today's list with Bring back, Skipped today by site for managers; escalation to the venue's managers after two hours late; the feed's record per venue and day (`ops_task_days`) from the notices sweep; report subjects on completion and changes by site; six new sources. Not done:
- **Completion is only as good as the sweep**: `ops_task_days` is written by the notices sweep every five minutes, now for every active group with a venue (it used to run only where someone had a device). A task done and gone between two sweeps is never seen; a sweep that fails leaves a gap. With many groups the sweep (a full feed per venue as the owner) will need a cadence of its own, or the record written from the feed people open. Nothing deletes old rows of `ops_task_days` or `ops_task_log` yet.
- **"Finished" means it left the list**, not that it was done: a task that drops off because its day ended (a cash-up for a day past CASH_DAYS_BACK) or its source failed for another reason counts as finished. Errored areas are left alone; a whole area that becomes not_included is too.
- **Escalation** is a constant (`ESCALATE_MINUTES` 120 in `shared/todayTasks.js`), not a setting per group or area, and follows each manager's late switch (no switch of its own). A task with no time is judged from when the sweep first saw it late, so a group with no sweep history escalates two hours after the first sweep. There is no escalation of a skip.
- **The share of feed items acted on inside their window** (the step's measure) is in `today.tasks` (Finished in time) but there is no starter report or tile for it; median age of items waiting For review is not counted anywhere.
- **Who may change a task**: Use where the module offers Use, else Manage (changed before merging, 23 Nov 2026: View never changes anything, CLAUDE.md rule 5). A skip of a compliance task has no stricter rule than any other skip. Owners can be any active team member who signed in at least once and whose role can do the task; there is no notice to the person a task is given to.
- **Owners persist across days** (by key): a daily fridge check given to Sam stays Sam's every day until cleared; a skip and a done are for one day; a snooze counts only on today's feed.
- **The report subjects** need Venues Manage (one module for all areas); the managers' Skipped today card on Home goes by Manage on each task's module.
- **Kit offline** is judged from the booking schedule's sittings; a venue that doesn't use the booking schedule gets offline tasks only for kit seen in the last three hours. Printers aren't a source yet (the tech board has their failed and waiting tickets).
- **Sold out** shows every sold-out dish as a task (later), up to ten; a group that sells out on purpose for the day may find them noise: prune by how often they are acted on.
- Tried in Chromium at 1280 px only (Home with a snooze and a skip, the Skipped today card, a new source), not at 1015 px, phone width or on a tablet.


**59. Macaroonie Office on the iPhone, step 6d follow-ups (Pepper-first, 24 Nov 2026)**

Built: the iOS settings (`app.json` both platforms, reason strings, no export encryption; push mode in `app.config.js`; `eas.json` iOS in every profile and `app-store`), the code paths that differ (`layout.js`, `speechCore.js` `cumulative`, `scanCore.js`, the bridge's `platform`), README steps, CI bundling iOS.
- **Never built or run on an iPhone**: it needs the owner's Apple Developer Program account, an APNs key in the EAS project (`eas credentials -p ios`), and `eas build -p ios`. Build from GitHub uses every platform in `app.json`, so it fails on iOS until then (pick Android there).
- **`supportsTablet` is false**: an iPad runs it as a phone app. Shared kitchen tablets on iPad would want it true (and an iPad check by App Review).
- **App Store review**: privacy answers, a reviewer login and the "mostly a website" risk are the owner's (README). No universal links (none on Android either): sign-in returns by the app's scheme.
- **Not checked on a device**: the iPhone's keyboard padding with the web view, speech with the default audio session (answers read aloud after listening), and a UPC-A scan.

**60. Suggestions, the Team signal and Your sites, step 7 follow-ups (Pepper-first, 24 Nov 2026, migrations 282 to 284)**

Built: up to four suggestions after the pins (rules due, team, setup, habit, often, weekly_report, each with a reason; ranked by rule then score; Pin and Dismiss for 14 days), the Team signal (a page suggested to a role by Manage on Navigation, until pinned or dismissed for good), Your sites (venues ranked by what needs them, completion today and this week, a tap switching Home), and the measure: **tap-through on suggestions**, the report subject Home suggestions (`usage.suggestions`: Tap-through (%) = opened out of shown, by rule; Pinned (%) and Dismissed (%) beside it). Not done:
- **Suggestions are worked out on every feed** (each minute while Home is open): about eight small queries beside the feed's own reads, plus `GET /api/reports` in-process when a report qualifies for the weekly rule. Not cached.
- **Habit and Often read the person's own record at Home's venue's time zone**; the record has no venue, so a habit is the person's whichever venue they opened it at, and the suggestion opens at the venue Home shows. A page linked twice in the menu goes by its first link's name.
- **Due** points at a page by the task's area (`TASK_PAGES`), not the task's own link; a form task on Home suggests its page too, even though Home can open the form. A dismissal of a page hides it whichever rule found it (the key is the page and tab).
- **Set-up gaps**: only food safety's (no fridges, fridges with no check times). Other sources could note theirs (no checklists, no hold stations, no suppliers): add to `s.gaps` in the source.
- **The Team signal**: one role per suggestion (suggest it again for another); no expiry date; shown while the page isn't pinned, so a person who unpins it sees it again unless they dismissed it; the note is plain text; no notice is sent. The strategy's "shown only while the person has no pins" was not followed (the ask was: until they pin or dismiss it). A pin's star in a search row or a nav card is still not built (item 52), so the only places to suggest from are the Navigation designer and a pin's row in the pins editor.
- **Your sites reads the feed's record**, as fresh as the last notices sweep (five minutes); a venue the sweep hasn't recorded today shows No record yet. Every active venue of the group is listed (there are no per-person venue limits). It doesn't show For review across venues, orders waiting or the week's late tasks by day; the weights are constants (`WEIGHTS`). Completion this week is Monday to today at each venue.
- **Measuring**: shown is counted once per suggestion while Home stays open (a reload counts again), from the browser's batches (a failed batch is lost); suggestions on the phone's Today aren't drawn or counted. Weekly active sites and "how do I answered without a ticket" (the strategy's other step 7 measures) need live customers.
- Browser checks at 1280 and 1015 px with a mouse (Chromium, the harness), not on a tablet or phone; the phone app's Today doesn't show suggestions or Your sites.

**64. The platform site on macaroonie.com: what is left (25 Nov 2026, no migration)**

Built (PR A): the frame (page registry, one head and footer, `/site/` files with cache headers, sitemap), the home message with six tiles and their drill-downs, a page per feature group, the architecture picture with its parts' details, nine screenshots of an invented group, and `/try` with its two sandboxes as coming-next placeholders. Not done:
- **The two sandboxes (PR B, done 25 Nov 2026)**: `/try/kitchen-flow` and `/try/kiosk` are live and in the sitemap. Left: boxes can't be dragged (they sit in columns by their distance from Orders in, stacked on a phone, where the wires' labels give way to a Gets line on each box); no order ready board, runner or Setter box, no filters by dish, order type or till, no Always or Except links, no Splitter rules (busy order type, split above), no courses held and fired from a till; one fixed test order. The kiosk is the page's own stand-in for the kiosk app's screens (not `pos/src/kiosk` itself): no pictures, option groups or meal deals, one size choice, no languages, no allergens or loyalty, prices added up on the page with `money()` (no tax, offers or charges); it changes the brand colour only (the other colours are the design's defaults, button words worked out with `contrast()`). The shared modules are served unbundled (kitchen about 115 KB gzipped over 19 files, kiosk about 140 KB over 21, preloaded side by side): a tree-shaken bundle would be smaller but needs a build step at deploy. Browser checks in Chromium at 390, 1015 and 1440 px only.
- **The picture is HTML and CSS with SVG pieces** (connectors and icons), not one SVG drawing: it restacks on a phone that way. A single drawn diagram that zooms would need its own phone layout.
- **Screenshots are taken by hand** (the steps are in the area file, the script is not in the repo) and go stale as the screens change; nothing checks them. The kiosk shot carries the preview's "orders aren't sent" bar; the till shot shows the till's order prompt choices as the fixtures set them up (order types such as Drive thru).
- **The copy is in code** (`services/platformSite/*.js`): changing a sentence is a pull request. No analytics, no cookie banner (none is needed while the pages set no cookies), no Welsh or other languages.
- **The fonts still come from Google Fonts**, as the old page's did; self-hosting them under `/site/` would drop a third-party request.
- **The nginx step** (`scripts/ensure-nginx-site-assets.sh`) runs on the next deploy; until it has, `/site/` files on the live apex would be looked for in the admin's build. It inserts before `location ^~ /manage` (or `location /api/`), so it needs one of those in the apex config, as every apex block made by `setup.sh` and `ensure-nginx-manage.sh` has.
- Browser checks were run in Chromium at 390, 1015 and 1440 px, not on a real phone or tablet, and with no screen reader.
