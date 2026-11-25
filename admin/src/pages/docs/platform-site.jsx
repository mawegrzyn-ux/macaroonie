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
          ['/try', 'The sandboxes, each with its screenshot and a link.'],
          ['/try/kitchen-flow', 'The kitchen flow sandbox: boxes (stations, a pass, Splitters, Sleepers, printers) linked by tapping an arrow then a box, each link taking every dish or one section; a test order runs through the kitchen test bench and every screen shows its tickets, the printer its printed ticket. Script api/platform-site/try-kitchen.js.'],
          ['/try/kiosk', 'The kiosk sandbox: colour, fonts, text sizes, a logo word and four dishes beside a portrait kiosk preview to tap through Welcome, Menu, a dish, the order and Done. Script api/platform-site/try-kiosk.js.'],
          ['/sitemap.xml, /robots.txt', 'Every page that is not a placeholder; robots names the sitemap.'],
          ['/site/<file>', 'The pages\' CSS, script and screenshots from api/platform-site/. Linked with ?v=<hash of the file> and then cached for a year; without it, an hour.'],
          ['/site/shared/<version>/<file>', 'The shared rules the sandboxes run in the browser, as they are in shared/ (plain ESM). Only the files the entries import are served (an allowlist made from their import lines); <version> is a hash of them all, so they are cached for a year and an old version answers 404. Gzipped when the browser takes it.'],
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
          ['api/src/services/platformSite/sharedModules.js', 'ENTRIES (pos/kitchenBench.js, pos/kitchenPrint.js, pos/ticketHtml.js, kiosk.js), sharedBase(), sharedPreloads() for a page\'s modulepreload links, sharedFiles() and serveShared(). A page record names its css, script and shared entries; _head.eta links them.'],
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
        <Mono>/try/</Mono> names its own view, its <Mono>css</Mono> and <Mono>script</Mono>, and the shared modules its
        script imports (<Mono>shared</Mono>), so they are preloaded; a module not yet on the list goes in{' '}
        <Mono>ENTRIES</Mono>, and must have no Node-only imports. Check the address against the admin&apos;s
        routes first: an admin bookmark on the apex would show the page instead of going to office.
      </P>
      <H3>The sandboxes run the real rules</H3>
      <P>
        Neither sandbox has a copy of a rule. The kitchen flow sandbox builds a kitchen flow in the real shape
        (stations and links with section filters) and hands it to <Mono>createBench()</Mono> from{' '}
        <Mono>shared/pos/kitchenBench.js</Mono>, the office&apos;s Test the kitchen: the dishes&apos; ways, Splitters, the
        Sleeper&apos;s wait, each screen&apos;s tickets (<Mono>stationTickets()</Mono>), the pass&apos;s Ready and what the
        printer prints (<Mono>kitchenPrintJobs()</Mono>, drawn with <Mono>previewHtml()</Mono>) all come from the kitchen&apos;s
        own code. Its checks are <Mono>flowProblems()</Mono> and <Mono>flowWarnings()</Mono>. Fire now moves the bench&apos;s
        pretend clock to when the Sleeper wakes. A change to the flow is a new flow switched to, as on a kitchen
        screen: dishes already sent keep their way. The kiosk sandbox cleans its design with{' '}
        <Mono>normaliseDesign()</Mono> and draws it with <Mono>kioskTextVars()</Mono>, <Mono>kioskFontStack()</Mono>,{' '}
        <Mono>kioskFontsUrl()</Mono>, <Mono>partColours()</Mono> and the kiosk&apos;s words (<Mono>uiText()</Mono>); its
        screens are a small stand-in for the kiosk app&apos;s, styled with the same --k-* variables. Neither calls the
        API or saves anything; each keeps the visitor&apos;s own setup in localStorage.
      </P>
      <InfoBox type="info">
        The screenshots come from a local copy filled with an invented group (Harbour &amp; Co). The steps to take
        them again are in <Mono>docs/claude/areas/shell.md</Mono>. Tests: <Mono>api/test/platform-site.test.mjs</Mono>.
      </InfoBox>
    </section>
  )
}
