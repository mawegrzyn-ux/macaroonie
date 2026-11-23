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
- No task store: tasks are worked out on every request (about 15 in-process route calls), so there is no owner, snooze, skip, escalation, history or push (sections 3, 5, M1-M7), and nothing is cached (H2 asks for it). A busy group may want a short cache keyed by venue and minute.
- Sources not covered yet (C1, C2): tips to pay, rota not published, the Z report and end-of-day review, supplier order cutoffs, menu releases going live, promotions starting or ending, devices or printers offline, big parties as tasks, reviews waiting, sold out, failed emails, cash variance over a threshold. Each is a function in `SOURCES`. (Cash-ups for the last week and last week's cash wages are covered since 14 Nov 2026.)
- Cash Recon on Today (14 Nov 2026): a cash-up task for a day before yesterday shows only once the venue has a Cash Recon report on a day of this week or last (so a venue that doesn't use Cash Recon isn't told it missed six cash-ups); a venue that stops using it for two weeks loses the older tasks. The wages task is last week's only (an earlier unpaid week isn't listed: open the Wages page) and counts cash due, not bank transfers. The cash-up's due time is the day's latest doors close or last orders on the booking schedule; a venue with no sittings that day gets no time (Later). Tried in Chromium at 1280, 1015 and 390 px with a mouse, not on a real tablet or phone.
- Forms open in a sheet on the page, not inside the conversation; since 21 Nov 2026 Pepper opens one with a form card (`open_form`), but not inside the chat (F1 in the chat, F6 drafts across devices, F7 filling a form from words); Pepper doesn't read the feed yet (S7 "What's left?" is answered by `day_briefing`, which overlaps but isn't the same list).
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

Built: the six pages open at a venue, day or week, and tab from their address, and Pepper's `open_page` builds such links. Not done: no other page accepts anything yet (add `accepts` to its record and read it with `useDeepLink()`); Today's cards and the phone pages don't build links with `pageLink()` yet; the menu search box and Pepper's menu search (`/api/ai/nav-search`) open pages without a venue or day; Cash Recon's settings view and the day view's own tabs, and Bookings' status filter, can't be linked; a link's venue is checked against the tenant's venues only (there are no per-person venue limits today). `open_page` still offers the standard catalogue pages the person's modules allow, not their own menu (`navTreeFor()`), so a link an admin hid from a role, or renamed, is still offered under its standard name. Checked in Chromium through the browser harness at 1280 px only, not on a tablet or the phone pages.

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
- For review (step 5) has a place on Home but nothing in it; suggestions after the pins with a reason (step 7) are not built, nor the Team signal (the plan's `suggest_to_team`: `show_in_launcher` was dropped, not renamed, so step 7 adds its own column).
- The bar's page rows have no context chips (venue, day or week, tab) as the mock-up shows: a page opens plain from the bar; a pin or Pepper's nav card can carry the context. A star to pin from a search row, a nav card or a menu link is not built (pins are added from the editor only).
- What a Pepper answer then opened isn't joined to the search in the usage record: a hand-over is kept as `pepper: true` with nothing opened. The `picked = 'pepper'` value is no longer written by anything.
- A pin can't carry a day or week (the plan's relative period: today, this week, next week): only a venue and a tab.
- Saved reports can't be pinned (`home_pins.path` must be a page of the person's menu).
- "cash up" in the bar lists Cash dashboard, Cash recon and Cash Recon link (/pos/recon) at the same score, Cash dashboard first by name; Pepper's `open_page` offers Cash recon through its phrase rule. A tie-break by how often the person opens a page would need the usage record (decision 8 allows a person's own record for their own results).
- On a 1280 px screen Pepper's drawer covers the right end of Home's bar, its Ask button included (Enter still works, and the drawer has its own box).
- The browser checks ran on the office at 1280 and 1015 px and a 1024 px touch tablet; no check at phone width of Home in the office shell (the phone app is the phone's front door).
- A pin whose page left the person's menu is not shown, and the next save drops it for good.

