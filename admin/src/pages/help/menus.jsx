// src/pages/help/menus.jsx
// The Help page's "Menus" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'menus'
export const label = 'Menus'
export const order = 310

// ── MENUS ────────────────────────────────────────
export function Section() {
  return (
    <section id="menus" data-help="">
      <H2>Menus</H2>
      <P>
        The <strong>Menus</strong> page (sidebar nav) is a structured menu builder —
        sections (Starters, Curries, …) containing dishes, each with a price, optional
        description and photo. Menus display on your website via the Booking widget's
        menu block and can be opened as a printable PDF at any time.
      </P>
      <P>
        To give a dish (or a section) its photo, tap the picture box and pick one from Media, or
        drag a photo from your computer straight onto the box.
      </P>
      <P>
        Anyone who can manage Menus can also build and change menus by chat: attach a photo or
        PDF of a menu to <strong>Ask Pepper</strong> and ask it to make the menu, or ask it to
        change a price, add an allergen or put a section up 5%. See <strong>Pepper → Menus by
        chat</strong>.
      </P>
      <H3>A menu from a photo or PDF</H3>
      <P>
        <strong>From a photo or PDF</strong> on the Menus page (also the Menu step when setting up a new venue)
        makes a whole menu from the menu you already have. Add photos of each page (in order) or a PDF:
        choose files, drop them on the box, or take a photo on a tablet or phone. Up to 10 files, photos up to
        5 MB each and PDFs up to 10 MB. Optionally say what to know ("only the dinner pages; prices are for eat
        in"), then tap <strong>Read the menu with Pepper</strong>; a long menu takes a minute or two.
      </P>
      <P>
        Pepper lists the sections and dishes it read with their prices, descriptions, allergens, dietary tags
        and options (sizes, extras). Check them: change a name or price, open a dish for its description, remove
        anything that isn&apos;t right, add a dish it missed, and give the menu a name and the venue it is for.{' '}
        <strong>Make the menu</strong> saves it as a draft, not published: check it in the menu editor, add
        photos, then publish it. Allergens and dietary tags are matched to the ones you already have (never
        added); options use your option groups where they match, or get a new group named after the menu. It
        needs Manage on Menus and Pepper switched on, and counts towards your AI allowance like a chat. A
        reading is only as good as the picture: check every price before publishing.
      </P>
      <H3>Publishing menu changes</H3>
      <P>
        Saving a menu saves a <strong>draft</strong>. Guests and staff keep seeing the{' '}
        <strong>live</strong> menu until you publish: the website, online ordering, the till,
        the Deliveroo menu file, cooking check dish buttons and the allergen lookup all use the
        live menu. So you can change several prices over a few days, check them, and put them
        all out at once.
      </P>
      <P>
        The <strong>Publish</strong> button sits next to Save at the top of a menu. Its small
        badge counts the saved changes that aren&apos;t live yet (a dot means the menu has never
        been published, a clock that a publish is scheduled); while changes are waiting it is
        the coloured button. Tap it to open the <strong>Publishing</strong> window: what is
        live, and every change waiting to go live (prices in amber, dishes added in green,
        removed in red). Then:
      </P>
      <DataTable
        head={['Button', 'What it does']}
        rows={[
          ['Publish now', 'Asks you to confirm, then the changes go live straight away. Open tills update within a few seconds.'],
          ['Schedule', 'Pick a date and time. The live menu stays as it is until then, and switches by itself at that time (within a minute). Use it for a planned price rise or a new season\'s menu. Changes you save after scheduling are not included: publish again for those.'],
          ['Preview print', 'Prints the draft, so you can check it before guests see it. The link works for an hour.'],
          ['Discard changes', 'Puts the live menu back into the editor and throws the unpublished changes away. Asks you to confirm first.'],
          ['Cancel (scheduled)', 'Withdraws a scheduled publish before it goes live. The draft is not changed.'],
          ['Publish history', 'Every publish, newest first. Preview prints an earlier version; Copy into editor puts it back into the draft (nothing goes live until you publish it).'],
        ]}
      />
      <P>
        Save your changes before publishing: the Publishing window asks you to while the menu has
        unsaved changes. A brand-new menu isn&apos;t on the website, online ordering or the till
        until its first publish. <strong>Shown to guests</strong> (in the menu&apos;s Settings)
        is part of the draft too, so hiding a menu also takes effect when you publish.
      </P>
      <P>
        On the Menus list, each menu shows <strong>LIVE</strong>,{' '}
        <strong>LIVE · CHANGES NOT PUBLISHED</strong>, <strong>NOT PUBLISHED</strong> or{' '}
        <strong>GOES LIVE</strong> with the time of a scheduled publish. Print and Dietary list
        on the list print the live menu; in the menu editor they print the saved draft. Staging
        websites show the draft too, so you can check a website change before publishing.
      </P>
      <P>
        Some things are not part of a menu&apos;s publish and change straight away: the
        allergen and dietary tag list (names, colours, badges), the allergen notice, option
        groups themselves (Menus &rarr; Variant groups), print designs and which one prints,
        and dishes marked sold out for online ordering.
      </P>
      <H3>Menu times</H3>
      <P>
        <strong>Menus &rarr; Menu times</strong> is the one place that says when each menu is on at a
        location, on the website (online ordering), the self-order kiosks and the tills. Pick the
        location at the top. Each menu is a row; the columns are its <strong>Times</strong> and the three
        places, <strong>Website</strong>, <strong>Kiosks</strong> and <strong>Tills</strong>.
      </P>
      <DataTable
        head={['Column', 'What it does']}
        rows={[
          ['Times', "The menu's own times: Set times opens the days, the times of day (for example lunch Monday to Friday 11:00 to 15:00, with more rows for other days or hours) and dates (From and Until, to change menus on a day: the old menu Until 31 May, the new one From 1 June). None set: any time."],
          ['Website, Kiosks, Tills', "Menu's times: that place follows the menu's own times. Any time: on there all day, whatever the times say (drinks, a menu the tills always need). Own times: different times for that place only (dinner on the kiosks from 18:00); Change times edits them. Off: not on there at all (Off in Website takes it off online ordering)."],
        ]}
      />
      <P>
        Several menus can be on at once: each place then shows them all (lunch and drinks, their sections
        one after another). Menus on at the same time get a note under the table, not a refusal. A time that
        ends before it starts, or a date range that ends before it begins, says what is wrong and Save waits
        until it is fixed. <strong>Save</strong> saves the whole table; Discard puts it back. The website has
        the change at once, and tills and kiosks that are online straight away (any that missed it, at their next
        check for changes: Store tech &rarr; Device updates).
      </P>
      <P>
        On a <strong>till</strong>, the menus on now show by themselves, and change as their times do: at
        15:00 lunch goes and at 17:00 dinner comes. With no menu on (between lunch and dinner, say) the till
        shows every menu rather than none. Staff can show other menus with <strong>More &rarr; Menus</strong>
        (or the Menus button on the counter, or a Menus button in a till layout): tap the menus to show and
        Done. That pick stays until the menus on now change, then the till follows the menu times again;
        Follow the menu times goes back straight away. On a <strong>kiosk</strong>, a guest keeps the menus
        that were on when they started, so nothing changes under them; between menus the kiosk says
        &quot;Not taking orders right now&quot; and when it opens again (&quot;Orders start again at
        17:00.&quot;). Kiosk previews show every menu. Tills and kiosks show only the menus their revenue
        stream offers (Store tech &rarr; Revenue streams), at these times.
      </P>
      <H3>Sections and dishes</H3>
      <P>
        Click <strong>Add section</strong> to create a category, then <strong>Add
        dish</strong> inside it. Every dish can have a single price, or — for dishes sold
        in multiple sizes/proteins — one or more <strong>variant groups</strong> (managed
        separately under Menus → Variant groups) attached with per-dish price overrides.
      </P>
      <P>
        Tap a dish to edit it in the panel on the right. Tap a section's heading to edit the
        section there too: its title, subtitle, small icon, <strong>Highlight</strong>, print
        options and tax. The section heading shows badges for what is set
        (Highlight, Tax, New page…). Deleting a section is in its panel and asks you to confirm.
      </P>
      <P>
        Deleting a whole menu also takes it off <strong>Ordering setup</strong> (with its menu
        times), every <strong>revenue stream</strong> that named it and the{' '}
        <strong>Deliveroo menu file</strong> settings. A revenue stream left with no menus shows
        every menu on its tills.
      </P>
      <P>
        To change the order of dishes, drag a dish by its grip (the dotted handle on the left
        of the row) up or down. A dish stays in its own section; to move it to another
        section, delete it and add it there. The small arrows still move a dish one place at
        a time. Click <strong>Save changes</strong> to keep the new order.
      </P>
      <P>
        <strong>A dish&apos;s option groups</strong> (Variant groups, at the bottom of its panel)
        show as cards, closed at first: each says the group&apos;s name, how many options it has
        and how many prices you changed for this dish. Tap a group&apos;s name to open it and set
        this dish&apos;s prices; tap it again to close it. A group you attach opens straight away.
        Drag a group by its grip to change the order: the till, kiosks and online ordering ask
        the groups in that order (flavour first, then dips). Save changes keeps the order;
        guests get it once the menu is published.
      </P>
      <P>
        <strong>Options on this dish only.</strong> Some dishes have options added to the dish
        itself rather than from an option group: the sample menus, menus made before option
        groups, and some imports. The dish&apos;s row shows a small amber badge with how many,
        and its panel lists them in an amber card above its option groups. Guests pick one, at
        its price, before any group. They are kept when you save. They can&apos;t be changed
        here; the card has two buttons:
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Turn into an option group</strong>: makes an option group with the same
          options and prices (on Menus &rarr; Variant groups, named after the options, where you
          can rename it and use it on other dishes; guests still see the heading
          &ldquo;Choose&rdquo;). It goes first among the dish&apos;s groups. When a group with the
          same options already exists, the button says <strong>Use the option group</strong> and
          the dish uses that group, keeping its own prices. A meal deal that changed these
          options (Options in this deal) changes the group instead.</li>
        <li><strong>Remove</strong>: takes them off the dish, after asking. Guests then order it
          at its own price, so give it one if it has none.</li>
      </ul>
      <P>
        Both are part of the menu draft: Save changes keeps them. The new group itself is made
        straight away (it stays on Variant groups even if you don&apos;t save).
      </P>
      <P>
        <strong>On a phone</strong> each dish&apos;s badges, price and buttons go on a second line
        under its name, a dish&apos;s or section&apos;s panel opens over the whole screen (close it
        with the cross), and the buttons along the top show only their icons. Save with the bar
        at the bottom, which shows as soon as there is something to save.
      </P>
      <H3>Food, retail goods and services</H3>
      <P>
        A menu can sell more than food. In the menu&apos;s <strong>Settings</strong>, <strong>What
        this menu sells</strong> is <strong>Food and drink</strong> (every menu to start with),{' '}
        <strong>Retail goods</strong> (mugs, sauce bottles, gift cards) or{' '}
        <strong>Services</strong> (a cookery class, a private room). A section can sell something
        else than its menu, and a dish something else than its section: pick it in the
        section&apos;s or dish&apos;s panel, or leave it on <strong>Same as the menu</strong> /{' '}
        <strong>Same as the section</strong>. The most specific one wins, as with tax.
      </P>
      <P>
        Retail goods and services have no allergens, diet tags or calories, so a dish panel hides
        them when the dish isn&apos;t food. Anything already set is kept, and comes back if you
        switch the dish back to food. A section or dish that isn&apos;t food shows{' '}
        <strong>Retail</strong> or <strong>Service</strong> next to its name. The type is part of
        the menu, so a change goes live when you publish.
      </P>
      <P>
        Still to come: the allergen matrix, the Allergens page, the kiosk, the till and the
        ordering page leaving non-food out of their allergen checks, kitchen screens skipping
        retail and services, product codes and barcodes, and the word Catalogue for a menu that
        isn&apos;t food.
      </P>
      <H3>Copying dishes, sections and options</H3>
      <P>
        <strong>Copy a dish</strong>: tap the copy icon on its row, or <strong>Copy</strong> at
        the top of its panel. The copy goes just after it, named &ldquo;(copy)&rdquo;, with
        everything the dish has: price, description, photo, options with this dish&apos;s own
        prices, allergens and tags, till, tax and online settings, a combo&apos;s steps. Its panel
        opens so you can rename it.
      </P>
      <P>
        <strong>Copy a section</strong> (a category): tap the copy icon on the section&apos;s
        heading, or <strong>Copy</strong> at the top of its panel. The copy goes just after it with
        all its dishes, each keeping its own name; only the section is named &ldquo;(copy)&rdquo;.
        A meal deal in the section that offers a dish of the section, or the whole section,
        offers the copy&apos;s.
      </P>
      <P>
        <strong>Copy options from another dish</strong>: in a dish&apos;s panel, under Variant
        groups, pick a dish from <strong>Copy options from another dish</strong> (only dishes
        with option groups are listed). Its groups come over with that dish&apos;s prices; a
        group this dish already has takes those prices too, and its other groups stay.
      </P>
      <P>
        Copies are part of the menu draft: nothing is kept until <strong>Save changes</strong>,
        and guests see them once the menu is published. Translations aren&apos;t copied with a
        dish or section; the print designer lists the copies under Not placed yet.
      </P>
      <P>
        <strong>Copy an option group</strong>: on <strong>Menus &rarr; Variant groups</strong>,
        tap the copy icon on a group. The copy, &ldquo;Name (copy)&rdquo;, is made straight away
        just after it with every setting and option (prices, pictures, words, levels, then ask),
        and opens so you can rename or change it. It isn&apos;t on any dish until you attach it.
        Translations of its options come with it.
      </P>
      <P>
        <strong>Where a section shows.</strong> In a section's panel, <strong>Where it
        shows</strong> has three choices. <strong>Everywhere</strong> is the usual.{' '}
        <strong>Hide on website</strong> keeps the section on printed menus but leaves it off
        your website and online ordering (so its dishes can't be ordered online), for example a
        set menu you only hand out in the restaurant. <strong>Hide everywhere</strong> takes it
        off printed menus too; it stays on this page so you can show it again later. The
        section heading shows a <strong>Print only</strong> or <strong>Hidden</strong> badge.
      </P>
      <DataTable
        head={['Field', 'What it does']}
        rows={[
          ['Calories', 'Optional kcal count shown next to the price on the website and printed menu. Leave blank for dishes you haven\'t calculated yet — nothing is required.'],
          ['Category icon', 'A small image/icon next to a section\'s title (e.g. a little flame for "Spicy", a leaf for "Vegan Specials"). Upload something roughly square — 64×64 or 96×96 px works well — it always displays small, no bigger than the heading text next to it, regardless of the source size.'],
          ['House favourite', 'Highlights the dish with the featured styling.'],
          ['Dietary tags', 'Small coloured badges (vegan, gluten-free, spicy, …) shown next to the dish name. Tap one in the dish panel to switch it on or off.'],
          ['Allergens', 'One tile per allergen. Tap a tile to step through No, Contains, May contain and Can be removed. All three show the allergen\'s badge on the menu; Can be removed adds a small asterisk, explained by the allergen notice\'s asterisk note.'],
        ]}
      />
      <H3>Option groups: more than once, and behind a button</H3>
      <P>
        On <strong>Menus &rarr; Variant groups</strong>, two settings change how a group is picked
        on the till and the ordering page. <strong>The same option more than once</strong> lets a
        guest take an option twice or more (2 x Extra cheese): each tap adds one, a minus takes one
        off, each one is charged and counts towards &ldquo;at most&rdquo;. <strong>Don&apos;t open
        it by itself: show a button for it</strong> (only for optional groups, at least 0) keeps the
        group closed behind a &ldquo;+ Extras&rdquo; button, so guests who don&apos;t want extras
        aren&apos;t shown them. Tickets, the kitchen screen and receipts show repeats as
        &ldquo;2 x Cheese&rdquo;.
      </P>
      <H3>Option group display names</H3>
      <P>
        A group&apos;s <strong>Group name</strong> is yours, for telling groups apart here and on the
        Menus page (Flavour x2, Flavour x2 (copy)). Its <strong>Display name</strong> is what guests
        see as the heading over its options, such as Choose your flavours: on kiosks, the ordering
        page, the website, printed menus and menu screens, and on the tills. Leave it empty to show
        the group name. The list says <strong>Guests see: ...</strong> for groups that have one. A
        new or changed display name reaches a menu&apos;s guests when the menu is published (the menu
        shows changes not published, like a rename); translate it on Menus → Translations.
      </P>
      <H3>Option group types for stock</H3>
      <P>
        Open a group on <strong>Menus &rarr; Variant groups</strong>: <strong>Recipe and stock</strong>
        says what its options do to the dish. <strong>Product modification</strong>: the dish changes a
        lot, things go on and off its recipe (Make it vegan, No bun). <strong>Side addition</strong>: a
        separate item with its own recipe (a dip pot, fries, a drink). <strong>Adds to the
        recipe</strong>: something added to the dish&apos;s own recipe (extra cheese, a sauce on the
        wings). <strong>Not set</strong> until you pick one. Nothing uses it yet: stock counts will, so
        setting it now saves going through every group later. The list shows each group&apos;s type
        under its name, and a copy of a group keeps it.
      </P>
      <H3>Combos</H3>
      <P>
        A combo is a menu item like any other (in any section, with its own price, description and
        photo) that is put together in steps: for example Main, Side, Drink, then an optional sauce
        pot. Open a dish and tap <strong>Combo</strong> at the top of its panel (Dish is the usual).
        The price is the combo&apos;s own price, and it can be £0 when every choice carries its own
        price. Tap <strong>Edit steps</strong> to build it:
      </P>
      <DataTable
        head={['Setting', 'What it does']}
        rows={[
          ['Step name', 'What the guest is choosing, e.g. "Choose your side". Steps go in order; drag the grip to move one.'],
          ['How many', 'At least / at most. At least 0 makes the step optional.'],
          ['The same choice more than once', 'e.g. 2 x Cola. Each one counts towards "at most".'],
          ['Pick it by itself when there\'s one choice', 'A step with only one choice is filled in for the guest and skipped (its dish\'s own options are still asked).'],
          ['Don\'t open it: show a button', 'Only for optional steps: the step waits behind a "+ Sauce pot" button.'],
          ['When it shows', 'Always, or only when something is picked in an earlier step, e.g. Sauce pot only with Fries. Change that pick and the step (and what was chosen in it) goes.'],
          ['Choices', '+ Dishes picks dishes from this menu; + A whole section offers every dish in a section (dishes added to it later too); + New choice is a choice typed in just for this combo (e.g. Surprise toy), with an optional kitchen name. Each choice can have an extra charge (e.g. Shake +£1.50).'],
        ]}
      />
      <P>
        A dish picked in a step keeps its own option groups unless you change them for the deal
        (see Options in a meal deal below): a burger still asks for its cooking or extras, at the
        dish&apos;s extra prices. Its size or protein (options that set the dish&apos;s price)
        don&apos;t change the combo&apos;s price; only extra charges do. A combo can&apos;t be a
        choice in another combo. Dishes switched off for online ordering can still be a
        combo&apos;s choice.
      </P>
      <P>
        <strong>Manual or Automatic.</strong> A manual combo is only used when it is chosen: its
        own button, or <strong>Make it a combo</strong> on a dish already on a till order. An
        automatic combo also applies by itself when an order has its dishes as separate items, on
        the till and online, whenever that makes the order cheaper. The items stay as they were
        entered; the check or basket shows them as &ldquo;In Burger meal&rdquo; and the saving as
        a line (&ldquo;Burger meal &minus;£3.50&rdquo;). It is checked again whenever the order
        changes.
      </P>
      <P>
        On the website, printed menus and menu screens a combo shows like a dish: its name,
        description and price, with <strong>from</strong> when choices can cost more (the panel
        shows &ldquo;Shown as from £11.00&rdquo;). The steps only appear when ordering, and on a
        menu screen set to <strong>How to order (steps)</strong>. The panel lists anything that
        stops a combo working, for example a step with no choices.
      </P>
      <InfoBox type="info">
        Promotions also has a <strong>Meal deal</strong> kind: a set price when a basket happens to
        hold a starter, a main and a drink, online only. A combo is a menu item of its own with
        steps, on the till and online; an automatic combo also finds its dishes as separate items.
      </InfoBox>
      <H3>Options in a meal deal</H3>
      <P>
        In <strong>Edit steps</strong>, each dish or section choice has{' '}
        <strong>Options in this deal</strong> under its name: what that dish asks inside the deal,
        one option group at a time. The dish stays the menu&apos;s dish, so its kitchen stations,
        allergens, photo, sold out and (later) stock still follow it; only what the guest is asked
        changes. The line under the button says what is changed (&ldquo;Flavour: 3 of 4, choose 1
        to 2 · Dip: not asked&rdquo;), or <em>As on the dish</em>.
      </P>
      <DataTable
        head={['For each group', 'What the deal asks']}
        rows={[
          ['As on the dish', 'What the dish asks on its own (the usual).'],
          ['Leave out', 'Not asked in the deal, e.g. no dip question for the meal\'s wings.'],
          ['Only some', 'Tap an option to leave it out of the deal, e.g. three of the four flavours. At least one stays.'],
          ['Another group', 'A group from Variant groups asked instead, e.g. Meal sauce (free ketchup, or mayo +20p) in place of the fries\' own sauces. Make a copy copies the dish\'s own group and asks the copy: change the copy\'s options and prices on Variant groups (the link at the bottom opens it in a new tab), and the dish on its own keeps its group.'],
          ['How many', 'At least and at most inside the deal, e.g. up to two flavours in the meal while the wings on their own take one. Leave it on As the group to keep the group\'s own.'],
          ['Extra charges in the deal', 'Tap to open it: a box per option the deal asks, for what that option costs on top of the deal\'s price, e.g. Atomic +0.50 or Large +2.00 in the meal. Empty is as on the dish: an option that adds to the dish\'s price keeps its own charge (shown greyed in the box), and an option that sets the dish\'s price (a size, a flavour) costs nothing extra, because the deal\'s price replaces the dish\'s. 0.00 makes an option free in the deal, e.g. a sauce that costs 20p on its own.'],
        ]}
      />
      <P>
        <strong>In the deal:</strong> under each group shows what will be asked. A choice offering a
        whole section changes every dish in it that has that group. Prices follow what is asked: an
        option left out can&apos;t be picked, and another group charges its own prices. The changes
        belong to the combo: they are saved with the menu and go live when it is published, on the
        kiosk, the till and online ordering alike, and kitchen tickets show each part with what was
        picked. <strong>Make it a combo</strong> on the till keeps only the picks the deal asks for.
        An automatic combo only counts a dish ordered on its own when the deal could have asked it
        that way: with three of the four flavours, wings ordered with BBQ don&apos;t make the deal,
        while a dip the deal leaves out simply stays on the wings at its own price. A group later
        taken off the dish drops out of the deal the next time the menu is saved.
      </P>
      <P>
        <strong>Extra charges.</strong> The deal&apos;s own charge for an option shows beside it on the
        kiosk, the till and online ordering (&ldquo;Atomic +£0.50&rdquo;), is added to the meal&apos;s
        price when picked, and is on the line and the receipt. The window&apos;s <em>In the deal</em>{' '}
        line lists the charges, and the line under the button names them (&ldquo;Flavour: 3 of 4, Atomic
        +£0.50&rdquo;). A menu that has any deal charge shows the meal as <strong>from</strong> its
        price. A step that picks itself (one choice) shows its choice&apos;s extra charge beside{' '}
        <em>Included</em> on the till and online, e.g. <em>Included · +£1.00</em>.
      </P>
      <P>
        <strong>One option left.</strong> When a group the deal changes is left with a single option
        and something has to be picked from it (Only some down to Lemon pepper, say, in a flavour
        group that asks for one), the deal picks it for the guest: the kiosk, the till and online
        ordering don&apos;t ask it, but it is on the line, the kitchen ticket, the meal&apos;s picture
        and the price (an extra charge on that option still applies). The window says{' '}
        <em>always Lemon pepper. Guests aren&apos;t asked</em>, and the line under the button says{' '}
        <em>Flavour: always Lemon pepper</em>. A dish left with nothing to ask gets no page of its own
        on the kiosk. An optional group left with one option (a dip they might not want) is still
        asked, as yes or no: set How many to at least 1 to always include it without asking (for a
        group that can be picked more than once, the same number at least and at most, e.g. 2 to 2 for
        two Ranch dips). An option that opens a question of its own (Steak, then how it&apos;s cooked)
        is still asked.
      </P>
      <H3>Allergens and dietary tags</H3>
      <P>
        <strong>Menus &rarr; Allergens &amp; dietary</strong> has two lists.{' '}
        <strong>Allergens</strong> starts with the 14 allergens UK law says you must declare
        (celery, gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, nuts, peanuts,
        sesame, soya and sulphites), marked <strong>Standard</strong>. If any are missing, an
        amber bar offers to add them back. <strong>Dietary tags</strong> are the rest: vegan,
        gluten-free, spicy and so on. Tap a tag to change its label, badge text, code, colour
        or type, and drag the grips to change the order the badges show in (dietary tags come
        before allergens on the menu).
      </P>
      <P>
        A dish either has a dietary tag or not. An allergen has one of four settings for each
        dish: <strong>Contains</strong>, <strong>May contain</strong> (for example a risk of
        cross-contact), <strong>Can be removed</strong> (the dish has it but the kitchen can
        make it without), or no setting (the dish doesn&apos;t have it). On the website, the
        printed menu, the dietary list and online ordering the first three look the same, the
        allergen&apos;s badge, except that Can be removed adds a small asterisk, explained by the
        allergen notice (below).
      </P>
      <P>
        If you had your own tag for an allergen before, for example &ldquo;N&rdquo; for nuts,
        it was turned into that allergen, so dishes kept their badge. If you end up with two tags
        for the same thing, open the one you don&apos;t want and use <strong>Merge into another
        tag</strong>: every dish moves onto the tag you pick and the old one is deleted. Which
        badges a key under a menu lists is set in the allergen notice (below).
      </P>
      <P>
        <strong>Keeping a tag off menus.</strong> Open a tag and set <strong>On menus</strong> to{' '}
        <strong>Hide</strong> when guests don&apos;t need its badge, for example the Gluten allergen
        when your dishes already show a Gluten-free tag. A hidden tag is left off the website, printed
        menus and their keys, the dietary list and online ordering. You still set it on dishes as
        usual, and it still shows in the Allergen matrix, the allergen lookup and the menu editor,
        so staff can answer allergy questions. The list marks it <strong>Not on menus</strong>, and
        the matrix and dish panel show a crossed-out eye next to it.
      </P>
      <P>
        <strong>The allergen notice.</strong> The <strong>Allergen notice</strong> card at the bottom
        of the same page sets what guests read under your menus. One notice is used everywhere:
      </P>
      <DataTable
        head={['Setting', 'What it does']}
        rows={[
          ['Title and Text', 'Your own words, for example "Allergies & Diet" and "Please tell us about any allergies before you order." Leave the title blank for none.'],
          ['Tags in the key', 'Tap a badge to put it in the key under the notice, or take it out. All and None do a whole list at once. A tag hidden on menus is greyed out: it is never in the key.'],
          ['Which ticked tags a menu lists', 'Only the ones its dishes use (each menu lists just the ticked badges that appear on it), or All of them (every ticked badge, whatever the menu).'],
          ['Asterisk note', 'Explains the asterisk on a dish whose allergen can be removed, for example "Ask us to leave it out". Shown whenever a dish on the menu has one, so it can\'t be blank.'],
          ['Online ordering line', 'An extra line shown only on the online ordering page, followed by the venue\'s phone number when it has one. Leave it blank for none.'],
        ]}
      />
      <P>
        The preview shows the notice as guests will see it. Click <strong>Save notice</strong> to
        apply it, or <strong>Discard</strong> to go back. Where it shows:
      </P>
      <DataTable
        head={['Where', 'How']}
        rows={[
          ['Printed menus', 'Add an Allergies & Diet footer note to the menu (Footer callouts on the menu page). It prints the notice and its key; it no longer has words of its own. In the menu designer, the Footer notes block prints it the same way, and the Allergen key block prints only the key.'],
          ['Dietary list', 'At the bottom of the list. With "Only the ones its dishes use", the key follows the dishes you tick under Choose dishes.'],
          ['Website menu block', 'Under the menu, on by default. Untick "Show allergen notice" in the block settings to leave it off (the asterisk note still shows when a dish needs it).'],
          ['Online ordering', 'Under the menu, followed by the online ordering line.'],
        ]}
      />
      <InfoBox type="tip">
        Every reading here saves as part of the whole menu — click <strong>Save</strong> at
        the top of the page once you're done editing, same as any other admin form.
      </InfoBox>
      <H3>Printing</H3>
      <P>
        Every menu has a printable version at <strong>Open as printable PDF</strong> (also
        linked from the bottom of the menu block on your website) — no extra setup, it
        renders straight from the browser's print dialog. Columns, paper size and
        orientation are configurable per menu.
      </P>
      <P>
        <strong>Print layout.</strong> Under <strong>Settings</strong> on a menu you can also
        set the <strong>font size</strong> (80% to 130%), the <strong>page margins</strong>,
        what header later pages get (none, a one-line menu name, or the full header),
        whether the <strong>footer repeats</strong> on every page (allergen key, notes and
        footer line), <strong>page numbers</strong>, and <strong>Keep every section in one
        piece</strong>, and <strong>Variant options per row</strong> (1, 2 or 3): with 2 or 3, a
        dish's options such as Chicken, Prawns and Beef sit side by side with their prices,
        which saves space on long menus. In each section's panel (tap its heading), choose whether it continues
        after the previous section, <strong>starts in a new column</strong> or{' '}
        <strong>starts on a new page</strong>, and whether to keep that section in one piece.
      </P>
      <P>
        The print page shows each printed sheet separately and says at the top how many
        pages there are. If a page is too long for one sheet it is marked in red with how
        much too long it is. Fix it by starting a section on a new page, letting a long
        section split, or making the font smaller. Otherwise that page runs onto an extra
        sheet without its header and footer. The check needs a window wide enough to show
        the page at full size.
      </P>
      <P>
        Dietary tag colours, highlighted sections and house favourites keep their background
        colour on paper and in a saved PDF, even with the print dialog's &ldquo;Background
        graphics&rdquo; option off. The cream page background does not print, which saves ink.
      </P>
      <H3>Allergen matrix</H3>
      <P>
        <strong>Menus &rarr; Allergen matrix</strong> shows every dish of one menu as a row, the
        allergens as the first columns and the dietary tags after them. Pick the menu at the top
        and use the search box to find a dish by name. Tap an allergen box to step through{' '}
        <strong>Contains</strong> (the badge), <strong>May contain</strong> (the badge
        outlined on a pale background), <strong>Can be removed</strong> (the badge with an
        asterisk) and back to empty; the key above the table shows the three. Tap a dietary box
        to switch the tag on or off. Changed boxes get an amber outline, and
        nothing is stored until you tap <strong>Save</strong> (it says how many dishes you
        changed). <strong>Discard</strong> puts everything back. You can&apos;t switch menu while
        there are unsaved changes.
      </P>
      <H3>Publishing allergen changes on their own</H3>
      <P>
        Saving here changes the menu&apos;s draft, like the menu editor: guests, the website, tills,
        kiosks and menu screens keep showing the published menu until it is published again. To
        put allergens live straight away without publishing anything else, tick{' '}
        <strong>Publish allergen changes to all menus</strong> beside Save (the tick is
        remembered on that device). Save then says <strong>Save and publish</strong>, and after
        saving it publishes the allergens and dietary tags of every menu: the one you are on and
        any other menu with allergen changes saved earlier. Nothing else goes live: new prices,
        renamed dishes, new dishes and other changes waiting on those menus stay unpublished
        until you publish the menu from the Menus page. A green note says which menus were
        published and how many dishes changed.
      </P>
      <P>
        When allergen changes are saved but not live on some menus, an amber note above the table
        lists them, with a <strong>Publish allergen changes</strong> button that publishes them
        without anything else. A menu that has never been published has nothing live, so its
        allergens go live when the whole menu is first published (the note names it). If a menu
        has a publish scheduled for later, it gets the new allergens too, at the same time and
        with the rest of it unchanged, so the old allergens never come back when it goes live
        (its publishing history shows the earlier scheduled publish as cancelled and a copy marked
        &ldquo;allergens updated&rdquo;).
      </P>
      <P>
        The columns are your tags from Menus &rarr; Allergens &amp; dietary. A setting here is
        the same one the dish panel in the menu editor shows, and the same badge the dish shows
        on the website, the printed menu and the dietary list.
        Sections hidden on the website or everywhere still show here, marked as hidden. If the
        same menu is open in the menu editor, save one before changing the other, or the later
        save puts back the tags it loaded.
      </P>
      <H3>The Allergens page and who can look things up</H3>
      <P>
        <strong>Allergens</strong> (main menu, under Service) is the allergen lookup as a page of its own,
        over the menus guests are served. It has its own permission, <strong>Allergen lookup</strong>, in
        Modules &amp; Roles, so front-of-house staff can answer a guest&apos;s allergy question without
        access to Menus: every built-in role has it, and custom roles were given View. The same permission
        decides who sees the dashboard widget, the Overview tile, the phone&apos;s Allergens tile and
        Pepper&apos;s answers to allergy questions. Changing a dish&apos;s allergens stays on the Allergen
        matrix, which needs Menus.
      </P>
      <InfoBox type="tip">
        Add an <strong>Allergen lookup</strong> widget to an H&amp;S dashboard, or the Allergen
        lookup tile to the Overview, so front-of-house staff can answer allergy questions
        without editing anything. Press <strong>Allergens &amp; diet</strong> to open every tag
        as a grid: tap a tag once to list dishes that have it, twice to list dishes free from
        it, and a third time to clear it, then press <strong>Show dishes</strong>. The filters
        you picked stay under the search; tap one to remove it. Free from also lists dishes the
        allergen can be removed from, marked &ldquo;Ask for it without&rdquo; that allergen;
        dishes that may contain it are never listed as free from it. Sections hidden everywhere
        are left out of the lookup. Tap a dish to see its tags written out in full, grouped
        Contains, May contain, Can be removed and Dietary.
      </InfoBox>
      <P>
        On a phone, open the Ops app (<strong>/mobile</strong>) and tap{' '}
        <strong>Allergens</strong>. Pick the menu and search a dish; the menu and search box
        stay at the top while you scroll. Tap <strong>Filter by allergen or diet</strong> to open
        the tag buttons; once a filter is on, the button says which (for example
        &ldquo;Free from Milk&rdquo;). Tap a dish to see its description and every tag by name.
        The phone remembers the last menu you picked.
      </P>
      <H3>Dietary list</H3>
      <P>
        Tap <strong>Dietary list</strong> next to <strong>Print</strong> (on the menus list or at
        the top of a menu) for a simple sheet listing every dish in one column and its allergen
        and dietary badges, as icons only, in the second, grouped by section. A key under the
        list says what each icon used on it means, and what the asterisk means if a dish has an
        allergen that can be removed. It prints portrait on the menu's paper size and runs onto
        more pages when the menu is long. Sections set to hide everywhere are left out.
      </P>
      <P>
        To print only some dishes, tap <strong>Choose dishes</strong> at the top of the list,
        untick the dishes you don't want (tap a row or its tick box), then tap{' '}
        <strong>Done</strong>. <strong>Tick all</strong> and <strong>Untick all</strong> help with
        long menus. The top bar says how many dishes are in the list, a section with no ticked
        dishes is left out, and the key only shows icons that are used. Your choice is
        remembered on that device, and a dish added to the menu later is included until you
        untick it.
      </P>
      <H3>Designing the print yourself</H3>
      <P>
        For full control, open <strong>Menus → Menu print designer</strong>: it lists every menu
        with its designs, says which one prints, and opens the designer on the menu or design you
        tap (the search box finds a menu or a design by name). Or open a menu and tap{' '}
        <strong>Design print</strong> (save the menu first). The designer&apos;s back button goes
        to wherever you came from. Tap <strong>Start designing</strong>. Each page is a grid, and you place
        everything on it yourself: the menu header, section titles, whole sections, single
        dishes, text, images, lines, the footer notes, the allergen key and page numbers.
      </P>
      <DataTable
        head={['To', 'Do this']}
        rows={[
          ['Add something', 'Drag it from the list on the left onto a page, or tap + to add it to the page marked "adding here".'],
          ['Move it', 'Tap it to select it (blue outline), then drag (a mouse can drag straight away, photos included). It snaps to the grid, and can be dragged onto another page.'],
          ['Add a photo from your computer', 'Drag it onto a page: onto an image block to replace its picture, anywhere else to add an image block there. It goes into Media too.'],
          ['Resize it', 'Drag the blue corner of the selected block, or use the Across / Down / Width / Height buttons on the right.'],
          ['Make it the right height', 'Tap "Fit height to content". New blocks size themselves when you drop them.'],
          ['Place a whole section', 'Use "Title and dishes". Its dishes flow inside the block (choose 1 to 4 columns). A dish you place on its own is left out of it, so you can pull a dish out and put it somewhere else.'],
          ['Repeat a section heading', 'Add the section\'s "Section title" again on the next page, and type something like "(continued)" in "Text after the title".'],
          ['Repeat on every page', 'Select the block and tick "Show on every page", e.g. a header, footer or page number. Tick "Hide repeated blocks on this page" on a page (a cover, say) to leave them off it.'],
          ['Change paper, margins or the grid', 'Page setup at the top: A4 or A3, landscape or portrait, margins, 6 / 12 / 24 columns, row height and the text size for the whole menu.'],
          ['Design a folded menu', 'Page setup > Folded sheet: "Fold left | right" or "Fold top / bottom", and the gap at the fold (for example 10 mm). The page splits into two halves with a striped FOLD strip between them. Blocks snap to either side of the gap and new blocks are kept off it; a block can still stretch across both halves. Tick "Print a fold line" for a faint dashed line to fold along.'],
          ['Put variant options side by side', 'Page setup has "Variant options per row" (1, 2 or 3) for every dish. A dish block, or a section showing its dishes, can pick its own number or use the default.'],
          ['Change the fonts', 'Page setup > Fonts: one font for headings and prices, one for text, one for the handwritten lines (taglines, handwritten text). Any font from the website builder can be used. "Use website fonts" copies the headings and text fonts from the Brand & theme page; "Standard fonts" goes back to the usual three.'],
          ['Change the colours', 'Page setup > Colours: the text, the prices, lines and handwriting (the menu\'s own colour unless you pick one), and the descriptions. The paper stays cream. Make a theme fills in the fonts and colours from a picture and a few words (see Make a theme from a picture); Standard colours goes back.'],
          ['Choose which footer notes print', 'Select the Footer notes block and untick "Show all notes", then tick the notes you want in that spot. Put a second Footer notes block elsewhere to print the others there. With "Show all notes" ticked, notes you add to the menu later appear automatically; with your own pick, they don\'t until you tick them.'],
          ['Make another design for the same menu', 'Use the Designs bar under the top bar. "Copy" starts a new design from the one open (handy for an A3 poster and an A5 table card of the same menu); "New design" starts a blank one. Name it in the panel on the right (with nothing selected) and tap Save. Tap a design\'s name to open it; save or undo your changes first.'],
          ['Choose which design prints', 'Open the design and tap "Use this design for printing" in the panel on the right. The design used for printing has a Printing badge. "Use the automatic layout instead" goes back to the automatic layout.'],
          ['Give one block its own font', 'Select it and pick a font under Look > Font. Everything in that block uses it. "Use the menu fonts again" undoes it.'],
        ]}
      />
      <P>
        The list on the left shows every dish that is not on the page yet, so a dish you add to
        the menu later shows up there. The design stays linked to the menu: names, prices,
        descriptions and allergens always come from the menu, so editing a price there
        changes the print too. A red line along the bottom of a block means its text is cut
        off; an orange outline means two blocks overlap.
      </P>
      <P>
        A section set to <strong>Hide everywhere</strong> doesn't print and isn't listed on
        the left; a block you had already placed for it stays on the page with a note, and
        prints nothing.
      </P>
      <InfoBox type="info">
        Nothing changes until you tap <strong>Save</strong>. Your first saved design is used
        for printing: the menu's Print button and the <strong>Open as printable PDF</strong>{' '}
        link on your website both use it. Later designs are saved without changing what
        prints until you tap <strong>Use this design for printing</strong>. To delete a
        design, open it and use <strong>Delete this design</strong> at the bottom of the
        panel on the right; if it was the one used for printing, printing goes back to the
        automatic layout. The Print layout settings above only apply to the automatic layout.
      </InfoBox>
      <H3>Deliveroo menu file</H3>
      <P>
        <strong>Menus &rarr; Deliveroo menu</strong> updates the menu file Deliveroo gives you
        (the bulk-management CSV) from your menus here, so prices, VAT, descriptions,
        allergens and calories on Deliveroo match what you sell, without typing them into the
        spreadsheet by hand. Pick the venue at the top; each venue has its own settings and
        matches, because each Deliveroo site has its own file.
      </P>
      <DataTable
        head={['Step', 'What to do']}
        rows={[
          ['1. Get the file', 'In the Deliveroo Hub go to Menu, Menu Manager, Bulk management and download the menu file (a CSV). Keep that file: Deliveroo can\'t undo an upload.'],
          ['2. Open it here', 'Tap the box under Deliveroo file and choose the CSV, or drop it on the box. A copy you saved from Excel (.xlsx) works too. The file stays in this browser tab only.'],
          ['3. Check the settings', 'Under How the file is filled: which menus to match against, the price rule (menu price plus a %, rounded up or to the nearest 1p, 5p, 10p, 50p or £1), which columns to fill, and whether May contain and Can be removed allergens are listed. Tap Save settings.'],
          ['4. Review the items', 'Each Deliveroo item shows the dish it is filled from, its price now and after, and the other columns that change. Fix what needs it (see below).'],
          ['5. Save matches', 'Stores each item\'s dish, skips and your own values, so next time the same file (or a newer one) opens matched.'],
          ['6. Download', 'CSV for Deliveroo is the file to upload, in the Hub under Menu, Menu Manager, Bulk management. Excel, to edit gives the same rows as a spreadsheet you can change and open here again.'],
        ]}
      />
      <P>
        Each item is matched to a dish by name. The badge says how: <strong>Auto match</strong>{' '}
        (the names are the same, apart from things like &ldquo;Can&rdquo; or &ldquo;330ml&rdquo;
        or a name in brackets), <strong>Matched</strong> (you chose it, or it was saved),{' '}
        <strong>Check</strong> (close names; tap <strong>Use</strong> under it to take the closest,
        or <strong>Choose dish</strong> to pick another), <strong>Not matched</strong>,{' '}
        <strong>Left as is</strong> (you chose to leave it alone) and <strong>Dish gone</strong>{' '}
        (the saved dish was deleted from the menu). An item with no dish is left exactly as
        Deliveroo has it. Filter the list with <strong>Changes</strong>, <strong>To check</strong>{' '}
        and <strong>Problems</strong>, or search by name.
      </P>
      <DataTable
        head={['Column', 'Filled with']}
        rows={[
          ['Delivery price', 'The dish\'s menu price plus your %, rounded as set. A dish priced only by its options (e.g. Chicken, Prawn, Tofu) uses its cheapest option, and the review says which.'],
          ['VAT rate', 'The dish\'s tax for the order type picked under How the file is filled (Delivery to start with), and the revenue stream if you pick one: see Tax, Order Types & Streams. Deliveroo takes 0, 5, 12.5 or 20.'],
          ['Description', 'The dish description.'],
          ['Allergens', 'The dish\'s allergens, sent as Deliveroo\'s codes (see Allergen and dietary codes).'],
          ['Calories', 'The dish\'s calories (kcal).'],
          ['Name, In-store price, Dietary, Energy (kcal)', 'Off to start with; switch them on under Columns filled from the menu.'],
        ]}
      />
      <P>
        An empty value on your menu never clears what Deliveroo has: a dish with no description
        leaves Deliveroo&apos;s description in place. Columns this page doesn&apos;t fill (PLU,
        barcodes, nutrition, max quantity and so on) are written back exactly as they were, and
        the item ids, order and columns stay the same.
      </P>
      <P>
        Tap an item&apos;s name or its changes to open it. For each column you can use{' '}
        <strong>Our menu</strong>, keep <strong>Deliveroo&apos;s</strong> value, or{' '}
        <strong>Type it</strong>. <strong>Change prices shown</strong> raises or lowers the
        delivery price of every item in the list by a % (rounded) or sets one price for them
        all, for example search &ldquo;can&rdquo; and set the cans to £2.50. Typed values stay
        until you undo them, even if the menu changes.
      </P>
      <InfoBox type="warn">
        Deliveroo has its own allergen codes, and lists nuts one by one (nuts_cashew,
        nuts_almond and so on). Open <strong>Allergen and dietary codes</strong> to see what each
        of your tags is sent as. A dish with an allergen that has no code is a problem, and the
        CSV can&apos;t be downloaded until you give the allergen a code or keep Deliveroo&apos;s
        value for that dish: otherwise Deliveroo would show the dish without that allergen.
        Check a few dishes on Deliveroo after uploading, and keep your own allergen
        information up to date.
      </InfoBox>
      <P>
        Other problems are shown in red on the item (Deliveroo would refuse the file) or amber
        (worth a look, for example a price that changes by more than 30%). If Excel has turned
        an item id into a number like 1.23E+15, use the file Deliveroo gave you instead: the id
        can&apos;t be recovered.
      </P>
    </section>
  )
}
