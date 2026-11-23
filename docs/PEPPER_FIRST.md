# Pepper-first back office: implementation plan

Status: plan, 21 Nov 2026. Parts built the same day (section 12): form cards
(open_form), voice (all three steps), the task notices and the Macaroonie
Office app. The shell, shortcuts, suggestions, deep links and the usage log
(phases 1, 3 and 4) are not built. It answers the brief
"Back-office UI rework" (the user, 21 Nov 2026) and three asks of the same
day that belong with it: Pepper opening forms ("do today's cash-up"), a voice
interface, and a React Native ops app. It continues `docs/CHAT_FIRST.md`,
whose first slice is the Today page. Ids in brackets (H4, F1, K1...) are
CHAT_FIRST's requirements.

## 1. The brief in short

A minimal shell where the Pepper bar and shortcuts are the main way in: an
icon rail, a wide Pepper bar (voice, attach, Ctrl/Cmd+K), a strip of shortcut
chips (pinned by the person, suggested from how they work), the Today tasks
below, and Pepper's replies as cards (open a page, a pre-filled form, a small
table). A stable core plus an adaptive layer; every page stays reachable the
classic way.

## 2. What is there today (read in the code, 21 Nov 2026)

- **Shell** (`admin/src/components/layout/AppShell.jsx`): a 224 px sidebar.
  Collapsed on a mouse screen it is a 56 px rail with an icon for every link
  in every section (76 in the standard menu), no labels and no section
  headings. On touch screens
  a separate 56 px rail holds a burger, a search button and a Pepper button,
  and the sidebar opens over the page. `nav_items.icon` exists for links;
  sections have no icon.
- **Menu search** (`NavSearch.jsx`, `shared/navSearch.js`): a box at the top
  of the sidebar. Typing filters pages and saved reports with no AI; Enter
  asks Pepper to pick pages (`POST /api/ai/nav-search`).
- **Pepper** (`components/ai/ChatView.jsx`): streaming chat with photos, PDFs
  and text files (camera button on touch), Confirm cards (title, lines,
  warnings, Confirm / Cancel), tool steps and web sources. It lives in a
  right-hand drawer, on `/ai`, on the phone and beside the Today tasks.
  `open_page` returns a text link `[Rota](/rota)`, with no venue or date.
- **Page context**: nine pages tell Pepper their venue and day or week
  (`usePepperPage()`: Timeline, Bookings, Rota, Food safety, Online orders,
  Cash Recon, Today, the report viewer and builder). It goes one way: almost no page takes
  a venue or date from its address (records opened from reports and the
  purchasing pages do).
- **Today** (`pages/OpsToday.jsx`, `GET /api/ops/today`): tasks worked out
  from data, six forms opened in a sheet with the pages' own components
  (`FormSheet`: fridge, hold, cooking, checklist, cash-up, wages), the menu as
  tiles, chat suggestion chips.
- **Six things that already act like shortcuts**: the Overview's Quick access
  picker (per browser, a fixed list), Launcher mode's tiles (set by an admin,
  ordered per browser), report stars (per person, on the server), Today's
  module tiles, the phone hub's tiles, the chat's suggestion chips.
- **Three home pages**: `/` (Overview tiles, the landing page), `/today`,
  `/launcher`.
- **No usage log.** Only Pepper's changes (`ai_actions`) and report runs are
  recorded.

## 3. Changes to the brief

1. **One input, not two.** The rail's menu search and the Pepper bar would
   compete, and a 56 px rail has no room for a text box. The bar is the
   search: while typing it lists pages, saved reports and shortcuts at once
   (today's search, no AI, no cost); Enter or the Pepper button sends the
   words to Pepper. The rail keeps a search icon that focuses the bar.
2. **The bar is on the Home page; elsewhere it is an overlay.** A bar fixed
   above every page costs 56 px of height on tablets, where the Timeline,
   the Cash Recon grid and the designers need it. Ctrl/Cmd+K or the rail's
   Pepper icon opens the same bar over any page.
3. **Say where replies go.** On Home they open in a panel under the bar
   (Today moves down; the panel folds to one line). From the overlay the
   chat continues in today's right-hand drawer, so the page stays in view and
   "ask about this page" keeps working. The bar carries on the last chat for
   30 minutes of use, then starts a new one (short chats stay on the
   everyday model).
4. **Navigation never needs the model.** "Open wages" is answered by the
   local match. Suggestions and their reasons are worked out by rules. With
   Pepper off, over the allowance or down, the bar still searches and the
   strip and Today still work (P1, Q1).
5. **Cards come from tools, never from the model's text.** The model picks a
   tool; the server builds the card from the tool's result (as page refs
   already work), so a card can't name a page, venue or figure the server
   didn't hand out.
6. **A pinned shortcut must not freeze a date.** "Wages, week of 16 Nov"
   pinned as it is would be stale a week later. A pin keeps the page, an
   optional venue and at most a relative period (today, yesterday, this
   week, last week).
7. **Deep links are the hidden cost.** "Open wages w/c 16 Nov" needs the page
   to take venue and week from its address. Only a handful do. One shared
   hook, the pages that already tell Pepper their context first, the
   rest as needed; a card for a page without it opens the page plainly and
   never promises a week it can't open.
8. **Suggestions from three signals, not usage alone.** Usage needs about
   three weeks before "you usually do this on Fridays" is true, and a shared
   tablet login is several people. Use: due now (from the Today feed, right
   from day one), habit (weekday and time of day), most days. Each has a
   plain reason. A manager's picks fill an empty strip.
9. **The usage log is the person's own.** It records staff behaviour, so it
   is used only for that person's suggestions, is not a manager report, is
   kept 120 days and goes with the person. Help says what is recorded.
10. **One pin control.** With favourites and shortcuts as one thing (option
    A), a star and a "+ Shortcut" button do the same: keep the star. Dragging
    a card from the chat into the strip waits (a star is one tap and works on
    touch; a drag across a scrolling chat is the fragile part). Reorder by
    drag inside the strip stays.
11. **No drag-away to remove.** Too easy to do by accident on touch. An Edit
    button at the end of the strip shows grips and a remove button on every
    chip; removing offers Undo.
12. **The rail works by tap.** Hover may open a section sooner, but a tap on
    a section icon opens its links with labels on every device (Standard
    Design Rule 2). One icon per section (12 in the standard menu), not one
    per page.
13. **Voice in steps, never always listening.** First dictation into the bar
    for the person to check (F7), then hold to talk on the phone with short
    spoken answers. See 4.7.
14. **Leave video out for now.** The chat takes photos, PDFs and text files.
    No job in the brief needs video, uploads are large, and it would need
    stills taken from the clip. Decide when a real use turns up.
15. **Tablets tap, they don't type.** At the host stand the strip and
    Today's task buttons are the interface; the bar is for the office. Chips
    are 48 px, and Today's first tasks must show without scrolling at
    1024 x 768.
16. **One home page.** The new Home takes `/`. The Overview tiles move to
    `/overview` (their own menu entry). `/today` redirects to `/`. Launcher
    mode goes: the rail and the strip replace it.

## 4. Design

### 4.1 Shell

- **Rail** (56 px, every screen size from 700 px): logo and restaurant
  switch, search, Pepper, one icon per top-level menu entry (a section opens
  a flyout listing its links with labels and descriptions; a top-level link
  opens its page), then settings and sign out. The flyout closes on a pick,
  a tap outside or Escape. A long section scrolls inside its flyout (Store
  tech has 27 links in the standard menu; splitting it into devices and
  set-up is worth doing at the same time). Settings keeps "Keep the menu open" for people
  who want today's full sidebar. Sections get an icon (the column exists;
  the Navigation designer's icon picker shows for sections; the default menu
  gets one per section).
- **Pepper bar** (`PepperBar`): a combobox. Results while typing: shortcuts,
  pages, saved reports, each with a star; last row "Ask Pepper: <words>".
  Enter with a row lit opens it, else asks Pepper. Mic, attach and camera
  inside. Ctrl/Cmd+K focuses it (Home) or opens it as an overlay (other
  pages), not while a window is open or the cursor is in a rich text editor.
- **Home** (`/`): bar, shortcut strip, reply panel (only while a chat is
  active), then the Today module (today's `Glance`, `TaskBoard`, `FormSheet`
  and week card, unchanged). Venue switch in the page header as now.

### 4.2 Cards in Pepper's replies

Display items built in `displayItems()` and streamed as events, beside
today's `assistant`, `step` and `action` items:

| Item | From | Shows |
|---|---|---|
| `nav` | `open_page` | icon, page name, what it opens ("Wages, week of 16 Nov"), Open, star |
| `form` | `open_form` (new) | the form's name and day, Open (the Today sheet, over the chat); once saved, a summary line |
| `data` | `ask_data`, `run_report` | up to 8 rows or one figure, Open full report |
| `action` | change tools (as now) | the Confirm card; later with fields that can be edited before Confirm |

`open_page` gains optional `venue`, `date`, `week`, checked against what the
page accepts. `open_form` picks from a fixed list (F1): the six Today forms
first, then expense with receipt, delivery booking-in, sold out, rota day.
The model never writes a form's fields.

### 4.3 Shortcuts

Per person, kept on the server. A chip opens its page (with its venue and
relative period). Pinned chips are solid and never move by themselves. Up to
12 pins; the strip scrolls sideways. Star to pin from a card, a search row or
a rail flyout row. Edit mode: reorder (grip, both pointer and touch), rename,
remove with Undo. The Overview's Quick access tile reads the same pins.
Report stars stay as they are; a starred report can be pinned.

### 4.4 Suggestions

Up to 4 dotted chips after the pins (3 at 1024 px and below), each with a
reason on the chip's second line. One tap pins; a small x hides it for 30
days. Worked out on the server by rules:

| Signal | Rule | Reason shown |
|---|---|---|
| Due | the Today feed has tasks for the page's area | "2 checks due now" |
| Habit | opened in this 3-hour part of the day on 3 or more of the last 6 same weekdays | "You open this most Fridays around now" |
| Often | opened on 5 or more of the last 14 days | "You open this most days" |
| Team | flagged by a manager, shown only while the person has no pins | "Picked for your team" |

Never a page the person can't open, one already pinned, or one hidden.

### 4.5 Usage log

The shell records each page opened: catalogue page (never a record id or a
query), venue when the page has one, time, and where it came from (rail,
search, Pepper, shortcut, suggestion, Today, link, direct). Sent in batches.
"Function used" comes second: a count per person, module and day of saves
that went through, taken from the API's own responses (no page changes).
Totals by source answer K1 (chat against the classic pages) without naming
anyone.

### 4.6 Deep links

`ROUTE_CATALOG` entries say which of venue, date and week a page accepts.
`useDeepLink()` reads them from the address once, sets the page's own state
and clears them (as `useLinked()` does for records). First: Timeline,
Bookings, Rota, Food safety, Online orders, Cash Recon (day and wages).

### 4.7 Voice

For hands that are busy: logging a reading, ticking a checklist, marking a
dish sold out, "what's due?", "who's on tonight?". Not for tables of figures
(a cash-up).

| Step | What | Notes |
|---|---|---|
| 1 Dictation | A mic button in Pepper's box turns speech into text; the person reads it and sends | The browser's own recognition where it has one. A phone keyboard's mic key does the same today |
| 2 Talk mode | On the phone: hold a big button, speak, let go. The words show at once; Pepper answers in a sentence or two, shown and read aloud | A turn that came by voice asks Pepper for a short answer, with the detail on screen |
| 3 Voice Confirm | Pepper reads back what it will save; "yes" confirms | Checks only (a temperature, a hold or cooking check, a checklist tick), behind a group setting. Money, orders, bookings, the rota and anything deleted keep a tap |

Not built: always listening or a wake word. A web page can't listen in the
background, and an open microphone in a kitchen or dining room hears staff
and guests.

Speech becomes text in one of three ways: the browser's own (free and quick;
the sound goes to the browser's maker; it can't be taught dish or supplier
names; it is missing inside app web views), the phone's own inside the native
app (4.8; free, can stay on the device), or a service through our server
(works everywhere, can be given the venue's words, costs per minute, a new
supplier to sign up). Start with the first two; add the third only if names
are heard wrong too often. Whether Pepper's model can take sound directly
wasn't checked; nothing here needs it.

Rules: no sound is kept, only the words, as chat text. Every voice command is
a Pepper turn and counts in the allowance. A reading is read back with its
unit, and one out of range is said so. Answers are read aloud only where the
person switched that on for the device, and never a guest's phone or email.

To test before step 2: numbers in a noisy kitchen (four, fourteen, minus
eighteen), accents, and how long a turn takes (about 3 to 10 seconds with a
tool call).

### 4.8 The phone app

Today the ops app is the admin's `/mobile` pages on `ops.<domain>`, installed
from the browser: ten modules, each reusing the desk pages' own parts. The
Android app in `android-app/` is a different thing: a shell for venue devices
(tills, kitchen screens, kiosks, menu screens), linked by a code, with no
sign-in.

What a native app adds: push notices that arrive (on an iPhone web push needs
the web app added to the home screen first), speech recognition (missing in
web views), a barcode scanner on iPhone, fingerprint or face unlock, a place
in the app stores.

| Way | What | Cost |
|---|---|---|
| A Shell | A React Native app (Expo, like `android-app/`) that signs in natively and shows the existing phone pages in a web view, with a bridge for push, speech, the scanner and unlock | Medium. Pages still update with every deploy |
| B Rebuild | Every phone page written again in React Native | Very large, and for good: each page then exists twice, and every change ships twice and through the stores |
| C Shell, then native where it pays | A first; then native screens one at a time (talk mode, the scanner, Today's list) | A, plus each screen |

Recommended: C. Not B: the phone pages work because they are the desk pages'
own parts (the cash-up day, the wages list, the order form, the check panels,
report charts); a second copy of each would drift from the first.

What it needs:

- **Sign-in.** Google refuses sign-in inside an app's web view, so the app
  signs in through the phone's browser (Auth0's native kit) and hands its
  login to the pages; `useApi()` takes its token from the app when it runs
  inside one.
- **Notices.** A server job that watches each venue's Today feed and sends
  each task once when it goes late, to the people who can do it, with each
  person's own settings (venues, areas, quiet hours). The same notices can go
  to browsers by web push. Nothing sends notices today.
- **The stores.** An Apple developer account, a Play listing, privacy answers
  and review, set up by the owner. Apple can refuse an app that is mostly a
  website; push, speech, the scanner and unlock are what make it more.
- **Its own app** (`ops-app/`), not a fifth choice in the device app, which
  keeps the screen awake, hides the bars and has no sign-in.
- **One home.** The phone's home becomes the same Home in one column (bar,
  strip, Today), with the module tiles under it.

## 5. Data model (one migration per phase)

- `user_shortcuts` (forced RLS): tenant, `user_sub`, `route`, `params` jsonb
  (`venue_id`, `period`), `label` (own words, 40), `state` pinned | hidden,
  `hidden_until`, `sort_order`. One row per person, route and params.
- `nav_events` (forced RLS): tenant, `user_sub`, `route`, `venue_id`,
  `source`, `at`. Index on person and time. Cleared after 120 days by the
  hourly clean-up. A `LEFT_OUT` decision in the report catalogue.
- `nav_work` (forced RLS, phase 3b): tenant, `user_sub`, `module`, `day`,
  `saves`.
- Removed: `tenants.nav_style`, `nav_items.show_in_launcher` becomes the
  Team signal (renamed `suggest_to_team`).
- No change to `ai_messages`: cards are display items over stored tool
  results.
- Phase 6: `push_devices` (tenant, `user_sub`, kind app | web, token, last
  seen), `task_notices` (tenant, venue, task key, day, sent at: one notice per
  task), `user_notify` (tenant, `user_sub`, venues, areas, quiet hours), all
  with forced RLS.

## 6. API

- `GET /api/shortcuts?venue_id=` -> `{ pinned, suggested }` (each with label,
  icon, address; suggestions with `reason` and `signal`).
- `POST /api/shortcuts` (pin), `PATCH /api/shortcuts/:id` (label),
  `PUT /api/shortcuts/order`, `DELETE /api/shortcuts/:id`,
  `POST /api/shortcuts/hide`.
- `POST /api/nav/events` (a batch; unknown pages dropped; rate limited).
- `open_page` (venue, date, week; a `nav` card), `open_form` (a `form` card),
  `ask_data` / `run_report` (a `data` card).
- Open to everyone signed in; each answer holds only pages the person's role
  can open.

## 7. Phases

Each ends in something usable and is shipped by itself.

1. **Shell and pins.** Rail with flyouts and section icons; Home at `/` with
   the bar (search plus hand-over to Pepper), the strip with pins, the Today
   module; `user_shortcuts`; star in search rows and flyouts; Ctrl/Cmd+K
   overlay; Overview to `/overview`; Launcher mode removed.
2. **Cards.** `nav` cards with context and the star; deep links on the first
   six pages; `open_form` with the six Today forms (the "do today's cash-up"
   request).
3. **Usage and suggestions.** `nav_events`, the four signals with reasons,
   hide, the clean-up, Help's "what is recorded". 3b: `nav_work`.
4. **Action and data cards.** 4a `data` cards. 4b fields on Confirm cards
   and more forms, filled from words or a photo (the invoice and receipt
   readers exist). 4c Undo on the few changes that can be reversed safely (a
   pin, sold out, a checklist tick, wages marked paid).
5. **Voice.** 5a dictation into Pepper's box. A trial in a real kitchen. 5b
   talk mode on the phone. 5c voice Confirm for checks.
6. **Phone app.** 6a notices (the job, settings, web push). 6b the native
   shell: sign-in, push, speech, scanner, unlock. 6c native screens where the
   web ones fall short.

`open_form` (phase 2) doesn't need the new shell: it works in today's chat
and can ship first.

## 8. Risks

- **Cost and speed.** More chat means more model use; the person's daily
  share and the group's allowance still apply. Keep everything that isn't a
  question local.
- **Shared tablet logins.** Pins and suggestions belong to the login, so on a
  shared login they mix several people's habits (U2 is not built).
- **Deep links** touch many pages; each needs its own check.
- **The menu is the group's own** (Navigation designer): a tree with links at
  the top level, or deeper than two levels, must still fit the rail.
- **Bundle size.** The admin's main bundle is 5.3 MB against a 6 MiB limit;
  the bar and cards load with the chat, the Home page lazily where possible.
- **Old habits.** Everyone's landing page changes. Keep the menu open is the
  way back to the old layout.
- **Keyboard.** Ctrl/Cmd+K is also a browser shortcut; the app takes it only
  when no window is open and the cursor isn't in an editor.
- **Voice accuracy and privacy.** Numbers heard wrong become wrong records;
  the read-back and the kitchen trial are the guard. Sound leaves the device
  with browser recognition.
- **Sign-in inside an app** is the part of the shell most likely to take
  longer than planned (tokens handed to the pages, refreshed, signed out).
- **App stores.** Review can refuse or delay; every shell change is a store
  release.

## 9. Not in this plan

The task store (owner, snooze, skip, escalation, history), the shared-device
person switch, memory, voice on tills, kitchen screens and kiosks, and a
native rebuild of the phone pages.

## 10. Decisions

| # | Decision | Recommended |
|---|---|---|
| 1 | Favourites and shortcuts | One thing (option A): a star pins |
| 2 | Home page | The new Home at `/`; Overview moves to `/overview` |
| 3 | Launcher mode | Remove it |
| 4 | The bar on other pages | An overlay (Ctrl/Cmd+K, rail icon), not a fixed bar |
| 5 | Who sees the usage log | Only its own person, through suggestions |
| 6 | Video | Leave out |
| 7 | Dragging a card into the strip | Later; star first |
| 8 | Voice | Dictation first; talk mode after a kitchen trial; a spoken yes confirms checks only |
| 9 | Phone app | A native shell around the existing phone pages (C), not a rebuild |
| 10 | iPhone as well as Android | Both, if staff use their own phones |
| 11 | Notices | Late tasks only at first, each once, with quiet hours |

## 11. The user's answers (21 Nov 2026)

Given after reading this plan and the notes on the other items. Nothing is built yet: the user asked for analysis only and will do the dev work on a cheaper model.

- Item 5 (Today not showing current): dropped, it works now.
- Item 4 (loyalty themes): each member picks their own.
- Item 7 (Tech board): the venue's board needs only one indicator that the platform's servers are up. A separate platform board is wanted too: backlog for now.
- Item 8 (till and kitchen screen analytics): by person as well as by till and layout.
- Item 13 (ops app), in the user's words: "push, voice, scanner, offline not needed, android for now, but plan for both". Read as: push, voice and a scanner wanted, offline not, Android first with iOS planned for. Confirm before building.
- Item 11 (Pepper-first back office): parked. It is looked at next and needs design mockups first.

## 12. Built 21 Nov 2026

The user picked items 3, 12 and 13 of OUTSTANDING 44 with the quick wins, and
answered: all three voice steps now (the kitchen trial before talk mode didn't
happen), notices for late and due-soon tasks, ten forms, and the app named
Macaroonie Office.

- **Form cards** (phase 2's `open_form`, no shell needed): `api/src/ai/tools/forms.js`,
  the six Today forms plus delivery checks, expenses, sold out and a rota day.
  The card is built from the tool's result (`display()`), never the model's text.
  No `nav` or `data` cards and no deep links yet; no "once saved" summary line.
- **Voice** (phase 5): dictation in Pepper's box, hold to talk on the phone with
  answers read aloud per device, and a spoken yes for checks behind
  `ai_settings.voice_confirm` (migration 261). Browser recognition, or the
  phone's inside the Office app.
- **Notices** (phase 6a): late and due soon, each once, to the people who can do
  it, with venues, areas and quiet hours; Web Push and the app's push
  (migration 262). Not the `push_devices` / `task_notices` / `user_notify`
  shapes in section 5 exactly: `user_notify` also has due_soon / late switches,
  and `task_notices` a kind.
- **The phone app** (phase 6b, way C): `office-app/`, Android first, never built
  or run on a phone yet (it needs the owner's Auth0, EAS and Firebase set-up).

## 13. The AI-first research and the owner's decisions (22 Nov 2026)

Item 11 was researched (`reports/AI first back office strategy.md`) and mocked up
(`docs/mockups/pepper-first/`, published as a Claude Artifact), which is the condition section 11
set for un-parking it. The report's plan is nine steps (0 to 8) and replaces the phase order in
section 7 where the two differ. The owner answered ten of its eleven decisions the same day, each
"Agree", which means the report's recommendation stands. Steps 0 to 2 were built 22 and 23 Nov 2026
(PRs #498 to #500; follow-ups in `docs/claude/outstanding/shell.md` 49, 50, 52 and `pepper.md` 51).

1. **What AI-first means: agreed.** The Pepper-first Home and the ask bar in the product. Sell hours
   saved and one platform with Pepper included. "AI-first" is not the headline to franchisees or staff.
2. **Default or switched on: agreed.** The new Home is the default for every group and role. A
   full-screen conversation is never a landing page, and no menu is removed.
3. **Generated forms: agreed.** Real forms that arrive filled in, and a deterministic renderer for
   flat set-up forms. The model never makes up fields, layout or validation.
4. **Confirm on every change: agreed.** It stays for everything until undo exists and first customers
   give reversal figures. After that a group may move a short named list of reversible, low-cost
   actions to "Done, with Undo". Never money, pay, prices, allergens, deletions or anything about a person.
5. **Scope of the data framework: agreed.** A registry over what exists, in the per-area records of
   `docs/PARALLEL_WORK.md`, with the report catalogue's subject names as the vocabulary. Custom
   fields later. No tenant-defined tables. The six open decisions in `docs/PARALLEL_WORK.md`
   section 9 still gate step 1.
6. **Identity on shared devices: agreed.** A PIN person switch before any change. A till PIN is enough
   for logging checks and nothing else.
7. **Skipping a compliance task: agreed (23 Nov 2026).** A skip only with a reason,
   recorded and shown above the store. It gates the task store in step 5 and nothing before it.
8. **Usage data about people: agreed.** Managers see task completion by site. The record of pages a
   person opens stays that person's own (section 4.5). Pepper does not rank individuals.
9. **Model writes to allergens and pay: agreed.** A named person signs off any allergen data a model
   read and any change to pay or tips. No exception by voice or in a batch.
10. **Price and cost of Pepper: agreed.** Included in every plan with a fair-use allowance per venue,
    and a ceiling on model spend as a share of price. No paid agent until one has a measured result.
11. **Segment and retail: agreed.** Franchised and multi-site quick-service first. Retail limited to
    food-led and franchise retail, after stock on hand, as a test.

Asked after step 2 (23 Nov 2026): the ask bar hands its words to Pepper's remembered chat, not a new
one (as the phone's Pepper page already did); `open_page` offers what permissions allow, by the names
in the person's own menu, a page outside their menu marked Not in your menu.

Still open: the first run of the evaluation set against the live model (it needs `ANTHROPIC_API_KEY`
in the environment), and steps 3 to 8.

