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
