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
