// src/pages/help/website.jsx
// The Help page's "Website Builder" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'website'
export const label = 'Website Builder'
export const order = 300

// ── WEBSITE BUILDER ────────────────────────────
export function Section() {
  return (
    <section id="website" data-help="">
      <H2>Website Builder</H2>
      <P>
        Build a public-facing website for your restaurant — hero image, menus, gallery,
        opening hours, booking widget, links to delivery partners, SEO and analytics.
        Your site is hosted at <Mono>{'{slug}.macaroonie.com'}</Mono> and you can later
        point your own domain at it (e.g. <Mono>book.yourrestaurant.co.uk</Mono>).
      </P>
      <P>
        The website has three pages in the menu, under Brand &amp; web. <strong>Website</strong>{' '}
        holds the site&apos;s settings: the header and footer, the locations index, look and
        layout, domain, SEO, legal and cookies, analytics, the emergency banner, and each
        location&apos;s details (opening hours, find us, contact, gallery, PDF menus, allergens,
        booking, online ordering, delivery). <strong>Page builder</strong> is where the pages are
        built from blocks: Home, Pages &amp; modals, and each location&apos;s page and its own
        pages. <strong>Reservations widget</strong> is how the booking widget looks, with its link
        and code to share. The left rail of Website and Page builder links to the other two, and
        Publish sits at the top of both.
      </P>

      <H3>Getting started</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Go to <strong>Website</strong> in the sidebar (globe icon).</li>
        <li>
          On first visit you'll see an onboarding card. Pick a <strong>subdomain</strong>
          &nbsp;(lowercase letters, numbers, hyphens — e.g. <Mono>wingstop-covent-garden</Mono>)
          and click <strong>Create website</strong>.
        </li>
        <li>
          Your site is created but <strong>not yet published</strong> — it only goes live
          when you flip the <em>Publish</em> toggle in Setup &amp; domain.
        </li>
        <li>
          Fill in sections in any order. Each section has its own <strong>Save</strong>
          button — changes only go live when you save.
        </li>
      </ol>

      <H3>The 18 sections</H3>
      <P>The left rail groups sections into logical steps:</P>

      <DataTable
        head={['Section', 'What it does']}
        rows={[
          ['Setup & domain',   'Subdomain slug, custom domain (with DNS verification), publish toggle.'],
          ['Template',         'Visual layout. Pick Classic (warm, traditional) or Modern (editorial, full-bleed hero).'],
          ['Theme',            'Your look & feel — independent of template. Colours, fonts, sizes, spacing, corners, buttons, hero overlay.'],
          ['Look & layout',    'The site name and social-preview picture, the boxed inset layout, and a location\'s own look. The logo, colours and fonts are on the Brand & theme page (see Brand & Theme); the website uses them once published.'],
          ['Hero',             'The first screen guests see: image, heading, subheading, call-to-action button.'],
          ['About',            'Short story / description with an optional image.'],
          ['Gallery',          'Photo grid. Drag to reorder, add captions, upload new images.'],
          ['PDF menus',        'Upload PDF menus with labels (e.g. Lunch, Dinner, Drinks), only for menus you haven\'t built on the Menus page: those show with the Menu (inline) block and have their own printable PDF. Show PDF menus switches them on or off for the location. On, add the PDF menus block to a page to list them (every page template includes it). Off, the block shows nothing, isn\'t offered when adding blocks, and the location\'s menu page is hidden.'],
          ['Allergens',        'Either a PDF document OR a structured dish-by-dish table with allergen pills.'],
          ['Opening hours',    '7-day grid. Multiple sessions per day (Lunch/Dinner) supported.'],
          ['Find us',          'Address, latitude/longitude, Google Maps embed URL.'],
          ['Contact',          'Phone, email, Instagram, Facebook, X, TikTok, YouTube.'],
          ['Online ordering',  'Links to takeaway/pre-order services (e.g. GloriaFood).'],
          ['Delivery',         'Links to Deliveroo, Just Eat, Uber Eats, Gogetters, Foodhub.'],
          ['Reservations widget', 'Embed the live reservations widget inline. Per-block: header, button, fonts (3 tracks), day colours. Every block also has an Anchor ID in its settings for in-page links.'],
          ['Guestplan widget', 'If you take bookings with Guestplan: paste your access key in the block. Guestplan shows its own floating booking button and form on the page (on a computer it may open the form by itself). The heading is optional and shows where the block sits.'],
          ['Pages',            'Standalone pages or modal overlays. Link picker lists them plus block anchors.'],
          ['SEO',              'Meta title, description and social-preview image (Open Graph).'],
          ['Analytics',        'Google Analytics 4 and Meta (Facebook) Pixel IDs.'],
        ]}
      />

      <H3>Heading block</H3>
      <P>
        Add a <strong>Heading</strong> block (Content) for a section title on its own: type straight onto
        the page or in the panel. While the block is selected you can also fill in a small line above (for
        example OUR MENU) and a line below. In the panel choose the heading level (H1 to H4: use one H1 per
        page, usually its main title, so search engines read the page outline correctly), the size
        (Automatic follows the level; large sizes shrink to fit on phones), alignment, font (the theme's
        heading or body font, or any font from the list), weight, italic, capitals, a decoration (a short
        bar underneath, or lines either side), colours from your theme, a background and the space above
        and below. An empty Heading block shows nothing on the live site.
      </P>

      <H3>Tabs block</H3>
      <P>
        Add a <strong>Tabs</strong> block (Layout) to put other blocks behind tabs, for example Lunch,
        Dinner and Drinks menus. On the page, tap a tab to open it and use the + inside it to add blocks
        to that tab. To move a block into another tab, drag it onto that tab's name. In the panel you can
        rename tabs, drag them into a new order, add more (up to 10) and remove one (with a confirm, which
        also removes its blocks). Choose the tab style (underline, pills or boxed), alignment, the colour
        of the open tab, a background, and how phones show it: the tab strip (scrolls sideways) or
        drop-down sections. Give a tab a <strong>link anchor</strong> (e.g. <Mono>dinner</Mono>) and a
        link to <Mono>#dinner</Mono> opens that tab; a link to any anchor inside a tab opens it too.
        Columns and Tabs can't be put inside a tab or a column.
      </P>

      <H3>Menu block without pictures</H3>
      <P>
        The <strong>Menu (inline)</strong> block shows the dish photos and the small section pictures
        you set on the Menus page. To show a menu in words only, select the block and, under Display,
        switch off <strong>Show dish photos</strong> and <strong>Show section pictures</strong> (either
        one on its own works too). It only changes that block: the same menu elsewhere on the site,
        online ordering, the kiosks and the printed menu keep their pictures.
      </P>

      <H3>Photos from your computer</H3>
      <P>
        Drag a photo from your computer onto the page: dropped on an <strong>Image</strong>,{' '}
        <strong>Hero</strong> or <strong>Story</strong> block it becomes that block&apos;s picture;
        dropped on any other block, a new Image block with it goes after that block. Every picture
        field in the block settings (and on the Website pages) takes a dropped photo too. They go
        into Media like an upload. Blocks move by the grip handle on their left edge: it shows when
        you point at a block, on the selected block, and always on a touch screen.
      </P>

      <H3>Full screen editing</H3>
      <P>
        The <strong>Full screen</strong> button at the top of the page builder hides the app menu and the
        website menu so you only see the page and the block settings. Each scrolls on its own. Tap{' '}
        <strong>Exit full screen</strong> to get the menus back. The builder remembers your choice.
      </P>

      <H3>Publishing your site</H3>
      <P>
        Every change you make in the website builder shows on your <strong>staging</strong> address straight
        away. Guests only see it once you publish. The <strong>Publish</strong> button sits at the top of the
        website menu, above Home. Underneath it says whether your live site matches staging:{' '}
        <em>Live matches staging · published 3 days ago</em>, or <em>4 changes not live yet · last published
        yesterday</em> with the number on the Publish button too (or <em>Not published yet</em>). It updates
        by itself after each save. The publish window lists what would change: Home page, Brand &amp; theme (also changes made on the Brand &amp; theme page),
        each page or pop-up (new, changed, removed or hidden), each location&apos;s page and details. Gallery
        photos, PDF menus, allergens, opening hours from your schedule and menus built on the Menus page
        aren&apos;t part of publishing: they show on the live site as soon as you save them.
        The <strong>Staging</strong> button next to it opens your staging site in a new tab, so you can check
        your edits before publishing (it appears once your site has an address under Domain).
        Tap Publish to open the publish window: copy or open your staging link, <strong>Publish now</strong>,
        schedule a publish for later (or cancel one), or <strong>Override staging with production</strong> to
        throw away unpublished edits (asks you to confirm). Your address, custom domain and the{' '}
        <strong>Site is live</strong> switch are under <strong>Domain</strong>; while the site is switched off,
        the publish window reminds you that visitors see a 404 page.
      </P>

      <H3>Staging password</H3>
      <P>
        Your staging site is hidden from search engines, but anyone who has its link can open it. To keep it
        private, open the publish window and under <strong>Staging</strong> tap <strong>Add a password</strong>,
        type one (at least 6 characters) and tap <strong>Save password</strong>. From then on, visitors to your
        staging address see a page asking for the password; once they enter it, their browser remembers it for 30
        days. Send the password to whoever needs to see the preview (your designer, the owner, a manager).
      </P>
      <P>
        You don&apos;t need to type it yourself: the <strong>Staging</strong> button and <strong>Open staging</strong>{' '}
        in the publish window take you straight in (the Staging button shows a small lock while a password is set).
        <strong> Change password</strong> signs everyone out of staging, so they need the new one.{' '}
        <strong>Remove password</strong> (asks you to confirm) opens staging to anyone with the link again. Only
        owners and admins can set, change or remove it. Your live site never asks for a password.
      </P>

      <H3>Theme manager — how it works</H3>
      <P>
        The theme (colours and fonts on the <strong>Brand &amp; theme</strong> page, spacing
        on Website &gt; Look &amp; layout) controls the look &amp; feel of your site
        regardless of which template you chose. A theme change to Classic instantly
        applies the same way if you switch to Modern.
      </P>
      <P>You can fine-tune seven areas:</P>
      <DataTable
        head={['Group', 'Controls']}
        rows={[
          ['Colours',    '7 colours: Primary (brand/CTA), Accent (highlights), Background, Surface (alt-band background), Body text, Muted text, Borders.'],
          ['Typography', 'Heading + body font (Google Fonts auto-loaded), base size, heading scale, weights, line-height.'],
          ['Spacing',    'Container max width, section padding (desktop + mobile), grid gap, and the boxed-inset "Layout" card below (side padding on boxed/wide blocks — see next).'],
          ['Corners',    'Small / medium / large border-radius.'],
          ['Logo',       'Header logo height.'],
          ['Buttons',    'Radius, padding, font weight.'],
          ['Hero',       'Overlay darkness (so text stays readable over images) and minimum height.'],
        ]}
      />
      <InfoBox type="tip">
        Start with colours + fonts. Everything else is fine-tuning. <strong>Reset to
        defaults</strong> is always available if you mess something up.
      </InfoBox>

      <H3>Colours on blocks and in the other builders</H3>
      <P>
        A block&apos;s colour (a heading, the footer, a promo, the basket, the reservations
        widget&apos;s buttons) offers the seven theme colours first. A theme colour follows the
        theme: change Primary on the Theme page and every block using Primary changes with it.
        The last swatch, the rainbow, is a <strong>custom colour</strong>: tap it for your
        device&apos;s colour picker, or type a code like #336699 in the box that appears. A
        custom colour stays as it is when the theme changes. Tap a theme swatch to go back to
        the theme.
      </P>
      <P>
        The menu screen designer, the kiosk designer, menu tag colours and the booking email
        editor&apos;s text colour show the same theme colours as swatches, then a custom colour.
        The kiosk designer also has a <strong>Website colours</strong> set to start from.
      </P>
      <P>
        Background colours can also be <strong>See-through</strong> (the checkered swatch first
        in the row): nothing is drawn, so what is behind shows. On a menu screen board: the
        board&apos;s background (the designer shows a checkerboard behind it), a box, a scrolling
        text&apos;s background and the order board&apos;s Ready and Preparing boxes. On a kiosk
        design: Cards, Buttons and Highlights (the page and the words always have a colour; the
        pop-up windows keep the page colour so they stay readable). Text colours have no
        See-through. A printed menu&apos;s colours are inks on the paper, so they don&apos;t have it either.
      </P>

      <H3>Make a theme from a picture</H3>
      <P>
        <strong>Make a theme</strong> builds a whole look (colours, fonts, corners and capitals)
        from a picture and a few words. It is on the Brand &amp; theme page (Theme ideas),
        in the kiosk designer (Brand), in the menu screen designer (Board &gt; Theme maker) and
        in the printed menu designer (Page setup &gt; Colours). You need Manage on that page.
      </P>
      <DataTable
        head={['Step', 'What to do']}
        rows={[
          ['1. A picture', 'Upload one, drop it on the box, pick one from Media, or tap Use my logo. A logo, a photo of the restaurant or the food, or anything with the look you want. Its main colours show under it, and three themes made straight from them (light, dark and bold) show at once.'],
          ['2. The look you want', 'Optional. Say it in your own words ("relaxed Italian, terracotta and olive"), or tap an example. "Make it warmer" works from what you have now.'],
          ['3. Make themes', 'Pepper makes three themes from the picture and the words (it takes a few seconds). Try again for three more; More like this on a theme for three close to it.'],
          ['4. Show on', 'See every theme on the website, a kiosk, a menu screen or a printed menu, so one theme can go everywhere.'],
          ['5. Use this', 'Fills in the page\'s colours and fonts. Nothing changes until you save, as usual: check it, then Save.'],
        ]}
      />
      <P>
        Every theme is checked before you see it: words are made dark or light enough to read on
        what they sit on, the website&apos;s buttons always carry white words, and a menu screen
        gets a deep background with light words, which reads from across the room. A printed menu
        keeps its cream paper and takes the theme&apos;s fonts and inks. The window also lists{' '}
        <strong>Themes you used</strong> (on this device), so the theme you gave the website can
        go on the kiosks and screens too.
      </P>
      <InfoBox type="tip">
        Without Pepper (switched off, or no AI key on the server) the window still makes the three
        themes from the picture&apos;s colours. Pepper&apos;s themes count towards your AI allowance
        like a chat; the picture isn&apos;t kept.
      </InfoBox>

      <H3>Boxed inset (margins) — customisable per step</H3>
      <P>
        The <strong>Layout</strong> card (Website &gt; Look &amp; layout, tenant-wide — applies to every
        venue's site) controls the side padding inside "boxed" and "wide" blocks. Padding is
        picked from 5 numbered <strong>steps</strong>, and you can now redefine what each
        step actually means: give it a plain pixel value (e.g. step 1 = 20px) or a
        percentage (e.g. step 3 = 5%) — mix units freely across the 5 steps.
      </P>
      <P>
        Below the step editor, two pickers set which step is the <strong>default</strong>
        (used everywhere) and which step applies only on narrow phones held upright (the{' '}
        <strong>mobile portrait override</strong> — tablets, phone landscape, and desktop
        always use the default). Any individual block can still override its own inset in
        the page builder's block inspector, picking one of the same 5 steps.
      </P>
      <P>
        Each step can also have its own <strong>mobile value</strong> — tick "Mobile" under
        any step card to give it a different px/% value on narrow phone portraits (≤600px)
        than on everything else, e.g. step 1 = 16px on desktop, 8px on mobile. This applies
        everywhere that step number is used — the site-wide default AND any individual
        block that's set its own inset to that step — so you don't need to separately tune
        mobile spacing per block.
      </P>
      <P>
        After clicking <strong>Save layout</strong>, publish the site again: the live site
        shows the last published version, so a new mobile value appears there only after the
        next publish. The mobile value applies on phones held upright; turn the phone sideways
        and the normal value is used.
      </P>
      <P>
        The two rows of step buttons below show what each step means on phones. The default
        step row shows a second line (for example &ldquo;8px mobile&rdquo;) when a step has a
        mobile value. The mobile portrait override row shows only the phone value, because it
        only applies on phones. If the override is set, it decides the phone padding for
        blocks that use the default, not the default step.
      </P>
      <InfoBox type="tip">
        A practical use: set step 1 to a fixed 20px for tight mobile margins, and set a
        different step to 5% so wide-screen margins scale with the page instead of staying
        a fixed width forever.
      </InfoBox>

      <H3>Give a location its own look</H3>
      <P>
        Every location&apos;s page starts on the group&apos;s brand (the logo, colours and fonts on the{' '}
        <strong>Brand &amp; theme</strong> page) and the website&apos;s layout. If you run more than one
        venue and want one location&apos;s page to look different (its own logo, colours, even its own
        site name), open Website &gt; <strong>Look &amp; layout</strong> and tap{' '}
        <strong>Give a location its own look</strong>, then pick the venue. This copies today&apos;s
        settings as a starting point and adds the venue as its own pill: from then on, editing that pill
        only changes that location, and the group&apos;s brand only changes locations without their own
        look. A new venue can get its own look while it is set up (New venue &gt; Brand &amp; theme).
      </P>
      <P>
        To go back to the group&apos;s brand, open that venue&apos;s pill and tap{' '}
        <strong>Remove override</strong> (with an inline confirm). The pills only show once you have more
        than one venue.
      </P>
      <P>
        The page builder previews every page in the site&apos;s template and brand:
        the home page, extra pages and modals, and each location page. A location page, and
        any page belonging to that location, previews with its own look when the
        location has one. The small label next to "Page builder" shows the template in use.
      </P>

      <H3>Custom domain</H3>
      <P>
        You can point your own domain (e.g. <Mono>www.yourrestaurant.com</Mono>) at your
        Macaroonie site. Open <strong>Domain → How to connect your domain</strong>
        for the full walkthrough (including the exact DNS records to add at GoDaddy,
        Cloudflare, Namecheap, and the rest). The short version:
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>
          In <strong>Website → Domain</strong>, type the address guests will use, exactly:{' '}
          <Mono>www.yourrestaurant.com</Mono> and <Mono>yourrestaurant.com</Mono> are different.
          Save. You&apos;ll see <strong>DNS not verified</strong>.
        </li>
        <li>
          At your DNS provider (Cloudflare, GoDaddy, 123-reg etc.), add the record the guide
          shows: a <strong>CNAME</strong> to your Macaroonie address for <Mono>www.</Mono>, or an{' '}
          <strong>A record</strong> to the IP address it lists for the bare domain. On Cloudflare,
          set the record to <strong>DNS only</strong> (grey cloud).
        </li>
        <li>Wait a few minutes, then click <strong>Verify DNS</strong>.</li>
        <li>
          Once DNS is verified, our server switches the domain on by itself and gets its HTTPS
          certificate, usually within a minute or two. Until then the domain shows a plain{' '}
          <strong>404</strong> page: that is expected, not a fault in your DNS. Stay on the Domain
          section: it updates by itself and the link to your domain appears once it works.
        </li>
      </ol>
      <P>What the Domain section can say while it switches the domain on:</P>
      <DataTable
        head={['Message', 'What it means']}
        rows={[
          ['Switching … on', 'All good; it usually takes a minute or two.'],
          ['Waiting for …\'s DNS', 'Your domain doesn\'t point only at us yet. The message says where it points. Fix the record at your DNS provider; we check again every minute. A leftover IPv6 (AAAA) record that points elsewhere stops it too: delete it.'],
          ['Works on http:// only for now', 'The site is on, but the HTTPS certificate couldn\'t be issued yet. We try again by ourselves (the time is shown); pressing Verify DNS tries again sooner. Usual cause: Cloudflare\'s orange cloud (switch it to DNS only).'],
        ]}
      />
      <InfoBox type="info">
        Want both <Mono>yourrestaurant.com</Mono> and <Mono>www.yourrestaurant.com</Mono>? Enter one in
        the Domain section (that is the site&apos;s address) and point the other one at us too. It is
        switched on with the first and sends visitors to it, also if you add its DNS record later
        (within a minute of it pointing at us). Without that record, the other name doesn&apos;t work
        and browsers show it as not secure.
      </InfoBox>
      <InfoBox type="info">
        A browser that opened your domain before it was switched on can keep offering the old address
        from its history (an <Mono>http://</Mono> or <Mono>www.</Mono> one). Type the full{' '}
        <Mono>https://</Mono> address once, or try a private window, before deciding something is wrong.
      </InfoBox>
      <InfoBox type="warn">
        Typing a different domain clears the verified flag, and you&apos;ll need to verify again.
        Saving the Domain section without changing the domain keeps it verified.
      </InfoBox>

      <H3>Uploading images and PDFs</H3>
      <P>
        Any section with an image uses a standard upload button. Images are compressed
        on upload where sensible. Size limits:
      </P>
      <DataTable
        head={['File type', 'Max size', 'Formats']}
        rows={[
          ['Images (logo, favicon, hero, about, gallery, OG image)', '8 MB each', 'JPG, PNG, WebP, SVG, GIF, and ICO (for the favicon)'],
          ['PDF menus',    '25 MB each', 'PDF'],
          ['Allergen PDF', '25 MB',      'PDF'],
        ]}
      />

      <H3>Gallery — drag to reorder</H3>
      <P>
        The gallery section shows a grid of images. <strong>Drag any image</strong>
        by the grip handle (top-left) to reorder. Captions are edited inline — changes
        aren't saved until you click <strong>Save order &amp; captions</strong> at the
        bottom of the section.
      </P>
      <InfoBox type="tip">
        On touch devices, press-and-hold an image for a moment before dragging (so
        you don't trigger a page scroll by accident).
      </InfoBox>

      <H3>Menus (PDF viewer)</H3>
      <P>
        Upload a PDF (e.g. <em>Lunch Menu</em>) and Macaroonie embeds a nice inline
        viewer on your site at <Mono>{'{slug}.macaroonie.com/menu'}</Mono>. You can upload
        multiple PDFs — each appears as a tab button so guests can switch between them.
        A "Download PDF" link is always visible.
      </P>

      <H3>Allergen information</H3>
      <P>Two ways to tell guests about allergens:</P>
      <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
        <li><strong>Upload PDF</strong> — simplest. Link to your existing allergen guide.</li>
        <li>
          <strong>Dish-by-dish table</strong> — add each dish and toggle which of the 14
          common UK/EU allergens it contains (gluten, dairy, egg, peanut, etc). Free-text
          notes per dish.
        </li>
      </ul>

      <H3>Opening hours</H3>
      <P>
        A 7-day grid with one or more <strong>sessions</strong> per day. A session is a
        continuous block (e.g. <em>Lunch 12:00–15:00</em>). Most restaurants will have two
        sessions per day — click <strong>Add session</strong> to add a second one.
        Tick <strong>Closed</strong> to mark a whole day (or a specific session) as closed.
      </P>

      <H3>Online ordering &amp; delivery</H3>
      <P>
        Both sections are lists. <strong>Add a row</strong>, paste the URL, click
        Save. The entries appear as buttons in their respective bands on your site.
        Delivery providers have a dropdown for a clean logo/label; Online ordering is free-text.
      </P>
      <InfoBox type="tip">
        These sections are hidden by default. Flip the "Show section on site" toggle at
        the top of each to make them visible.
      </InfoBox>

      <H3>Reservations widget</H3>
      <P>
        Guests book directly via an embeddable widget. <strong>Reservations widget</strong>
        in the sidebar (Brand &amp; web, after Page builder) lets you set the tenant-wide defaults
        that apply to every embed of the widget across all your venues.
      </P>
      <P>
        The flow visitors see: covers → date → time → details → confirmation.
        A month-view calendar with prev/next navigation, jump-to-date input, and
        closed days greyed out (hatched) so they can't waste clicks on the venue's
        day off.
      </P>
      <P>What you can customise on the Reservations widget page:</P>
      <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
        <li>
          <strong>Header</strong> — show/hide the brand line at top, override the
          header text, override the "Book a table" sub-line.
        </li>
        <li>
          <strong>Button</strong> — background and text colour (pick from your brand
          palette), corner radius.
        </li>
        <li>
          <strong>Borders + radii</strong> — border colour, card/chip corner radius.
        </li>
        <li>
          <strong>Typography</strong> — three independent font tracks: <em>Body</em>
          (header, button labels, form fields), <em>Calendar</em> (date numbers),
          <em>Time slots</em> (HH:MM buttons). Each has its own font picker and
          size slider — mix a script font for the calendar with a sans-serif for
          slots, etc.
        </li>
        <li>
          <strong>Calendar day colours</strong> — Open day vs Closed day, each with
          background, text, and border. Pick from the brand palette.
        </li>
        <li>
          <strong>Messages</strong> — "Larger party? Call us" copy override.
        </li>
        <li>
          <strong>Debug</strong> — diagnostic overlay at top of widget showing live
          state. Leave off for normal customers; flip on to debug.
        </li>
      </ul>

      <P>Two ways to use it on a site:</P>
      <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
        <li>
          <strong>On your Macaroonie site</strong> — add a <em>Reservations widget</em>
          block from the Page builder. Same controls as the tenant defaults but
          per-block, so a specific page can override fonts/colours without changing
          the tenant default. Set <em>Anchor ID</em> in the block to make it linkable
          with <Mono>&lt;a href="#book-now"&gt;</Mono> from anywhere.
        </li>
        <li>
          <strong>On any other site</strong> — the <em>Share &amp; embed</em> card on
          the Reservations widget page generates both a direct URL (for email links,
          QR codes, link-in-bio) and an iframe embed code (for embedding inline on
          third-party sites). Both bake your saved defaults into URL query params.
        </li>
      </ul>
      <InfoBox type="info">
        The widget posts a <Mono>macaroonie:booking-confirmed</Mono> message to the
        parent window when a booking succeeds — your dev can hook this for analytics,
        redirects, or thank-you popups. The hold TTL (configurable per venue in Rules,
        default 5 min) reserves the slot client-side; abandoning the form releases it.
      </InfoBox>

      <H3>Pages & modals</H3>
      <P>
        On the <strong>Page builder</strong> page. For content that doesn't fit elsewhere — <em>Private Dining</em>, <em>Careers</em>,
        <em>Events</em>, <em>Terms &amp; Conditions</em>. Each page has:
      </P>
      <ul className="list-disc ml-5 space-y-1.5 text-sm text-muted-foreground mb-4">
        <li>A <strong>title</strong>.</li>
        <li>A <strong>URL slug</strong> — standalone pages live at <Mono>/p/{'{slug}'}</Mono>; modals also open from <Mono>#modal/{'{slug}'}</Mono>.</li>
        <li><strong>Opens as</strong> — standalone page or modal overlay.</li>
        <li>The same <strong>block builder</strong> as the home page. Set Anchor ID on a block to deep-link a section.</li>
        <li>Every nav / button / footer link uses a <strong>link selector</strong>: this page (with or without an anchor), other pages, modals, or a custom URL.</li>
      </ul>
      <P>
        The list always includes <strong>Order online</strong>, your online ordering page at{' '}
        <Mono>/order</Mono> (marked <em>Ordering</em>). Design it like any other page: add a hero,
        some text or photos around the <strong>Online ordering</strong> block, which shows the menu,
        basket and checkout. You can rename it, but it always stays at <Mono>/order</Mono>, stays
        published and can&apos;t be deleted; switch ordering on or off in Online orders, Setup.
        The Online ordering block can also go on another page (one per page).
      </P>
      <P>
        The list also always includes <strong>Loyalty</strong>, your loyalty page at{' '}
        <Mono>/loyalty</Mono> (marked <em>Loyalty</em>), holding the <strong>Loyalty card</strong>{' '}
        block where guests join, sign in and see their card. It works the same way: rename it and
        design around the block, but it stays at <Mono>/loyalty</Mono>, stays published and
        can&apos;t be deleted. See Loyalty, The Loyalty page on your website.
      </P>

      <H3>SEO &amp; Analytics</H3>
      <P>
        Set the meta title (what shows in browser tabs and search results) and meta
        description (the preview snippet under the title). Upload a social preview image
        (ideally 1200×630 — this is what appears when someone shares your URL on Facebook,
        WhatsApp, iMessage, LinkedIn etc.).
      </P>
      <P>
        <strong>Restaurant details for search</strong> — fill in <em>Cuisine type</em>
        (e.g. Thai, Italian, Japanese) and <em>Price range</em> ($–$$$$). These appear
        directly in Google search results and are also read by AI assistants such as
        ChatGPT, Perplexity, and Google Gemini when they summarise your restaurant. The
        system embeds them as <Mono>schema.org/Restaurant</Mono> structured data (JSON-LD)
        on every page of your site automatically.
      </P>
      <P>
        Your site also serves an <Mono>llms.txt</Mono> file at{' '}
        <Mono>{'https://{slug}.macaroonie.com/llms.txt'}</Mono> — a plain-text index
        that AI crawlers read to discover your venues, addresses, opening hours, and booking
        links without having to parse HTML. No action required on your part; it is generated
        automatically from your published content.
      </P>
      <P>
        Analytics: paste your <strong>Google Analytics 4 measurement ID</strong> (starts
        with <Mono>G-</Mono>) and / or a <strong>Meta Pixel ID</strong>. Both are injected
        on every page automatically. Make sure you comply with your cookie-consent rules.
      </P>

      <H3>Publishing &amp; going live</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Fill in at minimum: site name, logo, hero image + heading, opening hours, contact details.</li>
        <li>Preview by visiting <Mono>{'https://{slug}.macaroonie.com'}</Mono> — works even while unpublished for admins.</li>
        <li>
          When you're ready, go to <strong>Setup &amp; domain</strong>, flip
          <em>&nbsp;Site is live</em> on, and save.
        </li>
        <li>Your site is now public. Any future change you save applies within ~1 minute.</li>
      </ol>
      <InfoBox type="warn">
        Publishing is a hard on/off switch. When off, visitors see a 404 page — regardless
        of how much content you've filled in.
      </InfoBox>

      <H3>Common issues</H3>
      <div className="space-y-2.5">
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">"Subdomain already taken"</p>
          <p className="text-sm text-muted-foreground">
            Subdomains are global — one per Macaroonie customer. Try adding a city or brand
            qualifier: <Mono>wingstop-london</Mono> instead of <Mono>wingstop</Mono>.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Changes don't appear on the site</p>
          <p className="text-sm text-muted-foreground">
            Make sure you clicked <strong>Save</strong> at the bottom of the section
            (changes are never auto-saved). Then hard-refresh your browser (Ctrl-Shift-R or
            ⌘-Shift-R) — your site is cached for about a minute.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">"DNS not verified" after I added the CNAME</p>
          <p className="text-sm text-muted-foreground">
            DNS can take up to 24 hours to propagate. Try again in 10 minutes. The verify
            button's error message shows what records we saw — use it to double-check your
            DNS provider.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Gallery images don't reorder</p>
          <p className="text-sm text-muted-foreground">
            Grab the image by the grip handle (top-left of each card), not by the image
            itself. On touch devices, press-and-hold briefly before dragging.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Theme changes didn't apply to my custom pages</p>
          <p className="text-sm text-muted-foreground">
            Custom pages inherit the theme automatically — no action needed. If you're
            still seeing the old style, hard-refresh your browser to bypass the cache.
          </p>
        </div>
      </div>
    </section>
  )
}
