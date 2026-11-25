// src/pages/docs/platform-site.jsx
// The Docs page's "Platform site" section: the public pages on macaroonie.com.
// Docs.jsx gathers every file in this folder (except parts.jsx) by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'platform-site'
export const label = 'Platform site'
export const order = 85

export function Section() {
  return (
    <section id="platform-site" data-doc="">
      <H2>Platform site</H2>
      <P>
        The platform&apos;s own public pages on the apex (macaroonie.com): what Macaroonie does, how it is built,
        screenshots, and the register-interest form. They are served by the API, not the admin: the apex hook in{' '}
        <Mono>api/src/routes/platformSite.js</Mono> renders them from Eta views, and every other GET on the apex
        still goes to office. (301). No database tables; the content is in code.
      </P>
      <H3>Pages</H3>
      <DataTable
        head={['Address', 'What it shows']}
        rows={[
          ['/', 'Home (views/platform/landing.eta): the message, six feature tiles that each open a drill-down under their row, how it fits, the sandboxes, the team and the register-interest form.'],
          ['/features', 'The same tiles, and an index of every part of every group.'],
          ['/features/<group>', 'One page per group (guests, service, menus, back-office, pepper, one-platform): its points, screenshot, its parts (each opened in place; /features/<group>#<part> opens one) and how it fits.'],
          ['/architecture', 'The picture in layers: at the venue, the venue hub, the cloud, Pepper and outside services. Each part is a button that opens its detail; /architecture#<part> opens one.'],
          ['/screenshots', 'The screenshots, each opening larger in a dialog.'],
          ['/try, /try/kitchen-flow, /try/kiosk', 'The sandboxes. The two under /try/ are "coming next" placeholders for now (noindex, not in the sitemap).'],
          ['/sitemap.xml, /robots.txt', 'Every page that is not a placeholder; robots names the sitemap.'],
          ['/site/<file>', 'The pages\' CSS, script and screenshots from api/platform-site/. Linked with ?v=<hash of the file> and then cached for a year; without it, an hour.'],
        ]}
      />
      <H3>Where things are</H3>
      <DataTable
        head={['File', 'What it holds']}
        rows={[
          ['api/src/services/platformSite/pages.js', 'PAGES: one record per page (path, view, title, description, nav label, soon, shot for the Open Graph image). sitePage(), NAV, TRY_PAGES, sitemapXml().'],
          ['api/src/services/platformSite/features.js', 'FEATURE_GROUPS: the six groups, their points, parts, screenshot and place in the picture.'],
          ['api/src/services/platformSite/architecture.js', 'ARCH_LAYERS: the layers of the picture and each part\'s text and why it matters.'],
          ['api/src/services/platformSite/screenshots.js', 'SHOTS (file name, size, alt text, caption) and GALLERY, the Screenshots page\'s order.'],
          ['api/src/services/platformSite/assets.js', 'assetUrl() and serveAsset(): /site/<file>, file names checked against a pattern (no folders above img/).'],
          ['api/src/views/platform/site/', '_head.eta and _foot.eta around every page, _tiles.eta, _shot.eta, and one view per page.'],
          ['api/platform-site/', 'site.css, site.js (no build: the header menu, the drill-downs, the picture, the screenshot dialog, the form) and img/ (WebP at 800 and 1600 wide, a JPEG at 1200).'],
          ['scripts/ensure-nginx-site-assets.sh', 'Run by the deploy: adds location ^~ /site/ to the apex nginx config, so the static-file regex doesn\'t look for .css, .js and .png in the admin\'s build.'],
        ]}
      />
      <H3>Adding a page</H3>
      <P>
        Add a record to <Mono>PAGES</Mono> (a <Mono>nav</Mono> label puts it in the header and footer) and a view in{' '}
        <Mono>views/platform/site/</Mono> that starts with <Mono>{"<%~ include('./_head', it) %>"}</Mono> and ends with{' '}
        <Mono>{"<%~ include('./_foot', it) %>"}</Mono>. Styles go in <Mono>site.css</Mono>, behaviour in{' '}
        <Mono>site.js</Mono> or a file of its own under <Mono>api/platform-site/</Mono>. A sandbox under{' '}
        <Mono>/try/</Mono> drops <Mono>soon</Mono> and names its own view. Check the address against the admin&apos;s
        routes first: an admin bookmark on the apex would show the page instead of going to office.
      </P>
      <InfoBox type="info">
        The screenshots come from a local copy filled with an invented group (Harbour &amp; Co). The steps to take
        them again are in <Mono>docs/claude/areas/shell.md</Mono>. Tests: <Mono>api/test/platform-site.test.mjs</Mono>.
      </InfoBox>
    </section>
  )
}
