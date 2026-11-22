# Outstanding: website

What is not built, known limits and follow-ups in this area (`docs/claude/areas/website.md`). Item numbers are the old CLAUDE.md numbering, kept so earlier references still work; a new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending.

**3. Header & Footer as page-builder blocks**
The site header and footer are currently template-baked (`templates/{key}/partials/header.eta` + `footer.eta`) and read auto-derived data: tenant_site logo + nav from venues/menus/pages, social_links, address, etc. Operators want them editable AS BLOCKS in the page builder so they can add/remove nav links, swap CTA copy, restructure footer columns, surface custom social handles. Required:
- Two new block types: `header` and `footer`. Each has rich data shape (header: `{ logo_url, brand_text, nav_items: [{label,url}], cta: {text, url} }`; footer: `{ columns: [{title, items: [{label,url}]}], copyright, show_social, show_powered_by }`).
- React canvas components for both, with editor controls (add/remove link, drag-reorder).
- Eta block partials per template (`templates/{key}/blocks/header.eta`, `footer.eta`) so each template renders its own signature chrome.
- Rendering shift: `index.eta` and `location.eta` STOP including `partials/header.eta` / `partials/footer.eta`. Instead, the home_blocks/page_blocks array renders, and we auto-prepend a `header` block + auto-append a `footer` block when missing (so the user always gets working chrome out of the box).
- Page builder UX: header block should be locked at index 0, footer at the last position (no drag). New "+" inserter sits between them.
- Picking a page template seeds blocks with header + footer at the expected positions.

**5. Website builder — deployment pieces** *(feature shipped code-side, not yet deployed)*
- Nginx: wildcard server block for `*.macaroonie.com` (proxy_pass → Fastify API).
- DNS: wildcard A record `* → <Lightsail-IP>` on Lightsail DNS. Wildcard does NOT
  shadow more-specific records (regular `api`, `app`, etc. take precedence as expected).
- SSL: wildcard cert via Certbot DNS-01. **DNS lives on AWS Lightsail** (NOT Route53,
  NOT Cloudflare), so there's no off-the-shelf Certbot plugin. Use AWS CLI hook
  scripts with `certbot --manual --preferred-challenges dns-01` — see the runbook in
  the "Lightsail wildcard cert setup" gotcha below for the full path including IAM
  policy, hook scripts, and the renewal cron entry.
- Custom domains: switched on by the domain sync (`scripts/custom-domains-sync.sh`, installed
  by the deploy) within a minute of Verify DNS. Still to do: verification only checks that the
  domain points at us, not that the tenant owns it (a TXT token would), so a domain someone
  pointed here and nobody claimed could be claimed by any tenant and get a certificate; the
  sync only adds a twin it finds (www / bare), not other names; not yet run on the real server
  with a real certbot and systemd (tested with certbot stubbed).
- Migrations 025 + 026 + 027 + 035 + 036 + 037 + 038 + 039 + 040 + 041 + 042 are applied automatically by the migrate runner
  (or auto-baselined on first run via `AUTO_BASELINE_UP_TO=024`).
- Optional: set `STORAGE_DRIVER=s3` + `S3_*` env vars to use S3 / DO Spaces / R2
  instead of local disk for uploads.
