# Outstanding: core

What is not built, known limits and follow-ups in this area (`docs/claude/areas/core.md`). Item numbers are the old CLAUDE.md numbering, kept so earlier references still work; a new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending.

**4. RBAC — what's left after the View / Manage rollout** *(rollout done Oct 2026, see Completed items)*
- The `requireRole()` calls left are deliberate extras on top of module permissions: Team and Access (owner), Cash Recon settings and unsubmit, booking delete, refunds, H&S General settings, Loyverse / GloriaFood setup (owner/admin), email suppression removal (owner).
- No per-page route guards in `main.jsx`: a page opened by URL with `none` renders and shows refusals / empty lists instead of redirecting.
- Widget test has no read-only mode (its booking flow goes through the public widget API anyway).
- ~~The Media library still deletes categories and items behind `window.confirm`~~ — done 22 Nov 2026 (on-page confirms; so do the page builder's template replace, the image pickers' upload errors and a Cash Recon expense delete). Still native pop-ups (rule 4): `window.prompt` for a link in the website builder's rich text (`canvas/InlineRichText.jsx`) and for links, images and buttons in the email template editor (`pages/EmailTemplates.jsx`): each needs a small input box of its own.

**7. Docs.jsx update for platform/team**
Help.jsx has a Team Management section; Docs.jsx does not yet have a corresponding
technical section for the platform-admin routes, RBAC matrix, or `platform_admins` table.

**57. Shared devices and the person switch, step 6a follow-ups (Pepper-first, 24 Nov 2026, migration 280)**

Built: a device marked shared for a venue; Who is this? before any change (a name, then a PIN); a till PIN for logging checks only, an office PIN (set by the person, PBKDF2) for anything else, held to the lower of the person's role and the account's; 2 minutes idle, 30 minutes at most, Lock in one tap; 5 wrong PINs lock that person on that device for 5 minutes (15 for the device); the person recorded in checks, checklists, H&S actions, the task log and Pepper's audit; every change on a shared device kept in `shared_device_changes`.
- **What the check doesn't cover**: routes that don't sign people in through `requireAuth` (the guest site, widget, ordering, loyalty, the till, kitchen, kiosk, screens and hub device APIs, webhooks): a shared device's admin pages never call them. Access tokens (the staff MCP connector) and in-process calls acting as a person (the notices sweep) return before the check. POST routes marked `FREE` (not changes): the chat, its files, a card's Cancel, a form card's saved line, form drafts, the usage record, report preview / plan / run / export, the switch, Lock, still here. A GET that writes something of its own (the Today feed's record, `/shared-devices/this`'s last seen) isn't asked about.
- **A POST that only reads and isn't marked `FREE` asks for a PIN on a shared device** (slots and availability searches, other report reads): annoying, never unsafe. Mark them as they turn up.
- **The device is known only by its token in the browser's storage**: clearing it on a shared device gives back the signed-in account's own access. A "shared devices only" flag on an account (refuse its changes without a device token) would close that; until then, sign shared devices in with an account that has only what they need (Help and Docs say so).
- **Destructive, pay, tips and allergen changes** still need their typed word or named sign-off (unchanged), and on a shared device an office PIN (a till PIN never reaches them). No extra second person is asked for.
- **Captures need an office PIN** on a shared device (decision 6: a till PIN for checks and nothing else). If kitchen staff with only a till PIN should photograph a delivery note, that is the owner's call.
- **No report subject** on `shared_device_changes` yet: the step's measure (share of changes on shared devices tied to a named person) is a count over it (`person_id IS NOT NULL` of `status < 400`).
- **The till PIN is checked against the till's own hash** (`cash_staff.pos_pin_hash`, the venue's salt); a till PIN for staff at another venue isn't offered. A person with both a till and an office PIN shows twice in Who is this? (one each).
- **The admin's own idle lock** follows taps and keys; a long form filled without a tap for 2 minutes asks for the PIN again on Save (the server's switch went idle too).
