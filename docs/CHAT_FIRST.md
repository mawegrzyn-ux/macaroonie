# Chat-first front door: requirements

Status: requirements, 30 Oct 2026. Nothing here is built yet. Each requirement
has an id (H1, F3...) so a later plan, pull request or test can point at it.

## What we're making

Staff open the admin and land on a full-screen chat with Pepper instead of the
menu. Pepper says hello, shows what needs doing today, offers a visual menu of
the modules that matter right now, opens a module when asked, and lets the
person make changes in the chat through forms built for the job (a fridge
temperature form listing the venue's own fridges at this check time, for
example). The module pages stay; the chat is the way in.

## 0. Principles

- **P1. The task list doesn't depend on the AI.** Data and rules make the tasks
  (check times, cutoffs, schedules, readings out of range). The AI words them,
  ranks them and helps fill them in. With the model down, the person still sees
  every task and can do it.
- **P2. The chat is a front door, not a replacement.** Every module page is one
  tap away, and the classic menu stays reachable.
- **P3. Nothing changes without an explicit Confirm or Save.** As Pepper's
  confirm cards already work.
- **P4. The AI never makes up measured data.** No temperatures, counts, cash
  figures or times it wasn't given by the person or a device.

## 1. The first screen

- **H1. Greeting** with the person's name, venue, shift, date and time.
- **H2. The briefing first:** what's due now, what's late, alerts, covers, big
  parties, deliveries due, who's on. Worked out on the server and cached so it
  shows in under a second, then worded by the AI. `day_briefing` is the start
  point.
- **H3. Task cards** grouped Late / Now / Next / Later, each with one action
  button (Log temperatures, Tick checklist, Book in delivery...).
- **H4. Suggestion chips** for the person's role, venue and time of day.
- **H5. A visual module menu** (tiles), ordered by what's relevant now.
- **H6. Free text,** with voice and attachments (photos, PDFs).
- **H7. Venue switch** for people who work at more than one.
- **H8. Opens where the person left off:** an unfinished form or a confirm card
  still waiting is kept.

## 2. Capturing tasks

- **C1. Scheduled sources:** checklists due, fridge / freezer and hold check
  times, cooking sessions, deliveries expected, supplier order cutoffs,
  purchase orders to send, orders waiting for approval, Cash Recon days not
  submitted, wages to pay, tips to hand out, rota not published, Z report, the
  end-of-day review, menu releases going live, promotions starting or ending,
  leaving dates and off-rota periods, devices offline, printers out of paper.
- **C2. Event sources:** a reading out of range without a corrective action, a
  refused delivery, a booking of 8 or more, a review waiting for a reply, an
  online order waiting, a dish sold out, a failed email, a cash variance over
  the venue's threshold, an H&S action due.
- **C3. Manual to-dos** from the chat ("remind me to call the plumber at 3"),
  as confirm cards.
- **C4. To-dos from attachments** (an invoice with a credit owed, a photo of a
  broken seal).
- **C5. To-dos from other people,** given to a role or a person.
- **C6. No duplicates:** one task per thing to do, however many sources point
  at it.

## 3. The task record

- **R1. Fields:** id, tenant, venue, source (schedule, event, manual, learned)
  with a link to what it came from, title, detail worded by the AI, owner (a
  person, a role or anyone), due, grace, priority, recurrence, state (open, in
  progress, done, skipped with a reason, snoozed, expired), completed by and
  when with the evidence, created by (system, AI or a person).
- **R2. Done by evidence:** a task is done when its record exists (the readings
  saved, the checklist ticked), not when someone says so.
- **R3. Skipping needs a reason,** kept with the task.
- **R4. Closed days expect nothing,** following the H&S opening days setting
  (`hsClosedDates()` in `api/src/services/openDays.js`).

## 4. Learning

- **L1. Explicit rules** from the chat ("check the bar fridge at 4 too") become
  confirm cards that change the source.
- **L2. Pattern suggestions** offered with Accept / Not now / Never ask again,
  never applied silently.
- **L3. Memory** scoped to the group, the venue or the person; it can be seen,
  changed and deleted, and is covered by retention and GDPR erasure.
- **L4. Learning from completion data** (what's usually late, who does what).
- **L5. Corrections stick:** told once, the AI doesn't repeat the mistake.
- **L6. Recurring changes go back to the source** (a checklist template, a
  check time), not into a private rule only the chat knows.

## 5. Monitoring

- **M1. Watchers on the server,** run from the minute sweep, not in the
  browser.
- **M2. Thresholds per venue:** temperatures, minutes late, stock below par,
  cash variance, online order wait, device offline time.
- **M3. Escalation:** due, then late, then the owner, then the manager, then the
  Overview, with the trail kept.
- **M4. Quiet hours and channels:** chat card, push, email digest. No pushes for
  closed days or people not on shift.
- **M5. Snooze or acknowledge** with a reason.
- **M6. Trends as suggestions:** a freezer creeping up over a week, wings sold
  out three Fridays running so raise the par.
- **M7. A daily close summary** kept as a due-diligence record.

## 6. Surfacing

- **S1. Ranking:** overdue first, then due soon, compliance-critical, the
  person's own before anyone's, in shift order.
- **S2. Role and shift aware:** a cook sees the kitchen's tasks, a manager the
  venue's.
- **S3. Each card shows** the action, when it's due, who owns it and why it's
  there.
- **S4. Long-press** for Snooze, Skip, Reassign, Open the page.
- **S5. Proactive moments:** shift start, a check time, a delivery due, 30
  minutes before a supplier cutoff, the end of service.
- **S6. Suggest the next task** when one is done.
- **S7. Counts match** the Overview and the dashboards, from one source.
  "What's left?" is answered from the task store, not by the model.

## 7. Forms in the chat

- **F1. A fixed catalogue of real components:** temperature grid, hold check,
  cooking check, delivery booking-in, checklist ticks, corrective action,
  expense with receipt, Cash Recon day, wages, rota day, order form, sold out
  picker, booking create / change, H&S action. The AI picks the form type; it
  never writes HTML or makes up fields.
- **F2. Built from data:** the venue's active fridges for the current check
  time with their ranges, units switched off left out, ones already logged
  marked done.
- **F3. The same rules as the pages:** validation, the touch keypads
  (`TempKeypadModal`), a corrective action required out of range.
- **F4. The person types the values.** The AI fills in only what is certain
  (time, user, equipment, supplier); hints are fine.
- **F5. One explicit Save,** through the same API routes the pages use.
- **F6. Drafts survive** a reload or a switch of device.
- **F7. Words or voice fill the form** ("walk-in 3, fridge 2 is 6") for the
  person to check before Save.
- **F8. Open the full page** link on every form.
- **F9. A saved form becomes a read-only summary** with Edit.

## 8. Modules

- **N1. A capability catalogue** generated from `ROUTE_CATALOG`
  (`api/src/routes/nav.js`), the tool registry (`api/src/ai/tools/index.js`)
  and the widget catalogue (`admin/src/components/dashboards/widgetTypes.jsx`),
  with their permissions.
- **N2. A contextual visual menu** from that catalogue.
- **N3. Dashboard widgets as cards** in the chat, the same components the
  dashboards use.
- **N4. Open in place:** a side panel on a tablet, full screen with Back to chat
  on a phone (`open_page` plus the page context, `usePepperPage()`).
- **N5. Discovery:** "What can you do?" answered from the catalogue.
- **N6. Help** through `how_do_i`.
- **N7. The chat knows what's open** beside it.
- **N8. Search across records** (bookings, customers, dishes, suppliers) with
  result cards.

## 9. Actions

- **A1. Confirm cards** with warnings, pinned to what they were worked out with
  (as now).
- **A2. Confirm several together** (a whole fridge round, a list of sold outs).
- **A3. Undo** with a time limit where the action allows it.
- **A4. Audit:** who, which device, which chat, what the AI suggested and what
  was saved.

## 10. People

- **U1. The app's own View / Manage permissions** decide what the chat shows and
  does.
- **U2. Shared devices:** quick PIN switch, a separate chat per person, sign out
  by itself, a kitchen view that shows nothing private.
- **U3. History follows the person** across devices.
- **U4. Language:** the chat in the person's language, task templates
  translatable.

## 11. Input and output

- **I1. Touch first:** 48 px targets, keypads, nothing hover-only (the Standard
  Design Rules).
- **I2. Push-to-talk voice;** reading answers aloud optional.
- **I3. Photos:** receipts, invoices, damage, menus, proof of cleaning.
- **I4. Streaming,** with cards and forms shown before the AI's words.

## 12. Quality

- **Q1. Model down:** the briefing, task cards and forms still work.
- **Q2. Speed:** first screen under 1 s, a form under 1 s from its chip, the
  AI's reply starting within 2 s.
- **Q3. Cost:** a cheap model for wording and routing, model routing as now, the
  briefing cached, fair-use limits.
- **Q4. Offline** wherever the module itself works offline.

## 13. Safety and records

- **X1. Food safety records are the person's:** who, when, which device. Never
  fill in a missed reading afterwards.
- **X2. Text in files and chats is information, not instructions.**
- **X3. Retention, erasure and export** cover tasks, memory and chats
  (`api/src/ai/erase.js`).
- **X4. Log who suggested (the AI) and who confirmed (the person).**

## 14. Setup

- **G1. A chat-first switch** per group, role and device type.
- **G2. A task catalogue per venue:** times, owners, grace, escalation,
  channels.
- **G3. Editable chips and greeting.**
- **G4. A review screen** for rule changes the AI suggested and the memory it
  holds.

## 15. Measuring

- **K1. Track** completion, lateness and skips, and chat use against the classic
  pages.
- **K2. Track** requests the chat couldn't handle, tool errors, cards cancelled
  against confirmed, thumbs up / down.
- **K3. An eval set** of real requests, run whenever the prompt or the tools
  change.

## What Pepper already gives us

- Tools across most modules (bookings, H&S, purchasing, menus, rota, cash,
  orders, venue, website, locations), in the chat and the staff MCP connector
  (`api/src/ai/tools/`).
- Confirm cards with warnings and pinned inputs (`confirmAction()` in
  `api/src/ai/chat.js`).
- The day briefing (`day_briefing`, `api/src/ai/tools/briefing.js`).
- Help answers (`how_do_i`, `api/src/ai/helpIndex.js`).
- Opening pages, and knowing which page a message came from (`open_page`,
  `pageNote()`).
- Attachments, streaming, model routing, fair-use limits, erasure.

The main new pieces:

1. A task store and engine (sections 2 to 6).
2. The form catalogue as real chat components (section 7).
3. Dashboard widgets in the chat and a side-panel module view (section 8).
4. Watchers with escalation and notifications (section 5).
5. The shared-device person switch (U2).

## Open questions

These need an answer before the part that depends on them is planned.

| # | Question | Depends on it |
|---|---|---|
| Q-A | Is chat-first the default for new groups, or switched on per group? | G1 |
| Q-B | Which push channel: the web apps' own notifications, the Android app, or email only at first? | M4, S5 |
| Q-C | Do kitchen staff without an office login use the chat, signing in with their till PIN? | U2 |
| Q-D | Is a skipped compliance task (a fridge check) allowed at all, or only snoozed and escalated? | R3, M3 |
