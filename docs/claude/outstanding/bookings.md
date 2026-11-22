# Outstanding: bookings

What is not built, known limits and follow-ups in this area (`docs/claude/areas/bookings.md`). Item numbers are the old CLAUDE.md numbering, kept so earlier references still work; a new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending.

**1. Booking widget — Stripe deposit flow** *(shipped with migration 220; follow-ups in item 36)*

**4. Customer hard delete** *(done 22 Nov 2026)*
`DELETE /api/customers/:id` (owners, Customers Manage) and Delete this customer on the customer's panel, asked twice. The record goes; bookings, online orders and loyalty membership stay without the link (ON DELETE SET NULL) and keep the guest's details written on them, so it is for test and demo data, not erasure (use Anonymise). Nothing deletes the bookings themselves.

**6. Email system loose ends**
- ~~`nodemailer` is not in `api/package.json`~~ — done 22 Nov 2026 (nodemailer 10; `secure` left unset now follows the port: TLS from the start on 465 only). SMTP has still never sent through a real server.
- ~~Guest manage page `POST /modify` lacks slot validation~~ — stale: it checks
  `get_available_slots()` and table allocation (now in `services/guestBookingSvc.js`).
- ~~Stripe webhook confirmation path does not schedule reminder emails~~ — stale: every
  widget, deposit and Pepper booking goes through `afterNewBooking()` (`services/holdBooking.js`),
  which schedules the reminder (migration 220).
- After deploy, clear stale BullMQ jobs in Redis — the `notificationQueue` job name
  changed to `'booking_email'` (with required `venueId` field), so old-format jobs
  enqueued before the change will fail forever.
- Legacy `src/services/notificationSvc.js` is dead code — safe to delete.
