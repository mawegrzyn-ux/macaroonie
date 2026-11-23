// src/pages/help/navigation.jsx
// The Help page's "Navigation" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'navigation'
export const label = 'Navigation'
export const order = 270

// ── NAVIGATION ───────────────────
export function Section() {
  return (
    <section id="navigation" data-help="">
      <H2>Navigation</H2>
      <P>
        An owner can customise the left sidebar for everyone in the restaurant from the
        <strong> Navigation</strong> page (sidebar nav, under Admin). Each person&apos;s own shortcuts
        are their pins on Home (see Home, Your pins). The Launcher (a tile screen that could replace
        the sidebar for a whole group) has gone: groups that used it found its tiles as pins on Home.
      </P>
      <H3>Searching the menu</H3>
      <P>
        The ask bar (on Home, or over any page: <strong>Search or ask</strong> at the top of the sidebar,
        Ctrl+K, or <strong>/</strong>) searches the menu as you type. Type a page&apos;s name or what you want
        to do — <strong>&ldquo;change staff pay&rdquo;</strong>,{' '}
        <strong>&ldquo;fridge temperatures&rdquo;</strong>, <strong>&ldquo;allergy&rdquo;</strong> — and the
        pages that fit show under the box, best match first, each saying what the page is for and which
        section it sits in. The search looks in those words too, so a page is found by what it does as well
        as by what it is called. A match in a page&apos;s own name comes first, then its everyday words, then
        its description. A plural finds the singular and the other way round, so{' '}
        <strong>&ldquo;designers&rdquo;</strong> lists every designer and{' '}
        <strong>&ldquo;tickets&rdquo;</strong> finds the Receipt &amp; ticket designer. Filler words (how, do,
        I, change…) are ignored, so a whole question works. It only ever offers pages your role can open, and
        a page renamed in the Navigation designer is still found by its old words. When nothing fits, or you
        would rather ask, press Enter and Pepper takes the words (see Home, The ask bar).
      </P>
      <H3>What each menu entry is for</H3>
      <P>
        Every entry in the menu has a short description: a sentence or two, 260 characters at
        most, saying what the page is for. It shows under the entry&apos;s name in the search
        results, as the tooltip when you hold the pointer over a link or a section heading in
        the sidebar, and on each row of the Navigation page.
      </P>
      <P>
        Each page comes with standard words. To write your own (your group&apos;s name for a
        job, a note on who uses the page), open <strong>Navigation</strong>, tap the pencil on a
        row and type in <strong>Description</strong>. The counter shows how much room is left,
        and Save waits while the text is over 260 characters. Leave the box empty, or tap{' '}
        <strong>Use the standard words</strong>, to go back to the standard description.
        A section can have a description as well; it shows as the section&apos;s tooltip, and
        the search doesn&apos;t look in it (it would match every page in the section).
      </P>
      <H3>Designers in the menu</H3>
      <P>
        The designers have their own entries in the menu, so the search finds each by its name
        and one tap opens it. They used to sit inside other pages (a list at the bottom of
        Kiosks, a tab of Menu screens, a card on Kitchen screens, a button in the menu editor,
        a section of Website).
      </P>
      <DataTable
        head={['Entry', 'Where in the menu', 'What it is']}
        rows={[
          ['Kiosk designer', 'Store tech, after Kiosks', 'The kiosk designs: screens, colours, pictures and words. Kiosks keeps the devices and which design each one uses.'],
          ['Kitchen flow designer', 'Store tech, after Kitchen screens', 'Where dishes go in the kitchen, and the kitchen test. Kitchen screens keeps the stations and the screens.'],
          ['Screen board designer', 'Store tech, after Menu screens', 'The boards your menu screens show.'],
          ['Screen playlists', 'Store tech, after the board designer', 'Boards taking turns, by time of day.'],
          ['Screen walls', 'Store tech, after the playlists', 'Several screens side by side as one picture.'],
          ['Receipt & ticket designer', 'Store tech, after Printing', 'The designs for printed kitchen tickets, bills and receipts. Printing keeps what prints where.'],
          ['Menu print designer', 'Menus, under Menus (after Menu times)', 'Every menu with its printed designs. Open Menus in the sidebar to see it, or search for it.'],
          ['Page builder', 'Brand & web, after Website', 'The website\'s Home page and its other pages, built from blocks. Website keeps the site\'s settings.'],
          ['Reservations widget', 'Brand & web, after the Page builder', 'How the booking widget looks, and its link and code to share.'],
        ]}
      />
      <P>
        Nothing was taken away: the page each designer came out of has a card that opens it,
        and the designer has one that goes back. Old links and bookmarks still open (they go
        on to the new address). Who can open a designer hasn&apos;t changed: it follows the
        same permission as the page it came out of (Store tech, Menu screens, Menus, Website).
        A group whose menu had been changed got each new entry straight after the page it
        belongs with; if that page had been taken out of your menu, add the entry on the
        Navigation page with <strong>Add link</strong>.
      </P>
      <H3>Links that open a page at a venue, day or week</H3>
      <P>
        Six pages can be opened straight at a venue, a day or a week, and one of their tabs, from
        a link: Timeline and Bookings (venue and day), Rota (venue and week), Food safety (venue,
        day and tab: Today, Deliveries, Holds or Cooking), Online orders (venue, day and tab:
        Orders, Report or Transactions) and Cash recon (venue, and a day, a week or the
        week&apos;s wages). Pepper gives such links when you ask for a page with a venue or a
        day in mind. The page opens where the link says once; after that its own venue picker,
        day and week buttons and tabs work as usual, and reloading the page doesn&apos;t take you
        back to the link&apos;s day. A link naming a venue you can&apos;t see, or a day that
        doesn&apos;t exist, opens the page as usual instead.
      </P>
      <H3>The standard menu</H3>
      <P>
        Every group starts with the same menu, grouped by job: <strong>Home</strong> (Home, Local info,
        Overview, Dashboards, Reports, Pepper), <strong>Service</strong> (Timeline, Bookings, Customers, Loyalty,
        Online orders), <strong>Money</strong> (Till reports, Kiosk analytics, Cash recon, Cash dashboard),{' '}
        <strong>Health &amp; safety</strong>,{' '}
        <strong>Stock</strong> (Purchasing, with Order lists, Inventory and Suppliers under it),{' '}
        <strong>People</strong> (Staff, Rota, Rota dashboard), <strong>Menus</strong> (Menus with its pages
        under it, the Menu print designer among them, and Promotions),{' '}
        <strong>Brand &amp; web</strong> (Brand &amp; theme, Website, Page builder, Reservations widget,
        Media, Reviews, Emails), <strong>Venues</strong> (Venues and New venue, Schedule, Tables, Booking
        rules, Ordering setup), <strong>Store tech</strong> (Tills, Till layouts, Floor plan, Kiosks, Kiosk
        designer, Kitchen screens, Kitchen flow designer, Menu screens, Screen board designer, Screen
        playlists, Screen walls, Venue hub, Printers, Printing, Receipt &amp; ticket designer, Card machines,
        Device updates, Order types, Discounts, Charges, Order flows, Revenue streams, Courses, Staff and
        PINs, Till roles, Receipts and payments, Cash Recon link), <strong>Admin</strong> and{' '}
        <strong>Help</strong>. Each page is in it once.
        Pages your role can&apos;t open, and modules switched off, don&apos;t show.
      </P>
      <P>
        The standard menu replaced every group&apos;s menu once, in October 2026 (changes made on this page
        before then went, and the menu went back to the sidebar). In October 2026 the Store tech section
        replaced the Till setup link (whose tabs are now its pages) and took Menu screens from Menus; other
        changes made here were kept. <strong>Reset to defaults</strong> on this page brings the standard menu
        back at any time.
      </P>
      <H3>Editing the sidebar tree</H3>
      <P>
        The Navigation page shows the current sidebar as an outline: sections and links,
        nested as deep as you like. Use the arrow buttons on each row to move an item up or
        down, indent it under the item above, or outdent it back out. <strong>Add section</strong>
        and <strong>Add link</strong> create new items; picking a link's page from the list
        also fills in a sensible icon and permission automatically.
      </P>
      <H3>Per-item controls</H3>
      <DataTable
        head={['Control', 'Effect']}
        rows={[
          ['Description', 'What the entry is for, 260 characters at most. Shown under its name in the menu search and as its tooltip, and searched. Empty uses the page\'s standard words.'],
          ['Module gate', 'Ties the item to an existing module permission — hidden automatically for any role without access, same as today.'],
          ['Hide for specific roles', 'An extra hide on top of the module gate — hide an otherwise-permitted item from just one or two roles without touching their permissions.'],
        ]}
      />
    </section>
  )
}
