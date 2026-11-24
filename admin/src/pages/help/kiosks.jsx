// src/pages/help/kiosks.jsx
// The Help page's "Self-order kiosks" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'kiosks'
export const label = 'Self-order kiosks'
export const order = 400

// ── SELF-ORDER KIOSKS ─────────────────────────────
export function Section() {
  return (
    <section id="kiosks" data-help="">
      <H2>Self-order kiosks</H2>
      <P>
        A kiosk is a big touch screen guests order on by themselves: they pick staying or going, choose
        dishes and their options, see the allergens, and pay by card or at the counter. The order goes to
        the kitchen, the tills' <strong>Counter</strong> list, Till reports and Cash Recon like any counter
        order, with the kiosk named as who took it. Use an upright or wide touch screen running Chrome
        (an Android kiosk or a Windows touch PC).
      </P>
      <InfoBox type="info">
        Card payments use a <strong>test card reader</strong> for now: the kiosk shows Approve and Decline
        buttons and no money is taken. Real card terminals connect here later. Until then, let guests pay
        at the counter (or offer both while you try it out).
      </InfoBox>

      <H3>Setting up (Store tech → Kiosks)</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Kiosk designs</strong> have their own page, Store tech → <strong>Kiosk designer</strong> (the Kiosks page has a card that opens it): <strong>New design</strong> opens the design editor (below). Designs are shared by every venue. A kiosk uses the design picked for it, or the first design. <strong>Copy</strong> makes a copy to try changes on; a design a kiosk uses can't be deleted.</li>
        <li><strong>Add a kiosk</strong>: its name, its <strong>revenue stream</strong> (the stream's order types are the kiosk's Staying or going? buttons, and the stream decides whether it asks for a name or a tent number), its design, its <strong>card machine</strong> (see Card machines; none = guests pay at the counter) and the receipt printer.</li>
        <li>On the screen, open the kiosk address (kiosk.macaroonie.com, shown on the tab) in Chrome: it shows a code. Type that code in the Add a kiosk window (or scan its QR code with a phone), and set the address as the kiosk browser's start page. For a screen guests can't leave, run Chrome in kiosk mode or use a kiosk browser (such as Fully Kiosk). <strong>New device</strong> on the kiosk's row moves it to another screen; the old one stops.</li>
      </ol>
      <P>
        A kiosk offers the menus of its revenue stream that are on now, by Menus &rarr; <strong>Menu times</strong>{' '}
        (the Kiosks column). A guest keeps the menus that were on when they started, so a dish doesn&apos;t go
        while they choose; the next guest gets the menus on then. Dishes on the home page, banners and
        &ldquo;Anything else?&rdquo; that are only on menus not on now are left out. With none of its menus on,
        the start screen says the kiosk isn&apos;t taking orders and when it starts again. Previews and shared
        preview links show every menu, whatever the time.
      </P>

      <H3>Screens of another shape or size</H3>
      <P>
        Each design is made for one screen: a Full HD kiosk (1080 x 1920) unless you pick another in the
        design&apos;s <strong>Screen</strong> card. A kiosk on a screen that isn&apos;t that shape or size still
        looks as designed:
      </P>
      <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
        <li><strong>Another shape</strong> (a 4:3 tablet, a phone, a screen with the browser&apos;s bars showing): the kiosk keeps the design&apos;s shape, as big as fits and centred, with bars at the sides or above and below. The bars are black, or the design&apos;s Page colour if you pick that. If you&apos;d rather the kiosk filled the screen, pick <strong>Fill the screen</strong>: its layout then stretches to the screen&apos;s shape. A screen only a few pixels off the shape gets no bars.</li>
        <li><strong>Another size</strong> (a phone or tablet, or a screen bigger than the design&apos;s): the kiosk is zoomed so it is laid out at the design&apos;s size, and looks the same, only smaller or bigger. You don&apos;t need Chrome&apos;s <em>Desktop site</em> setting for this, so turn it off if you switched it on (it changes every other site too). A difference under 10% is left as it is. Turning the screen keeps the same zoom.</li>
        <li>The zoom works in a phone&apos;s or tablet&apos;s browser (Chrome on Android, Safari on an iPad; in Fully Kiosk, keep its wide viewport setting on). A computer&apos;s browser (Chrome on a Windows kiosk) keeps its own size: there, set the screen&apos;s display scaling (Windows Settings, Display, Scale) so it is close to the design&apos;s size. The shape is kept everywhere.</li>
      </ul>
      <P>
        The kiosk&apos;s staff panel (five quick taps in the top-left corner of its start screen) shows, on its{' '}
        <strong>Screen</strong> line, the screen&apos;s size as the browser counts it, the design&apos;s, the zoom and
        where the bars are. In the design editor, <strong>Try on</strong> above the preview shows the design on a
        Full HD kiosk, a 16:10 or 4:3 tablet, or a phone, as that screen would show it.
      </P>

      <H3>The design editor</H3>
      <P>
        Settings are on the left in cards you open and close; on the right is the kiosk itself, showing
        your changes as you make them. Use it like the kiosk: nothing you order there is sent.{' '}
        <strong>Start screen</strong> and <strong>Menu</strong> jump to those screens, <strong>Upright</strong>{' '}
        and <strong>Wide</strong> turn the screen, <strong>Try on</strong> shows the design on another screen
        (see Screens of another shape or size above; the preview is the design&apos;s own screen otherwise), and
        the list next to them picks the revenue stream it orders as. Nothing is kept until <strong>Save</strong>; <strong>Discard</strong> goes back to the
        last save, and leaving with changes not saved asks first. On a phone, Settings and Preview take
        turns.
      </P>
      <P>
        <strong>Save as</strong> (beside Save) keeps what you see as a new design under a name you choose,
        and opens it. Changes you haven&apos;t saved go into the new design only: the design you started
        from stays as it was last saved, so the kiosks using it don&apos;t change. Use it to try another
        version (a summer look, say) without touching the one your kiosks show, then pick the new design
        for a kiosk in Store tech → Kiosks when it is ready. The new design isn&apos;t shared (a share link
        stays with the design it was made for). <strong>Copy</strong> on the Kiosk designer page (the
        list of designs) does the same from a saved design.
      </P>
      <InfoBox type="tip">
        The preview shows the menu as published, the same as the kiosks. A photo, price or dish you have saved
        on the Menus page but not published yet only shows once you pick <strong>Menu with unpublished
        changes</strong> in the list above the preview (or tap <strong>Show the changes</strong> in the note
        that names the menus with such changes). Option group pictures (flavours, sauces) show straight away
        either way. After changing a menu in another tab, tap <strong>Reload</strong> to see it.
      </InfoBox>
      <DataTable
        head={['Card', 'What you set']}
        rows={[
          ['Brand', 'Logo, colours (start from a set: Website colours (your website theme\'s), Fresh, Red and gold, Night, Ocean, Plain, then change any: each colour offers the website\'s colours as swatches, or a custom one), the bottom bar\'s and the side menu\'s own colours (see Bottom bar and side menu colours below), the fonts for headings and text, headings in capitals, rounded corners, and Text sizes: a slider each for Body text, Headings, Buttons and Prices, from 80% to 150% (buttons from 90%) in steps of 5, 100% being the kiosk\'s own size. Body text sets the size of everything else on the screen (dishes, choices, the order); headings, buttons and prices each have their own on top. The preview follows as you move them; nothing changes on the kiosks until Save. All back to 100% puts them back. Colours that are hard to read together are pointed out. Make a theme (at the top) fills all of these from a picture and a few words (see Website Builder, Make a theme from a picture).'],
          ['Layout', 'The bar along the top (logo and language) on or off. Back and Start again with their words, or icons only. How pictures are drawn is set apart for dishes (Menu card) and for choices (Choices card). Top of a dish\'s page: the photo beside the words, or Photo on top, with the photo lined up left, centre or right and the name, description, price and allergens under it lined up left, centre or right (on a wide screen the photo is always above the words in its own column, and only the words\' line-up applies). A meal deal\'s pages follow it too: the deal\'s picture and words on its steps, and a picked dish\'s own photo and words on its options page. Shade behind the dish\'s photo (on unless you turn it off): a quiet shade behind the dish\'s photo on its page and in the order, so cut-out pictures (PNGs on a see-through background) sit on the same background whether one pick shows or several share the photo; off, the page\'s own background, even behind a split photo (a No frame photo gets the design\'s rounded corners while the shade shows). Build a meal deal\'s picture from the picks (on unless you turn it off): see A meal deal\'s picture below. The picture flies into the order (on unless you turn it off): see Adding to the order below.'],
          ['Screen', 'The screen the design is made for: Full HD kiosk (1080 x 1920), HD, a 16:10 or 4:3 tablet, QHD, 4K, or another size you type in (its width and height upright, in the pixels its browser counts: a phone or tablet reports fewer than it has, often half). The preview shows the design at this size. On a screen of another shape: Keep this shape (bars around the kiosk, black or the Page colour) or Fill the screen. See Screens of another shape or size above.'],
          ['Start screen', 'Pictures apart from the buttons or behind them; pictures and videos taking turns (drag to order, up to 8), each with a Fit (see Fitting pictures below); the headline and the question; each order type\'s words, icon or picture; the Allergens button.'],
          ['Languages', 'The language your menu is written in, and the languages guests can pick (flags on the start screen).'],
          ['Menu', 'Dish pictures: how the menu\'s dishes, the section tiles, the dish\'s own photo and the basket are drawn: Cards (photo on a card), Round or Oval (the photo in a circle or an ellipse, the words under it, no card), Hexagons (they lock together like a honeycomb, and buttons, chips and cards across the kiosk take the hexagon look too), or No frame (the whole picture as it is, straight on the page: no card, corners or shadow; best with PNGs on a see-through background, such as cut-out food photos). A home page with banners (pictures or videos: see Video banners below) and featured tiles (each can open a section or a dish, and each has a Fit for its picture: see Fitting pictures below), the banners\' shape (Wide, Short, Tall, the picture\'s own or a width and height you set); sections down the side with pictures or words only, or none (the menu opens on a page of section tiles: drag them into order, give each a picture, words and a width); dishes per row; descriptions, calories, dietary badges and quick add; sections left off the kiosk.'],
          ['Choices', 'How choices show where an option group or combo step doesn\'t pick its own: grid, list, slider or spin wheel. Choice pictures, set apart from the dishes\': Cards, Round, Oval, Hexagons or No frame (the whole picture with nothing behind it, the list and wheel thumbs too; a picked one glows in the button colour round its outline, with its name in that colour and the tick). Hexagon choices in a grid lock together like a honeycomb even when there are only a few (three make two over one, four make two over two); the list, slider and wheel show hexagon photos. Words only leaves the pictures out: each choice shows its name, level and price in the shape you picked (a card also shows the description), so hexagons become hexagons of words; the list and the wheel leave their small pictures out too, and a split photo still uses the pictures. Line up the choices: a grid or honeycomb of choices, with its heading, from the left or centred on the screen. When the choices appear: Just there, Fade in, Slide in from the side, Bubble up or Deal like cards; one after another each time a dish\'s page or a combo step opens (grids, honeycombs, lists and the slider; the wheel comes in whole; nothing moves for guests whose device asks for less motion). Picks on the dish\'s photo (for groups and steps with Split photo on): Split photo, or Small in the corner (see below). Option groups with their own look: groups this design shows another way (how they show, picture style, words only, how they come in); see How choices show below. The spin wheel\'s Spin button, and whether a spin picks the choice it stops on. The marks for levels: flames, stars or dots.'],
          ['Paying', 'By card, at the counter (and whether the kitchen starts on a pay-at-counter order straight away or once it\'s paid), the note on the order done screen for orders paid at the counter, "Anything else?" dishes before paying, the number to type (a tent number, the usual, or a table number).'],
          ['Order done', 'The screen after paying: its heading, what shows big and the lines under it, for every order type or one type its own way, a message, the receipts on offer (printed, a QR code, by email) and how long it shows. See The order done screen and receipts below.'],
          ['Timing and access', 'When the kiosk starts again if nobody taps, how long "Still there?" waits, and the reach button, with optional pictures or videos (up to 4, taking turns like the start screen\'s) to fill the top of the screen while everything is brought down; without them the space shows your brand colour and the reach sign.'],
        ]}
      />
      <InfoBox type="tip">
        Words you leave empty use the kiosk's own words, which come in all nine languages. Words you type
        show as typed: translate them on <strong>Menus → Translations</strong>.
      </InfoBox>

      <H3>The order done screen and receipts</H3>
      <P>
        After paying, the kiosk shows a big number guests keep an eye on, and a few lines under it. You
        design that screen in the design editor&apos;s <strong>Order done</strong> card, the same for every
        order type or each order type its own way (an eat-in order with a tent, a takeaway called by
        name).
      </P>
      <ul className="list-disc ml-5 space-y-1 text-sm text-muted-foreground mb-4">
        <li><strong>Big on the screen</strong>: <em>Automatic</em> (the usual) shows the <strong>tent number</strong> when the guest typed one (a tent they took from the stand and put on their table), and the order number when they didn&apos;t. Or always the order number, the tent (or table) number, or the customer&apos;s name. An order that hasn&apos;t got the one you picked (the name wasn&apos;t asked, the tent was skipped) shows its order number instead.</li>
        <li><strong>Under it</strong>: tap the small lines to show, in this order: Order number, Tent number (or Table number), Customer name, Order type. The big one isn&apos;t repeated, and a line the order hasn&apos;t got is left out. With a tent big, the screen also says to put it on the table; with tents, the &ldquo;we&apos;ll call your number&rdquo; line isn&apos;t shown (the food comes to the table).</li>
        <li><strong>Message</strong>: words of your own under the rest, e.g. where to collect a takeaway. Translate them on Menus → Translations.</li>
        <li><strong>Each order type</strong>: every order type the preview&apos;s revenue stream offers is listed with what that stream asks its guests (a name, a tent or table number: not asked, asked, or must be given; set in Store tech → Revenue streams). When the screen would show something the type&apos;s guests are never asked for, an amber note says so (the name, say, for a type that doesn&apos;t ask for one), and what shows instead. Turn on <strong>Its own way</strong> to give a type its own big value, lines or message; anything left <em>As for every type</em> follows the settings above it. <strong>Show</strong> puts an example order of that type on the preview (a name and a tent only where the type asks for them) and keeps it there while you change things; <strong>Order done</strong> above the preview does the same for the first type.</li>
        <li><strong>Receipts</strong>: printed on the kiosk&apos;s receipt printer (none, the guest can print one, or always); a <strong>QR code</strong> the guest scans with their phone to see the receipt; and <strong>Email the receipt</strong>, where the guest types their email address on the kiosk&apos;s keyboard. Paid by card, the receipt goes straight away; paying at the counter, it goes as soon as the till takes payment (the kiosk tells the guest so).</li>
        <li><strong>Shows for</strong>: how long the screen stays before the start screen comes back (5 to 120 seconds). It waits while a guest types an email address.</li>
      </ul>
      <P>
        The receipt page (the QR code&apos;s link) shows the order as the kiosk receipt design prints it
        (picked in Store tech → Printing, made in Store tech → Receipt &amp; ticket designer), with a button to print it or save it as a PDF. It works for a year. An order
        paid at the counter shows as a bill marked &ldquo;Not paid yet&rdquo; until it is paid at the till,
        then as the receipt. Emails are sent through the location&apos;s own email settings (Emails →
        Settings), up to three times an order. The email address isn&apos;t kept: the kiosk shows it back
        as its first letter and its domain (s***@gmail.com), and that&apos;s all that is noted. Nothing a guest
        types is recorded with their visit for Kiosk analytics either.
      </P>
      <P>
        For an order paid at the counter, the address is held locked away (encrypted) only until the till
        takes payment, and the receipt goes within a minute of that; then the address is forgotten like any
        other. Nothing is sent, and the address is dropped, if the order is cancelled at the till (every dish
        taken off), if nobody pays it within a day, or if the location&apos;s email provider keeps refusing it
        (it is tried a few times, a few minutes apart). An unpaid bill is never emailed.
      </P>

      <H3>Bottom bar and side menu colours</H3>
      <P>
        The bar along the bottom (Start again, the order&apos;s total, View order, and Back where a screen has
        one) and the sections down the side of the menu have colours of their own in the design&apos;s
        <strong> Brand</strong> card, under the main colours: <strong>Bottom bar</strong>,
        <strong> Bottom bar text</strong>, <strong>Side menu</strong> and <strong>Side menu text</strong>.
        Until you set them they follow the colours above, as before: the bottom bar in the Text colour and the
        side menu in the Cards colour. Their words say <em>Automatic</em> until you set them: whichever of the
        Page and Text colours reads better on that bar, so picking a bar colour on its own is enough. Each
        colour box shows the colour in use; <strong>Reset</strong> (or clearing the code) makes a colour follow
        again. The preview changes as you go; Save keeps it.
      </P>
      <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 mb-4 space-y-1">
        <li>The bottom bar colour is on every bottom bar: the menu, the order, the name and table number, paying and the allergens screen. A dish&apos;s own page keeps its bar in the Cards colour.</li>
        <li>Back on a bottom bar is solid in the bar&apos;s words colour with the bar&apos;s colour for its words; Start again and the other buttons on the bar are outlined in the words colour. View order keeps the Highlights colour.</li>
        <li>The section picked down the side gets a tint of the Buttons colour on the side menu&apos;s own colour.</li>
        <li>A pair that is hard to read (red words on a red bar, say) is pointed out under the colours.</li>
        <li>Picking a colour set (Fresh, Night and the others) or a theme from the theme maker starts the bottom bar and side menu colours over: they follow the new colours.</li>
        <li>A design without a side menu (Menu card, Sections down the side: None) keeps its side menu colours but doesn&apos;t show them.</li>
      </ul>

      <H3>Fitting pictures: banners, featured tiles, start and reach pictures</H3>
      <P>
        Every home page banner and featured tile picture, every start screen picture or video and every reach
        picture has a <strong>Fit</strong> under it in the design editor. It says how the picture fills its
        space. Tap it to open the choices; the preview changes as you go, and Save keeps it.
      </P>
      <DataTable
        head={['Fit', 'What it does']}
        rows={[
          ['Automatic (the usual)', 'A photo fills the space; a picture with a see-through background (a cut-out PNG logo) shows whole, nothing cropped.'],
          ['Fill', 'Fills the space and crops what doesn\'t fit. Keep in view picks the part that must show: the top of a photo, its bottom right corner and so on.'],
          ['Whole picture', 'Shows all of it, nothing cropped. Place it picks where it sits (a corner, a side or the middle), Size how big it is (30 to 100% of the space) and Behind it the colour round it: none (the page shows through), or the design\'s Cards, Brand, Highlights or Text colour.'],
        ]}
      />
      <P>
        <strong>Banner shape</strong> (Menu card, once there is a banner) sets the shape of every banner:
        Wide (16 by 7, as before), Short (3 by 1, so more of the menu shows below), Tall (16 by 9),
        <strong> Picture&apos;s own shape</strong> (each banner as wide and high as its own picture or video, so a
        logo or a poster fits without cropping; banners of different shapes change height as they take
        turns) or <strong>Set your own</strong>: type the width and the height, any two whole numbers, such as
        4 by 1 for a thin strip or a picture&apos;s size in pixels (1920 by 600). A sketch beside them shows the
        shape. A banner can&apos;t be taller than it is wide (that shows square) or thinner than 10 by 1 (that
        shows as 10 by 1); the editor says so under the numbers. A banner is never more than about a third of the
        screen high, so on a wide kiosk the banner is often that height whatever its shape, and the Fit decides
        how the picture sits in it.
      </P>
      <InfoBox type="tip">
        A logo cut short at the bottom of a banner: pick <strong>Whole picture</strong>, or
        <strong> Picture&apos;s own shape</strong> for the banner, and a colour behind it if the logo&apos;s
        background is see-through.
      </InfoBox>

      <H3>Video banners</H3>
      <P>
        A home page banner can be a picture or a video. In the design editor (Menu card, Banners) pick
        <strong> Picture</strong> or <strong>Video</strong> on the banner, then <strong>Pick a video</strong> from
        Media (MP4 is the safe choice). A video banner can also have a <strong>still picture</strong>: it shows
        while the video starts, and in its place when the video can&apos;t play (for example on a kiosk that has
        been offline since the video was added). The words over the banner, where it opens and its Fit work as for
        a picture.
      </P>
      <ul className="list-disc pl-5 space-y-1 text-sm mb-3">
        <li>A video banner plays to its end with no sound, then the next banner shows. A picture banner shows for the seconds set under the banners (3 to 20).</li>
        <li>A video that is the only banner plays on a loop.</li>
        <li>A video that can&apos;t play shows its still picture for the seconds a picture gets, then the next banner.</li>
        <li>The kiosk keeps banner videos like the start screen&apos;s, so once saved they play without the internet. A long video holds the other banners back until it ends, so keep banner videos short.</li>
        <li>A video banner linked to a dish with nothing to pick adds it to the order when tapped, like a picture banner, and the frame the video is showing flies into the order.</li>
        <li>A video banner with no video picked isn&apos;t shown on the kiosk or saved (the editor says so).</li>
      </ul>

      <H3>Dishes with no price</H3>
      <P>
        The kiosk leaves off its menu any dish it can't price: one with no price of its own and no option with a
        price to choose (for example 12 Wings with the price left empty and flavours that don't cost anything).
        The design editor says which dishes those are, above the preview. Set a price on the Menus page and
        publish the menu to put them on the kiosk. A dish like that can still be part of a meal deal, which has
        its own price. If a banner, featured tile or "Anything else?" still points at one, its page says it can't
        be ordered on the kiosk and asks the guest to order at the counter.
      </P>

      <H3>Sharing a preview</H3>
      <P>
        <strong>Share</strong> in the design editor's top bar makes a link to this design that anyone can open,
        with no sign-in: send it to a brand team, a franchise partner or a designer. It opens the kiosk at the
        size of the screen the design is made for, scaled to fit their screen, with <strong>Upright</strong>, <strong>Wide</strong>,{' '}
        <strong>Start again</strong> and <strong>Full screen</strong> (for trying it on a tablet). They see the
        design as saved, with the menu and prices of the location you pick (and, where a location has more than
        one, the revenue stream it orders as). Nothing is ordered or paid. The page around the kiosk says so
        (as the design editor does above its preview); opened on its own with Full screen, a thin dark band
        along the top of the kiosk says <em>Preview: orders aren&apos;t sent</em>, with the kiosk just below it,
        so it never covers a price or a button.
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Copy link</strong>, <strong>Open</strong>, or the QR code for someone holding a phone or tablet. The dialog shows how many times the link was opened.</li>
        <li>Each design has one link. Saving the design updates what the link shows; changes you haven't saved aren't in it.</li>
        <li><strong>Menu</strong>: the published menu (what the kiosks show), or the menu with unpublished changes, to show a new menu before it goes live. The changes show on the link as soon as they are saved on the Menus page, unfinished ones too, and the page tells whoever opens it that it includes changes not published yet.</li>
        <li><strong>Works until</strong> gives the link an end date (leave it empty for none). <strong>New link</strong> stops the old one for everyone and makes another; <strong>Stop sharing</strong> stops it.</li>
        <li>Making, moving and stopping a link needs Manage on Store tech. Shared designs are marked <strong>Preview shared</strong> in Store tech → Kiosk designer.</li>
      </ul>

      <H3>How choices show (Menus)</H3>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Display name</strong> (Menus → Variant groups, open a group): what guests see as the group's heading (kiosks, online ordering, the website, printed menus, menu screens) and the tills, such as Choose your flavours for a group you call Flavour x2 (copy). Empty: the group name. The group name stays for telling groups apart on the Menus pages. A dish's group headings change once its menu is published; translate the display name on Menus → Translations.</li>
        <li><strong>Menus → Variant groups</strong>, open a group, <strong>Self-order kiosk</strong>: how its options show (grid, list, slider, spin wheel, or as the design says) and the words at the two ends of a scale (No spice ... Very spicy).</li>
        <li>A group can have its own look on every kiosk there too: <strong>Picture style</strong> (Cards, Round, Oval, Hexagons, No frame), <strong>Pictures or words</strong> (With pictures, Words only) and <strong>When the options appear</strong> (Just there, Fade in, Slide in from the side, Bubble up, Deal like cards). Each is <strong>As the kiosk design says</strong> until you pick one, so the flavours can come in as a honeycomb that bubbles up while the dips stay small round pictures. It works straight away (no publishing), and a small picture of a pick in the corner of the dish's photo takes the group's picture style too.</li>
        <li>A kiosk design can change that again for its own kiosks: <strong>Choices → Option groups with their own look</strong> in the kiosk design (Store tech → Kiosk designer, edit a design). <strong>Add an option group</strong>, then for each: <strong>Shown as</strong>, <strong>Pictures</strong>, <strong>Words</strong> and <strong>Coming in</strong>. Each starts on its default, which says what the guest gets without it: <strong>Group: ...</strong> when the group picked one, else <strong>Design: ...</strong> (the design's settings for every choice). Pick another and the design shows the group that way, whatever the group says; the cross takes the group off the list. So the order is: the design's look for the group, then the group's own, then the design's for every choice, each part on its own. Combo steps aren't option groups: they keep the design's look (and their own Shown as).</li>
        <li>Each option can have two <strong>pictures</strong> (tap a square, or drop a picture on it): <strong>Tile</strong>, shown on the choice itself (a cut-out PNG works well), and <strong>On dish</strong>, shown on or in place of the dish's photo when the group has Split photo on (for example the wings made in that flavour). An option with no On dish picture uses its Tile picture there. Each option can also have a <strong>line of words</strong> under its name, and a <strong>level</strong> from 0 to 5 (shown as flames, and as the slider's scale). Drag options by their grip to change their order.</li>
        <li>A combo's steps (<strong>Edit steps</strong>) each have <strong>On a kiosk, the choices show as</strong>. A new choice typed in for a combo can have a picture and words too; a dish shows its own photo and description.</li>
        <li><strong>Picks on the dish's photo</strong> (on each variant group, and on each combo step): <strong>No</strong>, <strong>Split the photo</strong> or <strong>Small in the corner</strong>. The picks' pictures show on the dish's photo as the guest picks, on the dish page and on the order line. Each group decides, so 10 Wings can split its photo between the two flavours picked and show the dip small in the corner. <strong>Split the photo</strong>: one pick's picture takes the photo's place; two or more show side by side with a torn edge between them (three picks show the left third of the first picture, the middle of the second and the right third of the third). <strong>Small in the corner</strong>: each pick's picture small in the photo's bottom corner, on top of the photo (split or not), in the choices' picture style. <strong>Size in the corner</strong> (under it) sets how big: <strong>Automatic</strong> (about a quarter of the photo's width, smaller when several picks share the corner) or <strong>Set a size</strong>, from 10% to 70% of the photo's width with the slider or the - and + buttons; the small sketch shows the photo with the picture at that size. Each group and step has its own size, so the dip can be small while the drink is bigger; when the pictures don't fit side by side they shrink together. It uses each option's <strong>On dish</strong> picture (its Tile picture when it has none); on a combo step, each choice's <strong>On meal</strong> picture (else a typed-in choice's Tile picture, or a dish's own photo). Give every option an On dish picture of the same dish made that way, taken the same way, so the parts line up. A variant group's setting and pictures work straight away; a combo step's need the menu published.</li>
        <li><strong>Pictures with a see-through background</strong> (a PNG or WebP of a cut-out dip pot, burger or bottle): the kiosk notices the see-through parts by itself and shows the picture whole, with nothing behind it, wherever it appears (dishes, choices, section tiles, the rail, the bundle's picked steps). In the dish photo's corner such a pick has no round badge or ring round it, just a soft shadow under its outline, so it looks as if it sits on the photo. Pictures without see-through parts (photos, JPEGs) keep the frame, the background and the badge. Nothing to switch on: save the picture with a transparent background.</li>
      </ul>

      <H3>What guests see</H3>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>The start screen: flags for the languages, Staying or going? (or Start your order with one order type), and the Allergens button (see below).</li>
        <li>The menu: sections down the side (or a page of section tiles), the home page, dishes as cards, round or oval photos, or hexagons (choices can have a different style from the dishes). A dish with nothing to choose can be added with its + straight away.</li>
        <li>Back is always a solid button at the bottom left, beside the main button (Add, Continue, Checkout), never at the top. In a combo it goes one step back, and out of the combo from its first step. On the order page it is Add more. In a section opened from the tiles page it goes back to the tiles.</li>
        <li>Start again sits in the bottom bar after Back (on the menu, the order page, the name and tent number, and How to pay), and asks first when the order has something in it. With the bar along the top off, the language button is in the bottom bar too.</li>
        <li>A dish: its choices shown the way you set; the Add button points at anything still to choose. A combo goes step by step, with its allergens shown for what was picked: each step's name sits right above its choices (the name says what to pick, so there is no Choose 1 line; a step taking more than one shows 1/2 beside it), <strong>Step 2 of 5</strong> shows beside Continue at the button's size, and the steps along the top (down the side on a wide screen) show each done step's pick as its picture with its name under it. Every page of a deal has the big picture a dish's page has, as <strong>Top of a dish's page</strong> says: the deal's picture (see A meal deal's picture) and words on its steps and last page, and on a picked dish's own options page that dish's photo, description, calories and allergens with <em>In Burger meal</em> under its name; on a wide screen it is the column down the side, above the steps. The running price shows once: in the bar along the top, or with the bar off in the deal's picture block (above a picked dish's page as a line with the deal's name).</li>
        <li><strong>A meal deal's picture</strong> (Layout: <strong>Build a meal deal's picture from the picks</strong>, on unless you turn it off): until the first pick, the deal's own photo; then the picture is put together from the picks, like a photo of the meal. The first step's pick stands big in the middle (wings, split by their flavours once picked) and stays there, and the other steps' picks stand beside it in the order picked: the first on the left, the second on the right, the third further left, the fourth further right, each smaller and a little further back. Steps set to <em>Small in the corner</em> (dips, sauces) stand in front of it, in the order picked. Each new pick pops in and the others slide over to make room. On a picked dish's own options page (its flavours) the big picture is that dish; when it's done, the meal's picture comes back with the dish popping in with its flavours. A choice's picture for the meal (On meal in the combo editor) is used when it has one, else the dish's photo or the typed-in choice's own picture; a choice with no picture is left out. Cut-out pictures (PNGs on a see-through background) look best: they stand in the picture as they are, while ordinary photos get a small frame. The order shows the meal the same way. On a wide screen the picture stays at the top of the side column while the steps scroll under it. Turned off: the deal's own photo, with each step's picks on it as the step says.</li>
        <li><strong>Adding to the order</strong> (Layout: <strong>The picture flies into the order</strong>, on unless you turn it off): when a guest taps Add to order, the dish&apos;s big picture (a meal deal&apos;s picture as it was put together) zooms out and flies into the order button at the bottom, which bounces as it lands. The same happens with + on the menu and with a dish added from "Anything else?" on the order page (it flies into Checkout). Changing a dish from the order (Update order) doesn&apos;t fly. Turned off, or on a screen set to reduce motion, the order button only bounces.</li>
        <li>The order page: change or take off dishes, "Anything else?", then the name or tent number if the stream asks, then pay. The order number shows at the end (with a receipt to print if you allow it).</li>
        <li><strong>Tents</strong>: keep numbered tents (table stands) on a stand beside the kiosk or till. For an order type whose revenue stream asks for a tent, the kiosk says "Your tent number" and "Take a numbered tent from the stand", and the order number screen says "Put tent 12 on your table: we'll bring your order to you." The tent number goes to the kitchen screens, kitchen tickets and the order ready board. If your guests sit down first and type the number on their table instead, set <strong>Number to type</strong> to <em>Table number</em> in the design's Paying panel.</li>
        <li>Nobody tapping for a while: "Still there?", then the kiosk starts again. The reach button brings everything down to the lower half of the screen; the top shows the design's reach pictures or videos if it has any, with a button at their foot to move the screen back up. A dish marked sold out on the till greys out on the kiosk straight away.</li>
        <li><strong>Paying by card</strong>: the kiosk sends the order&apos;s total to its card machine and waits ("Follow the instructions on the card reader"). Once the machine approves, the order goes to the till and the kitchen. Declined: Try again, or pay at the counter if the design allows it. Back from the card step cancels the payment on the machine. On a test card machine (and in previews) Approve and Decline buttons stand in for the card.</li>
        <li>Without the internet the kiosk stops taking new orders. A card order already paid when the internet goes is kept on the kiosk and sent when it's back; the guest gets the order number straight away (the kiosk numbers its own orders) to show at the counter.</li>
        <li>The kiosk notices a lost connection within seconds (within about half a minute when the shop's router loses the internet but the Wi-Fi stays up). It tries twice more straight away, so a short blip doesn't pause ordering; only then does the start screen say ordering is paused. It then tries every few seconds and opens ordering again as soon as it gets through.</li>
        <li>Every picture on the menu (dishes, sections, choices, banners, the logo) is kept on the kiosk after each menu change, and so are the design&apos;s videos (start screen, reach band and home page banners), so the kiosk opens with its menu, pictures and videos straight away and a guest already ordering when the internet goes still sees them all. A video the design stops playing is deleted from the kiosk.</li>
        <li>The kiosk checks for prices and sold out dishes every 30 seconds and for the whole menu and design every 3 minutes (Store tech, Device updates, can change both), as well as hearing about changes straight away (see Keeping tablets up to date in Android app).</li>
        <li>The staff panel (five quick taps in the top-left corner of the start screen) shows the connection (Online, Checking or Offline), how many of the menu&apos;s pictures and the design&apos;s videos are saved on the kiosk, and when it last checked prices and sold out and the whole menu.</li>
      </ul>

      <H3>Allergens and diets on the kiosk</H3>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>The <strong>Allergens</strong> button on the start screen (switch it off in the design's Start screen panel) opens a screen with your allergen notice at the top, then <strong>Allergens to avoid</strong> (the 14, plus any of your own) and <strong>Dietary choices</strong> (the diets your kiosk's dishes carry, such as Vegan) as big tick boxes. The notice's words are the ones on <strong>Menus → Allergens &amp; dietary</strong> (Allergen notice card), in the guest's language from Menus → Translations.</li>
        <li>As the guest ticks, the screen says how many dishes suit them: "12 of 40 dishes suit you" (sold out dishes aren't counted), or that none do and to ask your staff. It doesn't list the dishes.</li>
        <li><strong>See the menu</strong> asks Staying or going? when there is more than one order type, then opens the menu with the picks kept for the whole order. Start again (or the kiosk timing out) clears them.</li>
        <li>On the menu, a strip at the top says what is being marked and how many dishes suit, with <strong>Change</strong> back to the allergens screen. A dish to check gets a yellow <strong>!</strong> mark (and a yellow edge on cards), with why under its name and the guest's allergens highlighted: <em>Contains: Milk</em>, <em>May contain: Nuts</em>, <em>Can be removed: Eggs</em> (it still suits: the guest asks for it without), <em>Not marked: Vegan</em>. Dishes that suit have no mark. On hexagons only the mark shows.</li>
        <li>A meal deal suits when every step the guest must pick from has a choice that suits (a choice you typed in for the combo has no allergens listed, so it never counts as vegan). If it suits but some of its choices have the allergens, it says <em>Some choices contain: Milk</em>, and inside the deal each choice to check carries the same mark and words.</li>
        <li>On a dish's page the guest's allergens are highlighted in the allergen line, with a yellow box saying what to check.</li>
        <li>This only reads the allergens and diets set on your dishes (Menus, Allergen matrix): a dish with none set counts as having none. Guests with an allergy are still told to speak to your staff.</li>
      </ul>

      <H3>Translations (Menus → Translations)</H3>
      <P>
        Every word a kiosk can show is listed by group (sections, dishes, combos, options, order types,
        allergens, the allergen notice, words typed in kiosk designs, the kiosk's own words) next to its
        translation in the language you pick. Type and press <strong>Save</strong>; empty a box to take a
        translation off. The kiosk's own words and the 14 allergens already come in every language (shown
        faintly in the box); type only to change them. <strong>Suggest the missing ones</strong> asks
        the AI for a first draft of everything missing: suggestions are marked <strong>Check</strong>,
        and nothing is kept until you Save.
      </P>
      <P>
        Kiosk orders show in Till reports with the kiosk's name as the server. How guests use the kiosk
        (what they look at, where they give up, every visit played back) is on <strong>Kiosk analytics</strong>{' '}
        (next section).
      </P>
    </section>
  )
}
