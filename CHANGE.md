# Macaroonie — Change Log

All notable changes to this project, most recent first.
Migrations are listed where a database change is required.

---

## [2026-10-26 — Kiosk designs: fit each picture to its space]

- Store tech → Kiosks → a design: every home page banner, featured tile picture, start screen picture or video and reach picture has a **Fit** under it. **Automatic** (as before): a photo fills the space and a picture with a see-through background (a cut-out PNG logo) shows whole. **Fill**: fills the space, cropped, with the part you pick kept in view (the top, the bottom right corner and so on). **Whole picture**: nothing cropped, placed where you pick, at a size from 30 to 100% of the space, with the design's Cards, Brand, Highlights or Text colour behind it, or nothing.
- **Banner shape** (Menu card): Wide (16 by 7, as before), Short (3 by 1), Tall (16 by 9) or the picture's own shape, so a logo or poster banner fits without cropping. A banner is still never more than about a third of the screen high, so on a wide kiosk that cap usually sets its height.
- The preview follows as you go; Save keeps it. Designs saved before keep their look.
- No migration.

## [2026-10-26 — Kitchen screens: your own ticket colours, dish names by section, a packing check at the pass]

- Store tech → Kitchen screens → **Ticket colours**: pick the background of a dish row when it is To do, Ticked off, On its way, Held and Voided; of a ticket's top for an order being made, New, Rush, Prepared and All ticked off; and the timer's amber and late colours. A colour not set keeps today's look; words turn black or white by themselves to stay readable. A preview ticket beside the list shows your colours; Save changes every kitchen screen of the venue at once.
- **Dish names by section**: pick a menu section (Drinks, Sides...) and a colour, and those dishes' names show in it on the kitchen screens (a meal deal's parts in their own section's colour). Sections go by name, so one colour covers that section in every menu.
- **The pass ticks dishes off**: at the expo (the pass) and runners, tapping a dish now ticks it off as a packing check instead of sending it on. The ticket says how many are ticked and, once every dish is, shows CHECKED with the All ticked off top, and stays until READY (DONE at a runner). Tap again to untick. Ticking off a dish still at an earlier station counts it done there. Prep stations work as before.
- **Bump when every dish is ticked**: a station setting (Edit station → Ticking off dishes) for an expo or runner where the last tick should send the order on, as READY would.
- A tick goes when the dish is remade, or when the station before takes it back (undone or brought back with Prev); READY then Prev at the pass keeps the ticks.
- A new location copies the template location's ticket colours.
- Migration 207 (`pos_settings.kds_colours`).

## [2026-10-25 — Kiosk designs: bottom bar and side menu colours]

- Store tech → Kiosks → a design → Brand: **Bottom bar and side menu**, under the main colours: **Bottom bar**, **Bottom bar text**, **Side menu** and **Side menu text**. Until you set them the kiosk looks as before (the bar in the Text colour, the sections down the side in the Cards colour). Words left on **Automatic** take whichever of the Page and Text colours reads better, so a bar colour on its own stays readable. Each colour box shows the colour in use; Reset makes a colour follow again. The preview follows as you go; Save keeps it.
- The bottom bar colour is on every bottom bar (the menu, the order, the name and table number, paying, the allergens screen); Back, Start again and the other buttons on it follow its colours, View order keeps the Highlights colour. A dish's own page keeps its bar in the Cards colour. The section picked down the side is tinted on the side menu's own colour.
- A hard-to-read pair (red words on a red bar) is pointed out. Picking a colour set or a theme starts the bar and side menu colours over.
- No migration.

## [2026-10-25 — Purchasing: add items to an order that hasn't been sent]

- Purchasing → Deliveries → a purchase order waiting in **To send** → **Add items** (next to Change quantities, for people with Purchasing approval): a list of everything that supplier sells you, with each pack on its own row (code, product name and, if you see prices, the venue's price). Search by name, tap the products to add (tap again to take one out), tap Done, set how many on the order, then **Save**. Products already on the order can't be picked again: change their quantity instead. Change quantities and Add items work together, so one save can change, take off and add lines.
- New lines go on at today's price for the venue, rounded up to the supplier's minimum and steps (a hint says what will be ordered), marked **New** until saved. If you see prices, the totals follow the changes and say what the order came to before. While the order is being changed, Email and Mark as sent are hidden, so the supplier never gets the old version.
- Pepper's change purchase order looks for the product among that supplier's products only, and adding something already on the order now tops up its line (the card says so) instead of putting it on twice. The same goes for anything else adding to an order.
- An order already sent still can't change: cancel it and order again.
- No migration.

## [2026-10-25 — Menus page keeps a dish's own options; Menus on a phone; kiosk preview notice]

- **Saving a menu no longer deletes a dish's own options.** Options added to one dish directly rather than from an option group (the sample menus, older menus, imports) were wiped every time the menu was saved on the Menus page, along with any meal deal rule on them (Options in this deal). They are now kept. The dish's row shows a small amber badge with how many, and its panel lists them in an amber card with two buttons: **Turn into an option group** (makes a group with the same options and prices, named after them, shown to guests as "Choose" as before, first among the dish's groups; when an identical group exists, **Use the option group** uses it with this dish's prices; a meal deal rule on them moves to the group) and **Remove** (asks first). Both are saved with Save changes. Menus already saved on the page lost theirs before this fix; they don't come back.
- **Menus page on a phone and narrow tablets**: dish names and section titles always show (the badges, price and buttons go on a second line when there isn't room beside the name), a dish's or section's panel opens over the whole screen below tablet width, the buttons along the top show their icons only, and Save is the bar at the bottom. The cards on the Menus pages wrap their header button under the title on a phone.
- **Kiosk preview**: the "Preview: orders aren't sent" notice no longer covers the top right of the kiosk (a meal deal's running price, the language button). In the design editor and on a shared preview page the page around the kiosk says so; a preview opened in its own tab (Full screen) shows it in a thin band along the top, with the kiosk just below.
- No migration.

## [2026-10-25 — Meal deals: a group left with one option is picked for the guest]

- Menus → a combo → Edit steps → **Options in this deal**: when a group is left with one option and something has to be picked from it (e.g. Only some down to Lemon pepper in a flavour group that asks for one), the deal now picks it. The kiosk, the till and online ordering don't ask it; it is still on the line, the kitchen ticket, the meal's picture and the price (an extra charge on that option still applies). The window says **always Lemon pepper. Guests aren't asked**, and the line under the button says **Flavour: always Lemon pepper**.
- On the kiosk a dish in the deal with nothing left to ask gets no page of its own; on the till the step shows the pick in words.
- An optional group left with one option (a dip the guest may not want) is still asked as yes or no; the window says to set How many to at least 1 to always include it (for a group picked more than once, the same number at least and at most). An option that opens a question of its own (Steak, then cooking) is still asked.
- No migration (part of the combo, live once the menu is published).

## [2026-10-25 — Add to order: the dish's picture flies into the order]

- Kiosk: tapping **Add to order** sends the dish's big picture (a meal deal's picture as it was put together) zooming out and flying into the order button at the bottom of the menu, which bounces as it lands. The same with **+** on the menu and a plain dish tapped with quick add on (the card's picture flies), and with a dish added from **Anything else?** on the order page (it flies into Checkout). The picture keeps the design's style on the way (round, oval, hexagon without its name, No frame). Update order (changing a dish from the order) doesn't fly.
- Kiosk design → Layout → **The picture flies into the order** (on unless turned off); off, or on a screen set to reduce motion, the order button only bounces as before.
- Online ordering: **Add** in a dish's sheet flies its picture into the basket (the basket beside the menu, or the View basket bar on a phone), which bounces as it lands; a meal deal's last page has no picture, so its picture flies from the Add button. Not for dishes without a picture or devices set to reduce motion.
- No migration (a kiosk design setting).

## [2026-10-25 — Menus: a dish's option groups in order and closed at first]

- In a dish's panel on the Menus page, its option groups (Variant groups) are cards that start closed, each with its name, how many options and how many prices were changed for this dish. Tap a group's name to open it and set the dish's prices (Enter or Space with a keyboard); a group just attached opens. View users can open them too, to see the prices.
- Drag a group by its grip to put the groups in order: the till, kiosks and online ordering ask them in that order. Saved with the menu (Save changes) and live once published; the Publishing window lists it as the dish's options changed.
- No migration.

## [2026-10-25 — Meal deals: change a dish's options inside the deal]

- Menus → a combo → **Edit steps**: each dish or section choice has **Options in this deal** under its name. For each of the dish's option groups the deal can ask it **As on the dish**, **Leave out** (e.g. no dip question for the meal's wings), **Only some** of its options (e.g. three of the four flavours) or **Another group** from Variant groups instead (e.g. a free Meal sauce in place of the fries' own sauces), with its own **How many** (e.g. up to two flavours in the meal, one on their own). **Make a copy** copies the dish's own group to edit for the deal; the dish on its own keeps its group. The line under the button says what is changed.
- The choice stays the menu's dish: its kitchen stations, allergens, photo, sold out and (later) stock still follow it. A whole-section choice changes every dish in it that has the group.
- The kiosk, the till and online ordering ask the deal's options and price them (an option left out can't be picked; another group charges its own prices); kitchen tickets show what was picked. **Make it a combo** on the till keeps only the picks the deal asks for.
- An automatic combo only counts a dish ordered on its own when the deal could have asked it that way (wings ordered with BBQ don't make a deal that offers three other flavours); options the deal leaves out stay on the dish at their own price.
- Saved with the menu, live once published; a plain save of an untouched menu still shows nothing to publish. A group taken off a dish drops out of its deals on the next save. No migration (part of the combo).

## [2026-10-24 — Kiosk: a meal deal's picture built from the picks; the shade behind the dish's photo]

- On a meal deal's pages the big picture now builds up as the guest picks. Until the first pick it is the deal's own photo; then each pick pops into a picture of the meal: the first step's pick big in the middle (the wings, split by their flavours once picked), the other steps' picks beside it in turn, smaller and a little further back, and steps set to Small in the corner (dips, sauces) in front. On a picked dish's options page (its flavours) the big picture is that dish; when it's done, the meal comes back with the dish popping in. The order line shows the meal the same way. Cut-out pictures (PNGs on a see-through background) look best; ordinary photos get a small frame. Kiosk design → Layout → **Build a meal deal's picture from the picks** (on unless turned off).
- On a wide screen the meal deal's picture stays at the top of the side column while the steps scroll under it, and the list of steps moves no further than needed to show the step being picked.
- Kiosk design → Layout → **Shade behind the dish's photo** (on unless turned off): the quiet shade a split photo had now sits behind every dish photo on its page and in the order, so cut-out pictures keep the same background whether one pick shows or several. Off: no shade, not even behind a split photo. No frame photos get the design's rounded corners while the shade shows.
- No migration (kiosk design settings).

## [2026-10-24 — Kiosk: option groups with their own look; option group types for stock]

- Each option group (Menus → Variant groups) can have its own look on kiosks: **Picture style** (Cards, Round, Oval, Hexagons, No frame), **Pictures or words** and **When the options appear** (Fade in, Slide in, Bubble up, Deal like cards...), beside the existing How the options show. Each stays **As the kiosk design says** until picked, so on one dish the flavours can bubble up as a honeycomb while the dips stay small round pictures. A pick shown small in the corner of the dish's photo takes its group's picture style.
- A kiosk design can change that again for its own kiosks: **Choices → Option groups with their own look**. Add a group, then pick what changes (Shown as, Pictures, Words, Coming in); anything left on its default keeps what the group asks for, else the design's settings for every choice. The default in each list says which it is (Group: ... / Design: ...). The preview follows as you change it.
- Option groups also get a type, **Recipe and stock**: **Product modification** (the dish changes a lot, things on and off its recipe), **Side addition** (a separate item with its own recipe) or **Adds to the recipe**. Not set until picked; shown under the group's name on the list. Nothing uses it yet: stock counts will.
- Group looks and types change straight away (nothing to publish) and a copy of a group keeps them. Migration **206** (`menu_variant_groups.kiosk_tiles`, `kiosk_pictures`, `kiosk_entrance`, `variation_type`).

## [2026-10-24 — Splitter: Smart sharing by speed, and a busy order type to its own station]

- A Splitter's window has **How it shares**: **Fewest pieces** (as before) or **Smart: by speed**. Smart watches how fast each station has been bumping (its last 8 tickets in the last 30 minutes, not counting time a ticket waited behind others) and sends each ticket where it should be done soonest: the pieces still to cook there times how long a piece has been taking. A line that falls behind gets fewer tickets until it catches up; with no bumps to go on it shares by pieces.
- **When one order type gets busy**: Give it its own station, e.g. from 5 waiting Delivery orders, Delivery orders go to Wingman 2 and every other order to the other stations; below that it shares as usual. The station list puts the stations the box links to first, the flow warns when it doesn't link to the one picked, and the rule switches off if that station is deleted or stops bumping.
- The station list, the flow designer's box and link panels and Check a dish say how each Splitter shares. No migration (station settings).

## [2026-10-24 — Kiosk: a size for the pictures in the dish photo's corner]

- Option groups and meal deal steps set to **Small in the corner** now have **Size in the corner**: **Automatic** (as before, about a quarter of the photo's width) or **Set a size**, from 10% to 70% of the dish photo's width, with a slider, - and + buttons and a small sketch of the photo with the picture at that size.
- Each group and step keeps its own size, so the dip can sit small while the drink is bigger. Pictures of different sizes keep their own shape, lined up along the bottom of the photo; when they don't fit side by side they shrink together. Same on the dish page, a meal deal's photo and the order line.
- A group's size works straight away; a meal deal step's needs the menu published. Migration **205** (`menu_variant_groups.kiosk_pick_scale`).

## [2026-10-24 — Kitchen flow links: All except these]

- A flow link's filter can now be turned round: tap a link's label and switch **Which dishes go this way** from **Only these** to **All except these**, then pick what should *not* go that way. Orders in to the Wok, all except Drinks and Desserts, takes every other dish; anything listed (a section, single dishes, an order type, a till or kiosk, a revenue stream) leaves a dish out. The link's label reads "Except Drinks, Desserts" in red.
- Ranking: links that name a dish still win; an All except link comes next, before a link with no filter, so a link for every dish beside it takes what it leaves out. With nothing listed it is simply a link for every dish. Check a dish shows the result.
- Works in shared flows too (a till or stream name a location doesn't have leaves nothing out there), and copies between a location's own flow and a shared one keep it. Links out of a Splitter still can't have filters.
- Migration **204** (`kds_flow_edges.exclude`).

## [2026-10-24 — CI: an API test that failed one run in three]

- The CI "API tests" job failed four times since 23 Oct (deploys were not affected). Cause: a menu save that left a dish's position out gave it position 0, the same as the first dish, and dishes with equal positions came back in random order (by their random ids), so a kiosk test that read "the first dish" sometimes got the new one.
- Menu saves now number sections, dishes, a dish's options, its option groups and footer notes by their place in the list when no position is sent, and dishes with equal positions come back in name order. The Menus page, Pepper and copies always sent positions, so menus made there are unchanged.
- The failing test now picks its dish by id; a new test (`api/test/menu-order.test.mjs`) pins the order down.
- CI's API test job lists the failing tests with their errors at the end of its log (spec reporter) and turns the Postgres service's log down to FATAL, so the result is no longer buried under the cross-tenant sweep's expected errors. No migration.

## [2026-10-24 — Kiosk meal deals: the big picture on every page]

- A meal deal's pages on the kiosk now show the big picture a dish's page shows, following the design's **Top of a dish's page** setting (the photo beside the words, or on top lined up left, centre or right; the column down the side on a wide screen): the deal's photo and words on its steps and last page, with the picks each step puts on the photo, and on a picked dish's own options page that dish's photo, description, calories and allergens with "In Burger meal" under its name. Before, an upright kiosk showed no picture on a deal's pages, and a picked dish never showed big.
- The running price shows once: in the bar along the top, or with the bar off in the deal's picture block (above a picked dish's page as a line with the deal's name). Words in all nine kiosk languages. No migration.

## [2026-10-24 — Kiosk allergens screen: pick, count, marked on the menu]

- The kiosk's **Allergens** screen no longer lists every dish. It shows your allergen notice (Menus → Allergens & dietary), then **Allergens to avoid** and **Dietary choices** (the diets your dishes carry) as big tick boxes, and says how many dishes suit the guest as they tick ("12 of 40 dishes suit you").
- **See the menu** (asking Staying or going? first when needed) keeps the picks for the order. On the menu a strip says what is marked, with Change; dishes to check get a friendly yellow mark and a line with the guest's allergens highlighted (Contains, May contain, Can be removed, Not marked as vegan). Meal deals say when only some of their choices have the allergens, and mark those choices inside the deal. The dish page highlights them in its allergen line.
- Start again clears the picks. Words in all nine kiosk languages. No migration.

## [2026-10-23 — Kiosk: choices that come onto the screen]

- Kiosk designer → Choices → **When the choices appear**: Just there, Fade in, Slide in from the side, Bubble up or Deal like cards. A dish's choices (and each combo step's) come on one after another when the page opens: grids, honeycombs, lists and the slider; the spin wheel comes in whole.
- Guests whose device asks for less motion see them at once. No migration.

## [2026-10-23 — Order statuses from the kitchen flow (Setter)]

- New kitchen flow box, **Setter**: when a dish passes it, the order's status becomes the Setter's name (Cooking, Bagging, Out for delivery). Dishes go straight through; no kitchen screen, nothing to bump. Each Setter at a location needs its own name.
- The Setter decides how the status shows on order ready board tiles: words, a flag, a coloured border, a traffic light (lit lamp chosen), a square or a dot; a colour; and movement (pulse, turn, blink, bounce, shake, glow).
- Screen designer → Order status block → **Statuses**: switch statuses off, or hide or restyle each one on that board only.
- Migration 203 (the new station kind).

## [2026-10-23 — Order board tiles with fonts, shapes and pictures]

- Screen designer → an Order status block → **Tile look**: the tiles' font and weight (and a font for the small lines), italic, capitals, space inside; shape (rounded, square, pill or circle), border and shadow; a picture behind ready tiles and one behind preparing tiles (fill or whole, darkened so numbers stay readable); a small picture on every tile or one per order type, left, right, above or in the corner.
- Screens load the pictures before showing the board and keep them offline. No migration.

## [2026-10-23 — See-through backgrounds in the designers]

- The colour picker in the menu screen designer and the kiosk designer has a **See-through** swatch (checkered, first in the row) on background colours: nothing is drawn, so what is behind shows.
- Menu screens: the board background (a checkerboard shows behind it in the designer), a box, a scrolling text's background, the order board's Ready and Preparing boxes.
- Kiosk designs: Cards, Buttons and Highlights. Pop-up windows keep the page colour so they stay readable; the readability check treats see-through as the page colour.
- Text colours and printed menu inks don't offer it. No migration.

## [2026-10-23 — Kiosk: pictures with a see-through background]

- A PNG or WebP with a transparent background (a cut-out dip pot, burger, bottle) now shows whole on the kiosk with nothing behind it: no shaded background behind dish and choice pictures, and in the dish photo's corner no round badge or ring round a pick, just a soft shadow under its outline.
- The kiosk notices see-through pictures by itself; pictures without see-through parts keep their frame and badge as before. No setting, no migration.

## [2026-10-23 — Store tech in the main menu]

- Till setup is now **Store tech**: its tabs (Tills, Kiosks, Kitchen screens, Printers, Printing, Card machines, Order types, Revenue streams, Courses, Staff and PINs, Till roles, Receipts and payments, Cash Recon link) are pages of their own, each a link in a new Store tech section of the left menu after Venues, with Floor plan and Menu screens (moved from Menus) beside them. The row of tabs at the top of the page is gone.
- Pages are at /pos/tills, /pos/kiosks, /pos/kitchen and so on; /pos and old ?tab= links open the right page. Kiosk and print designs open under their page (/pos/kiosks/designs/..., /pos/printing/designs/...), so its menu link stays lit.
- "Till setup" is called Store tech everywhere it was named (Access, device messages, the hub, help text).
- Migration 202 changes every group's menu in place: Till setup and Menu screens links go, the Store tech section goes in after Venues; roles hidden from the old links stay hidden from the new ones; other Navigation changes are kept.

## [2026-10-23 — Kiosk: pictures or videos above the screen in reach mode]

- Kiosk designer → Timing and access: under the Reach button, optional pictures or videos (up to 4, taking turns like the start screen's, videos with no sound) that fill the top of the screen while the reach button has brought everything down. The button to move the screen back up sits at their foot. Without any, the top shows the brand colour and the reach sign as before.
- Pictures are kept on the kiosk for offline use like the rest. No migration.

---

## [2026-10-23 — Kiosk: each option group decides where its picks go on the dish's photo]

- **Picks on the dish's photo** is now set on each option group (Menus → Variant groups) and each combo step: **No**, **Split the photo** or **Small in the corner**. One dish can split its photo between the flavours picked and show the dip small in the corner. Corner pictures sit on top of the photo whether it is split or not; the order line shows both.
- The kiosk design's *Picks on the dish's photo* setting is gone (the Choices panel points at the groups instead). Groups and combo steps that had Split photo on keep the look their kiosks had: small in the corner where every kiosk design used corner, otherwise split.
- Migration 201.

---

## [2026-10-23 — Dish-price options at £0 keep the dish price]

- In an option group set to *Option price is the dish price*, an option left empty or at £0 now keeps the dish's own price everywhere (kiosk, till, online ordering, menu screens). Before, a £0 option replaced the price: 12 Wings at £12.99 with a flavour group whose flavours were £0 showed and sold at "from £0.00".
- The menu shows "from" only when the options really change the price, and a £0 dish-price option shows no price beside it.
- No migration.

---

## [2026-10-23 — Kiosk: dishes with no price]

- A dish the kiosk can't price (no price of its own, no option with a price to choose) is left off the kiosk menu, as online ordering already did. Before, it was listed and its page let guests pick options, then greyed out Add to order with no reason. It stays available as a meal deal part.
- Reached from a banner, featured tile or "Anything else?", its page says *This can't be ordered here. Please ask at the counter.* (nine languages); a meal deal that can't be priced says the same on its last page.
- The kiosk design editor names the dishes left off for having no price, above the preview.
- No migration.

---

## [2026-10-23 — Kitchen flow: Sleeper; Balance box renamed Splitter]

- **Sleeper** (Till setup → Kitchen screens → Kitchen flow → Add to the flow → Sleeper): holds the dishes that reach it for a set time (1 to 240 minutes, Edit station → Hold dishes for), then sends them on to the next stations by itself. Which dishes it holds is set on the link into it, like any station: by order type (Delivery), revenue stream, the till or kiosk it was sent from, section (Desserts), single dishes, or every dish. Links out of it can have filters too.
- On the kitchen screens, the next station only sees a held dish once it wakes, and its timer starts then. The pass (and any station showing dishes before they arrive) shows it as *Waiting at Delivery wait until 19:42*; a ticket with only held dishes shows that time in place of its clock. The pass's Bump sends held dishes on at once; a dish remade after it woke doesn't wait again; an online order set ready from the board counts as woken. A Sleeper before a kitchen printer prints the ticket when it wakes (within a minute). Check a dish shows the wait. The test bench shows held dishes as asleep until their time.
- A Sleeper has no kitchen screen and nothing to bump. A station changed into a Sleeper leaves its kitchen screens.
- The **Balance box** is now called **Splitter** everywhere (how it works is unchanged).
- **Migration 200** (kitchen_sleeper): `kds_stations.kind` takes `sleeper`.

## [2026-10-23 — Two pictures for each choice]

- Option group options (Menus → Variant groups) have two pictures: **Tile**, shown on the choice on kiosks, and **On dish**, shown on or in place of the dish's photo when the group has Split photo on (split or small in the corner, on the dish page and the order line). An option without an On dish picture uses its Tile picture there, as before.
- Combo choices (Edit steps) get an **On meal** picture for the meal's photo: typed-in choices beside their Tile picture, single dishes beside their name (without one, a dish shows its own photo).
- Pictures for the dish's photo are kept on the kiosk for offline use like the others.
- On a phone, the Variant groups list shows each group's options under its name (they squeezed into the "Guests see" line).
- **Migration 199** (choice_photo): `menu_variant_options.photo_url`.

## [2026-10-23 — Kiosk: no frame pictures, the dish page's top, picks on the photo, bundle steps; option group display names]

- **No frame** picture style for dishes and for choices (kiosk designer, Menu and Choices cards): the whole picture as it is, straight on the page, with no card, corners, shadow or background; best with PNGs on a see-through background. List and wheel thumbs follow it. A picked choice glows in the button colour round its outline.
- **Top of a dish's page** (Layout card): the photo beside the words as before, or **Photo on top**, with the photo lined up left, centre or right and the name, description and price under it lined up left, centre or right.
- **Picks on the dish's photo** (Choices card), for groups and combo steps with Split photo on: **Split photo**, or **Small in the corner** (the dish's photo stays, with each pick's picture small in its corner). With Split photo, a single pick now shows its picture in place of the dish's photo (it kept the dish's photo until there were two).
- **Bundles**: each done step's tab shows what was picked, as its picture with its name under it; **Step 2 of 5** sits beside Continue at the button's size; the step's name sits right above its choices, with no "Choose 1" line (a step taking more than one shows 1/2 beside its name).
- **Option group display names** (Menus → Variant groups): what guests see as a group's heading (kiosks, online ordering, the website, printed menus, menu screens) and the tills, such as Choose your flavours for a group called Flavour x2 (copy). Empty shows the group name. A menu shows a new display name once published; translate it on Menus → Translations.
- **Migration 198** (option_group_display_name): `menu_variant_groups.display_name`.

## [2026-10-22 — Copy dishes, sections and option groups]

- **Copy a dish**: the copy icon on a dish's row, or **Copy** at the top of its panel. The copy goes just after it, named "(copy)", with its price, words, photo, options and their prices for this dish, allergens and tags, till, tax and online settings and a combo's steps.
- **Copy a section** (category) with all its dishes: the copy icon on the section heading, or **Copy** in its panel. Dishes keep their names; a meal deal in the section offering its dishes or the section itself offers the copy's.
- **Copy options from another dish**: in a dish's panel under Variant groups, pick a dish; its option groups come over with its prices (groups this dish has take those prices, its others stay).
- Dish and section copies are part of the draft until **Save changes**, and reach guests when the menu is published.
- **Copy an option group**: the copy icon on a group on Menus → Variant groups makes "Name (copy)" just after it with every setting and option, opens it to rename, and isn't on any dish until attached. Translations of its options come with it. No migration.

## [2026-10-21 — Lines not ordered look like the others on the order page]

- On a received purchase order, lines that arrived without being ordered (Not ordered) now show the quantity that arrived and, for people who see prices, their value at the invoice's price, like every other line (they showed only "Arrived: 1").
- Their total shows under the order's total as **Not ordered, arrived £x + VAT £y**; the order's own total (now **Order total** when there are such lines) stays as ordered. No migration.

## [2026-10-21 — Pepper reads delivery invoices and petty cash receipts; supplier product names]

- **Read the invoice when a delivery comes**: in Purchasing → Deliveries → **Book in delivery**, photograph the supplier's invoice or delivery note (or choose photos or a PDF) and tap **Read it with Pepper**. Pepper matches each line to what was ordered: how many arrived is filled in (fewer marks it Short), a different product than ordered is marked Substituted, and an ordered line missing from the invoice is flagged. People who see prices get the invoice price per pack, with how much it differs from the ordered price.
- Lines on the invoice that weren't ordered are listed under **On the invoice, not ordered**: one of the supplier's products is added as arrived; anything else waits for you: **Add it** (pick the inventory item and its pack, or the pack as invoiced; with Purchasing setup make a new inventory item), **Came instead** of an ordered line, or **Leave out**. **Not this line** undoes a wrong match. The invoice files stay with the order; the supplier's copy still shows only what was ordered.
- **Update the price list from the invoice** (Purchasing setup): after saving, prices that changed can be updated everywhere or for that venue only, new products added to the price list (with the supplier's product name, code and pack from the invoice, optionally as the one ordered from now on), and a substitute added as another product for the same item. Each change shows in the price's History as from the invoice.
- **Supplier product names**: a supplier price can carry the supplier's own name for the product, such as a brand (item Ketchup, supplier price Heinz Tomato Ketchup). Staff still order Ketchup; the product name shows under it, between brands when switching supplier, on the order page and on the supplier's copy. Set it on the Inventory page, in the import file (Product name column) or by chat with Pepper.
- **Read a petty cash receipt**: in the expense form (Cash Recon day view and the phone's Expenses), **Photograph the receipt** and Pepper fills in the description, amount, VAT (when printed), card or cash and the category; the photo becomes the receipt. On the phone a receipt from another day can go on that day.
- Reading counts towards the AI allowance like a chat and needs Pepper switched on.
- **Migration 197** (invoices_and_product_names): `inv_quotes.product_name`, `purchase_invoices` (forced row-level security), invoice and pack columns and `added_on_receipt` on `purchase_order_lines` (an added line is ordered 0), `inv_price_history.po_id` and source `invoice`.

## [2026-10-20 — New venue step by step, menus from a photo, Brand & theme page, a tidier main menu]

- **New venue** (Venues → New venue, or the button on the Venues page) sets a venue up step by step: the venue (name, address, time zone, opening date), Brand & theme, the menu, opening hours, tables and booking rules, everything else (devices to get ready, online ordering, a card per remaining area), then **Check and create**. Start **From scratch** or **Like a venue you have**. Each step has its own Save; moving on with changes not saved asks first. Nothing is made until Create. It replaces the Add venue form and the Pepper-led New location page; drafts are kept and listed.
- Pepper is optional: **Describe it to Pepper** on the first step fills in what you haven't set yourself (what to copy, hours, tables, devices) and may ask a few questions. With no venues yet, the Overview shows **Set up your first venue**.
- On the Brand & theme step a later venue's web page can have **its own look**, made from a picture or a few words; the Menu step reads a menu from your files or picks menus the group has for the venue's online ordering (optionally keeping menus made there for that venue only).
- **A menu from a photo or PDF**: Menus → **From a photo or PDF** (also in the wizard). Add photos of each page or a PDF (up to 10 files), and Pepper reads the sections, dishes, prices, descriptions, allergens, dietary tags and options. Check and change them, then **Make the menu**: it is saved as a draft to check, add photos to and publish. Allergens and tags are matched to yours (never added); options use your option groups or a new one named after the menu. Counts towards the AI allowance.
- **Brand & theme** has its own page (Brand & web → Brand & theme): the brand name, tagline, logo, browser icon, colours and fonts, with Theme ideas. It applies to more than the website: **Use the brand on other designs** puts it on the kiosk designs, menu screen boards and printed menu designs you tick (each keeps its layout, pictures and words), and the kiosk, menu screen and printed menu designers have **Use the brand** beside the theme maker. The website still shows brand changes once published.
- Website → Brand & theme is now **Look & layout**: the site name, social picture, boxed inset layout, and a location's own look (**Give a location its own look**).
- **A new main menu** for every group, grouped by job: Home, Service, Money, Health & safety, Stock, People, Menus, Brand & web, Venues, Admin, Help, with every page once. It replaces each group's menu once (changes made on the Navigation page and launcher tiles go; the menu is back to the sidebar). Navigation → Reset to defaults brings it back later.
- **Migration 196** (main_menu): replaces every tenant's `nav_items` with the new default tree and sets `tenants.nav_style` to sidebar.

## [2026-10-20 — Download the hub's installer]

- The venue hub has an **installer to download** on the mini PC: open **pos.macaroonie.com/hub** in its browser and press **Download the installer**.
- **Windows**: double-click `macaroonie-hub-setup.cmd`. Windows warns about a file from the internet (**More info**, **Run anyway**) and asks to allow changes (**Yes**). It installs the hub, and when it has finished the hub's page opens with the six-letter code. Running it again updates the hub; `macaroonie-hub-setup.cmd uninstall` removes it.
- **Linux**: `sh ~/Downloads/macaroonie-hub-setup.sh` in a terminal; it asks for the password itself.
- Till setup → Printers → Venue hub shows the address to open on the mini PC (with Copy), the two downloads for when you are already on it, and the one-line commands under **Or run a command**. The installer app's **Add a hub** shows the address with a QR code.

## [2026-10-20 — Website brand saves fixed; .ico favicons]

- The **favicon** (Website → Brand & theme → Brand identity) can be an **.ico** file, uploaded on the field, dropped on it or added through the Media library. Files that only end in .ico but aren't one are refused.
- Fixed: saving **Brand identity** on Website → Brand & theme failed with "Internal server error" once any location had website settings (it always sends the template). The same happened to theme saves that change the template, such as **Use this** from Theme ideas.
- Fixed: saving the group's theme cleared the colours and fonts of locations that have their **own Brand & theme**. Saving the group's brand now leaves locations' own brand alone.

## [2026-10-20 — The venue hub on a mini PC]

- The venue hub now runs on a **mini PC** by the printers (a fanless Intel N100-class box with Ubuntu / Debian Linux, or Windows 10 / 11), set up with **one command**. Till setup → Printers → Venue hub shows it with **Copy**: `curl … | sudo sh` on Linux, `irm … | iex` in PowerShell on Windows.
- The installer brings its own Node.js, downloads the hub from Macaroonie (checked before use), installs it as a service that starts with the computer and restarts itself, and shows a **six-letter code**. Link it with **Link a hub**, or scan the QR code on the hub's page with the installer app.
- **USB printers on the hub.** A USB receipt printer plugged into the mini PC can be printed by the hub: Add a printer → **USB on the hub** and pick it from the printers the hub found, or tap **Add it** beside one on the hub's row. It can have a backup printer and shows whether it is ready, like a network printer.
- **The hub's page**: `http://(its address):9180` on the venue's network shows the link code (with QR code) until linked, then whether it reaches Macaroonie, its version, each printer and how it is, the USB printers plugged in and the last tickets (printed or not, never what was on them).
- **Updates by itself** at a quiet moment (nothing printing) and goes back to the version before if a new one doesn't run. Turn **Update by itself** off in the hub's settings to choose when; its row then offers **Update now**. The row shows the hub's computer, version, update state and a link to its page.
- Removed in Till setup, a hub shows a new code by itself; **New device** on its row moves it to a replacement mini PC with its name and printers.
- The **installer app** lists venue hubs, shows a hub's page (computer, page link, USB printers, updates) and links a hub's code; **Add a new device → Venue hub** shows the install commands.
- Fixed: a network printer that wasn't there at all showed as **Ready** (a connection that never opened counted as "doesn't say how it is"); it now shows **Not answering**.
- **Migration 195** (hub_appliance): `pos_printers.local_id`, `pos_devices.info`, `info_at`, `update_requested_at`.

## [2026-10-20 — Make a theme from a picture and a few words]

- **Make a theme** builds a whole look (colours, fonts, corners, capitals) from a picture and a few words. It is on Website → Brand & theme (new **Theme ideas** card), in the kiosk designer (Brand), in the menu screen designer (board panel) and in the printed menu designer (Page setup → Colours).
- Add a picture (upload, drop, pick from Media, or **Use my logo**): its main colours are measured and three themes made straight from them (light, dark, bold) show at once, without any AI.
- Say the look you want in your own words (or tap an example) and **Make themes**: Pepper makes three themes from the picture, its measured colours and the words. **Try again** for three more, **More like this** for three close to one you like.
- **Show on** previews every theme on the website, a kiosk, a menu screen and a printed menu. **Use this** fills in the page's settings; nothing changes until you save, as usual. **Themes you used** lists them on the device, so one theme can go everywhere.
- Every theme is made readable before you see it: words on what they sit on, white button words on the website, a deep background with light words on menu screens, inks that read on the printed menu's cream paper.
- Without Pepper the window still makes the themes from the picture's colours. Pepper's themes count towards the AI allowance; the picture isn't kept.
- Brand & theme now shows the six ready-made themes and the live preview above the colour fields.
- Printed menu designs have their own **colours** in Page setup: text, prices / lines / handwriting, and descriptions (**Standard colours** goes back).
- Fixed: the website's background picture (Brand & theme) was dropped every time the theme was saved.
- No migration.

## [2026-10-20 — Rota printout and image look like the grid]

- **Rota → Print / PDF** and **Save image** now look like the rota grid on screen: a tile per shift in the same colours (green ON, grey OFF, SICK / PTO / UTO / ABS in their own colours, hatched LEFT and AWAY), each day's shifts under the day, closed days marked. Hourly rotas show each period in a tinted box with its times. A line under the sheet gives the shift times and what the time-off codes mean.
- The printout and image leave out the Week hours column, the On shift row, the role under each name and the grid's buttons.
- **Save image** saves a JPG instead of a PNG (smaller, opens everywhere).
- Rota setup's **Hide totals on printouts and images** is gone: totals are never printed now.
- **Migration 194** (rota_print_like_grid) drops the old setting.

## [2026-10-20 — Card machines: Dojo, Stripe Terminal and SumUp on the till and kiosks]

- **Till setup → Card machines**: add your Dojo, Stripe or SumUp account with its secret key (checked with the provider before saving, stored sealed, never shown again), then add each machine at a location: pick it from the account's machines, or pair a new one with the code it shows (Stripe and SumUp). A **Test card machine** pretends to take cards, with Approve and Decline buttons on the till and kiosk.
- Each till and kiosk picks its card machine in its settings on the Tills and Kiosks tabs (the installer keeps the choice when it saves a device). A till's Pay window then offers **Card machine**: the amount (and any tip) goes to the machine, the till waits while the guest taps or inserts, and the payment goes on the bill only once the machine approves it, with the card shown (Visa •••• 4242). **Cancel** stops the machine; a declined card says so with **Try again**. A Dojo machine asking for a signature asks staff to check it on the till.
- If the till loses track (closed, reloaded, lost its connection), reopening Pay picks the payment up where it was; a payment the machine took that never reached the bill is listed with **Add it to the bill**.
- Taking a card machine payment off a bill, and refunds of closed checks to **Card machine**, refund the card through the provider first (same manager approval as before).
- Kiosks with a card machine take the card there and then; a declined card offers to try again or pay at the counter. The kiosk preview and shared links keep the pretend card step and never charge.
- Every attempt is kept: Till setup → Card machines → **Recent payments**, with any approved payment that never reached a bill marked. Payments a till stopped watching are checked every minute, and given up after 15 minutes.
- Cash Recon: card machine payments count with card payments in each venue's takings mapping.
- **Migration 193** (card_machines). Kiosks that used the old "test card reader" setting get a Test card machine at their location.

## [2026-10-20 — Kitchen flows shared by every location; Screens page per location]

- **Shared kitchen flows**: Till setup → Kitchen screens → **New flow** (or **Copy**) → **Every location**. A shared flow shows at every location after its own flows, with a globe on its tab; each location puts it in use itself. Its boxes are station names: at each location a box is that location's station of the same name (capitals and spaces don't matter), so one flow sends each location's dishes to its own Grill, Fryer and Pass. A location without a box's station skips that box's links, and its dishes take the next closest link.
- The designer marks boxes this location has no station for (*none here*) and lists what each location lacks, with **Add them at** that location. A box's panel names its station at every location, with **Add it** where there isn't one. Boxes can be renamed, given another kind and removed.
- **Sent from**: a kitchen flow link can now take only the dishes sent from a given till or kiosk (the bar's till to the bar). It ranks after the dish and its section, before the revenue stream and order type. In a shared flow it goes by the till's name at each location. The kitchen test bench's Test order has a matching **Sent from** choice; **Check a dish** has one too.
- A copy goes either way: a shared flow as this location's own, or this location's flow shared. A shared flow can't be deleted while any location uses it. A new location copied from one that uses a shared flow uses it too.
- **Screens** page: a **Location** picker on the Screens and Walls tabs shows one location's screens and walls (or every location's), remembered on the device; new screens and walls start at the location picked. Boards and playlists stay shared by every location.
- **Migration 192** (shared_kitchen_flows).

## [2026-10-19 — Kitchen printers in the flow, printers plugged into tills, the venue hub]

- **Kitchen printers in the kitchen flow**: Till setup → Kitchen screens → Add a station → **Kitchen printer**, pick its printer, and link it in the flow like a kitchen screen. Linked from the till and online orders, it prints each order when it is sent: held courses listed under HOLD, then a **FIRE** ticket when the course is fired, a **VOID** ticket when a dish is voided. After a kitchen screen it prints when that screen bumps the dish (a runner's ticket from the pass). Orders for later print when their time comes. Tickets use the venue's kitchen ticket design.
- The old **What prints where** list (dish, section, revenue stream) is gone: the kitchen flow decides, with the same filters on its links.
- **Printers** tab: each printer is **on the network** (printed by the venue hub) or **plugged into a device** (a till, kitchen screen or kiosk prints it through Chrome; start Chrome with --kiosk-printing to print without the dialog). Each row says how the printer is (ready, paper low, out of paper, cover open, not answering, or which device prints it) and how many tickets are waiting or didn't print; **Tickets** lists them with **Print again**.
- **Venue hub**: a small program for a PC on the venue's network (`node hub/bin/hub.js`). It shows a code; **Link a hub** on the Printers tab. It prints the network printers' tickets, uses a printer's backup when it doesn't answer, and reports every minute how each printer is.
- Tills print bills and receipts in their own browser only when they have no receipt printer or one plugged into them; a network receipt printer prints through the hub. The till's "Kitchen tickets too" switch is gone.
- **Migration 191** (kitchen_printers).

## [2026-10-19 — Kiosks follow the menu's option settings]

- Self-order kiosks now follow the menu's own option settings (Menus → the menu's details), like the website, the printed menu and online ordering: **Don't show a price on zero-priced variants** shows a £0 option without "£0.00", and **Don't show the variant option at all if it isn't priced** leaves options with no price (or £0) off the kiosk, so guests can't pick them. The till still shows staff every option.
- No migration. Publish the menu (or open the kiosk preview with the menu's unpublished changes) to see it on the kiosk.

## [2026-10-19 — Designs for printed kitchen tickets and receipts]

- Till setup has a new **Printing** tab. **What prints where** picks a design for kitchen tickets, till receipts and bills, and kiosk receipts: one for the whole company, and another at a venue if it needs one. Kiosk receipts print like till receipts until you pick a kiosk design.
- A **design** lists the parts of a ticket from top to bottom: drag to reorder, tap a part to change it, add or take out parts. Kitchen tickets: station name, the **order title** (the table or order number as usual, or the tent number, table, order number or customer's name, big or tall, white on black), details (order type, tent, table, name, order number, covers, server, check, time), the dishes, your own words, lines and space. Receipts: your name, address and VAT number, a heading (different on bills), an order title (a big order or tent number for counter and kiosk orders), details, dishes (with or without priced extras listed), totals, VAT, payments, a footer (different on bills), words, lines and space.
- Designs belong to the whole company. **Only at** a venue changes that venue's words and leaves parts out there, without touching the others.
- A preview prints a made-up table order, counter order with a tent, or void (a receipt, bill or counter receipt), laid out in the printer's columns on 58 mm or 80 mm paper. Tills and kiosks get changes straight away.
- The bill and receipt footers moved from Receipts and payments into a design named **Receipt**, with each venue's footers as its own words. A new location copied from another gets its print choices too.
- **Migration 190** (print_designs).

## [2026-10-19 — Order ready boards, kitchen tickets and kiosks show tents and names]

- **Order ready boards**: the Order status block on a menu screen board has a new **Each tile** section. **Big text** picks what shows big on each tile: the order number, the tent number, the table or the customer's name. **Under it** adds small lines: order number, tent number, table, customer name, order type, where from. For counter service with tents, Big text *Tent number* with *Order number* under it shows "TENT 12 / Order 57". An order without the big one (online orders have no tent) shows its order number instead, and a line shows only when the order has it. The old switch "Show the guest's first name" becomes the Customer name line on boards that had it on.
- **Kitchen screens**: each screen has a **Ticket title** in Till setup → Kitchen screens (Edit): *Table or name* (as before), *Order number*, *Tent*, *Table* or *Name*. With *Tent*, tickets read "Tent 12" with the order number beside it; an order without a tent shows its table or name.
- **Kiosks**: the number a kiosk asks for when the revenue stream asks for a tent is now a **tent number**: "Your tent number", "Take a numbered tent from the stand, type its number here and put it on your table", and on the order number screen "Put tent 12 on your table: we'll bring your order to you", in all nine languages. A design whose guests sit down first can switch back to table numbers: **Number to type** in the design's Paying panel.
- **Kitchen test bench**: test orders take a tent number (counter orders) and a customer name, and some made-up orders get a tent, so ticket titles and boards can be tried before service.
- **Migration 189** (order_tile_fields).

## [2026-10-19 — One way to set up tills, kitchen screens and kiosks]

- Devices are now set up **one way**, the installer's: open the device's address (tills **pos.**, kitchen screens **kitchen.**, kiosks **kiosk.**) and it shows a six-letter code with a QR code. Type that code in Till setup (**Add a till**, **Add a screen**, **Add a kiosk**, with the name and settings in the same window), or scan the QR code with a phone and link it in the installer app. The device sets itself up.
- Till setup and the installer no longer make codes to type into a device, and devices no longer have a **Have a code from Till setup?** form. Before, Till setup showed a code to type on the kiosk while the kiosk showed a different code to type in the installer.
- **New device** on a row puts a till, kitchen screen or kiosk on another device (type the code that device shows; the old one stops). A disconnected device shows **Not linked** with **Link a device**.
- A code shown on one kind of device can only become that kind: a kitchen screen's code typed in Add a kiosk is refused and says so.
- Devices moving from the old shared address to their own still move by themselves.
- No migration.

## [2026-10-19 — Website menu block: pictures can be switched off]

- The website's **Menu (inline)** block has two new switches under Display: **Show dish photos** and **Show section pictures**. Turn both off for a menu in words only. Both are on by default, so menus already on the site are unchanged.
- The builder preview follows the switches. Only that block changes: online ordering, the kiosks and the printed menu keep their pictures.
- No migration.

## [2026-10-19 — Kiosk preview: see menu changes before publishing]

- The kiosk design editor's preview shows the menu **as published**, the same as the kiosks, so a dish photo, price or dish saved on the Menus page didn't show there until the menu was published. A new list above the preview switches between **Published menu** and **Menu with unpublished changes**; the choice is remembered on this computer.
- When a menu the preview shows has changes not published yet, a note above the preview names it, with **Show the changes**. With the changes on, the note says so, with **Show the published menu**.
- **Reload** loads the menu again, after changing it on the Menus page in another tab.
- Shared preview links get the same choice (**Menu** in the Share window), to show a new menu before it goes live; the shared page says when it includes changes not published yet.
- Kiosks themselves always show the published menu. Option group pictures (flavours, sauces) were never held back by publishing.
- **Migration 188** (kiosk_share_menu).

## [2026-10-19 — Kiosks: every picture kept on the kiosk; a lost connection noticed in seconds]

- **Every picture on the menu is kept on the kiosk**: dishes, sections, choices, banners, featured and section tiles, order type cards and the logo, loaded in the background after each menu change. A guest already ordering when the internet goes still sees every picture, not only the ones someone happened to open before. Only pictures the kiosk doesn't have yet are loaded, so a menu change doesn't download them all again. Start screen videos aren't kept.
- **A lost connection is noticed in seconds**: the kiosk and Macaroonie check on each other every 15 seconds, so even a shop router that loses the internet while the Wi-Fi stays up is noticed (within about half a minute). Before pausing ordering the kiosk tries twice more straight away (after 1 and 3 seconds), so a short blip or a quick server restart doesn't pause it. Once paused, it tries every 5 seconds and opens ordering again as soon as it gets through.
- **The staff panel** (five quick taps in the top-left corner of the start screen) shows Online, Checking or Offline, and how many of the menu's pictures are saved on the kiosk.
- No migration.

## [2026-10-19 — Kiosk choices: words only, and centred]

- **Words only** in the kiosk design editor's Choices card: choices show without pictures. Each shows its name, level and price in the choice shape you picked: a card (with the description), a circle, an oval, or a hexagon (hexagons still lock together like a honeycomb). The list and the spin wheel leave their small pictures out too. A split photo still uses the pictures.
- **Line up the choices**: a grid or honeycomb of choices, with its heading, can start from the left (as before) or sit centred on the screen. Centred card grids keep each card the same width, so a short last row sits in the middle.
- Existing designs keep pictures and line up from the left until you change them.
- No migration.

## [2026-10-19 — Kiosk designs: a preview link for people outside the group]

- **Share** in the kiosk design editor (top bar) makes a link to the design that anyone can open without signing in: a brand team, a franchise partner, a designer. Pick whose menu and prices it shows (a venue, and a revenue stream if the venue has more than one), and optionally a last day it works. The window shows the link with Copy, Open and a QR code, and how many times it has been opened.
- The link opens a page with the kiosk at a real kiosk's size, scaled to fit, with **Upright** / **Wide**, **Start again** and **Full screen**. It shows the design **as last saved**, with the venue's live menu. Nothing is ordered or paid from it.
- **New link** stops the old one and makes another (the view count starts again). **Stop sharing** switches it off. Both ask first. Till setup's Kiosks tab marks shared designs.
- **Migration 187** (kiosk_share_links).

## [2026-10-19 — New location with Pepper]

- **Venues → New location with Pepper** (also **New location** in the menu, after Venues): describe the new location in your own words. Its name, address, when it opens, which location it's most like, and what's different are enough. Pepper works out the plan.
- **The scope**: one card for each area: opening hours, tables, booking rules, website page, booking emails, online ordering, the Deliveroo file, tax, the till, kitchen screens, devices, Cash Recon, food safety, checklists, dashboards, purchasing and staff. For each, Pepper picks **Copy** (from a location you already have), **New** (start simple, from what you said) or **Later** (leave it out). Change any card yourself. Areas your role can't set up are marked and left for someone who can.
- **Questions only where needed**: Pepper asks a few things it can't guess (up to three rounds), with choices to tap where it can. Leave any of them to Pepper, or skip them all. **Look closer** on a card has Pepper go through that one area in more detail.
- **The brief**: a short summary of the deployment: what gets set up, the assumptions Pepper made, the risks, and what's left for people to do. Ask for a change in plain words, edit the name, web address, address and opening date directly, or print it.
- **Create** makes the location and every area in one go: copies are taken from the location you picked, with their own new ids, never pointing back at the original. A location that opens later gets a "Not open yet" closure on its booking calendar until then, and online ordering stays off until you switch it on. Afterwards a **to-do list** shows what's left (linking devices, printers, the website, the supplier accounts, the team, anything left for later), each with a link and a tick box.
- **Pepper does the same in a chat** (and through the staff connector): ask it to plan a new location, answer its questions there, and it shows a Create card to confirm.
- Uses the monthly AI allowance and each person's daily share like any Pepper chat. Needs Venues manage (Cash Recon also needs an owner or admin).
- **Migration 186** (store_openings).

## [2026-10-19 — Kiosk: dish and choice pictures set apart; choice hexagons lock together]

- **Dish pictures and choice pictures each have their own style** in the kiosk design editor. *Dish pictures* (Menu card) covers the menu's dishes, the section tiles, the dish's own photo and the basket. *Choice pictures* (Choices card) covers option groups and combo steps. Each can be Cards, Round, Oval or Hexagons, so you can have round dishes with hexagon choices, or hexagon dishes with plain card choices. Designs you've already made keep the look they had until you change one. Hexagon dishes still give buttons and chips the hexagon look across the kiosk.
- **Hexagon choices lock together like a honeycomb, even when there are only a few.** Before, a group of four or fewer sat in one straight row; now three choices make two over one, four make two over two and five make three over two. Bigger groups fill rows that take turns being one shorter, with the last row centred.
- No migration.

## [2026-10-19 — Kiosk designs: layout, hexagons, section tiles, split photo]

- **Start again is in the bottom bar**, after Back, on the menu, the order page, the name and table number pages and How to pay (not on the card reader). It still asks first when the order has something in it.
- **New Layout card in the kiosk design editor:**
  - *Dishes, choices and section tiles* drawn as **Cards**, **Round** or **Oval** photos (the words under them on the page, no card behind), or **Hexagons** that fit together like a honeycomb. With hexagons, buttons, chips and cards take hexagon ends too, and a faint honeycomb sits behind the screens.
  - **Bar along the top** on or off. Off, the menu starts at the top of the screen and the language button moves to the bottom bar.
  - **Back and Start again** with their words, or as **icons only**.
- **No sections down the side** (Menu card, *None: section tiles*): the menu opens on a page of section tiles, under the home page's banners and tiles. Drag the tiles into order and give each a picture, its own words and a width. A section opened from a tile has Back in the bottom bar.
- **Spin wheel** (Choices card): turn the Spin button off, or have a spin **pick the choice it stops on**. While the wheel turns, the card under the pointer is hidden, so the result isn't given away.
- **Split photo from the picks** (Menus → Variant groups, and each combo step): once a guest picks two or more options with pictures, the dish's photo becomes those pictures side by side with a torn edge between them. Three picks show the left third of the first, the middle of the second and the right third of the third. It shows on the dish page and on the order line.
- A design now keeps only your own sections, dishes and order types when saved.
- **Migration 185** (kiosk_split_photo).

## [2026-10-18 — Kiosk: Back at the bottom]

- **Every kiosk screen's Back is now a solid button at the bottom left**, beside the main button, instead of a plain link at the top: a dish and a combo (where Back goes one step back, and out of the combo from its first step), the name and table number pages, how to pay, the card reader and the allergen list. On the order page, Add more is the same solid button. The dish page's top bar now just shows the dish's name.

## [2026-10-18 — The installer app: link tills, kitchen screens, kiosks and menu screens from a phone]

- **A new phone app at installer.macaroonie.com** for setting up a venue's devices while you stand next to them. Sign in, choose the venue, and see every till, kitchen screen, kiosk and menu screen there with its state (Online, Offline, Code waiting, Not linked). Install it from Chrome (or Add to Home Screen on an iPhone) and it opens like an app.
- **Devices show their own code and a QR code.** A till, kitchen screen or kiosk that isn't set up now shows a six-letter code and a QR code (as menu screens did, now with a QR code too). Scan it with your phone's camera: the installer opens on that code, says what the device is, and you name it (and pick a kitchen screen's stations, or a menu screen's board) and tap Link. The device sets itself up within seconds. Codes change every 15 minutes until used.
- **Add a new device** in the installer: it shows the address to open on the device (with a QR code), or makes a till, kitchen screen or kiosk and a code to type on it.
- **A device's page** in the installer: change its name and settings (Save), show a menu screen's name on it, reload it, **move it to a new device** (the new one keeps its name and settings, the old one stops), or remove it (asks twice).
- **Till setup** has **Link a code shown on the till** (kitchen screen, kiosk) on its device tabs, and points at the installer. Typing a code made in Till setup into a device still works: on the device press *Have a code from Till setup?*.
- Before first use: add https://installer.macaroonie.com to the Auth0 application's Allowed Callback URLs, Allowed Logout URLs and Allowed Web Origins.
- **Migration 184** (device_link_codes).

## [2026-10-18 — Balance boxes: a choice for big tickets]

- **A Balance box can share out big tickets.** In its window (Till setup → Kitchen screens → the box → Edit), **Big tickets**: *Keep each ticket on one station* (as before) or *Share big tickets* with a number of pieces. A ticket with more pieces than that is shared out: each dish line goes, biggest first, to whichever station then has the fewest pieces to cook, counting what this ticket has already given it. One dish line is never split; a meal deal's parts can go to different stations. The station list and the flow designer say which the box does.
- No migration (a new key in the station's settings, null by default).

## [2026-10-18 — Balance boxes: share tickets between two kitchen stations]

- **A Balance box in the kitchen flow shares tickets between stations doing the same job**, e.g. two wingmen. In Till setup → Kitchen screens, **Add to the flow** → **Balance box**, list what dishes count as (the 10 Wings option counts 10, the 8pc dish counts 8), link the wings to the box and the box to both wingmen. Each ticket's wings go to the wingman with the fewest pieces still to cook, taking turns when they're level; everything else on the ticket goes where it went before (e.g. the fryer). A ticket's wings always stay together.
- Decided when the order reaches the kitchen (a held course when it's fired), then fixed. **Check a dish** shows "Wingman 1 or Wingman 2". The box has no kitchen screen and nothing to bump; the kitchen test bench shares tickets the same way.
- **Migration 183** (kitchen_balance).

## [2026-10-18 — Take a station out of a kitchen flow]

- **A station can be taken out of one kitchen flow** without deleting it. In Till setup → Kitchen screens, tap the station's box in the flow, then **Take out of this flow**: it leaves that flow with its links, and no dish goes to it while that flow is in use. It shows under **Not in this flow** above the boxes, where **Put back** brings it back. The station, its screens and its settings stay, and your other flows still use it (e.g. a *Grill down* flow without the grill).
- A station out of a flow no longer shows the "isn't on the way of any dish" warning, and the kitchen screens' flow list doesn't name it for that flow. Copying a flow keeps the stations it leaves out.
- **Migration 182** (kitchen_flow_stations).

## [2026-10-18 — Connect Claude and ChatGPT to Pepper by signing in]

- **Claude's custom connectors (claude.ai and the Claude apps) and ChatGPT now connect to Pepper by signing in**, instead of asking for an OAuth client ID and secret. Add the address from Pepper → Connect as a custom connector (leave any client ID and secret empty). A Macaroonie page opens: it names the app and your restaurant group, you choose Read only and how long it works (30, 90 or 180 days, or a year), and tap Allow. You're taken back to the app, connected.
- The connected app shows on the Connect tab with your access tokens as "(connected app)": revoke it there to disconnect it. Someone who isn't in the restaurant group the connection is for can only cancel; with Pepper switched off the page says so.
- Apps that send a header (Claude Code, Cursor) still connect with a token made on the Connect tab, which now explains both ways.
- **Fix**: signing in from a link to any page (not just the Overview) now brings you back to that page afterwards.
- **Migration 181** (mcp_oauth).

## [2026-10-18 — Purchasing: orders that need approval, and splitting orders for another day]

- **Orders can need approval.** A new role permission, **Purchasing approval** (Access → Roles), decides who can place orders. Someone who can order but not approve fills in the order as before, then taps **Send for approval**: they pick the day they'd like from each supplier and can leave a note. Nothing goes to suppliers yet. To make a role request only, set its Purchasing approval to None (owners, admins and operators have it by default, so nothing changes until you do).
- **A second person checks it.** Orders waiting show at the top of the Order tab (the tab says how many to approve). Someone with approval can change any quantity (changed lines show what was asked for), then **Place order** (the days asked for are already picked), **Split for another day**, **Send back** with a reason, or **Decline**. The person who asked can take it back to change it while it waits. A sent-back order shows Sent back and the reason.
- **Split an order into two for different days**: an order waiting for approval becomes two requests, each placed on its own; a placed purchase order gets a second purchase order to the same supplier for the new day, with the same prices. If the supplier already had it, the first one goes back to To send marked Changed, its copy says Amended, and suppliers that take email get both straight away. The two orders link to each other.
- Changing a placed order's quantities, splitting it and cancelling it also need Purchasing approval; sending it, moving its delivery date and booking the delivery in don't. Purchase orders show who asked for them and who placed them.
- **Pepper** follows the same rules: it sends orders for approval for people who can't place them (request_order), lists what's waiting (and the day briefing counts it), and approvers can change, split, send back and place by chat.
- **Migration 180** (purchasing_approval).

## [2026-10-18 — Each device on its own address; Disconnect on every device]

- **Tills, kitchen screens, kiosks and menu screens each have their own address**: tills at pos.macaroonie.com, kitchen screens at **kitchen.macaroonie.com** (kds.macaroonie.com goes there too), kiosks at **kiosk.macaroonie.com**, menu screens at screens.macaroonie.com. Each installs as its own app (Macaroonie Till, Kitchen, Kiosk) and Till setup shows the right address on each tab and in the pairing window.
- **A pairing code only works at its own address.** Typing a kiosk's code on the kitchen address says so and offers a button to the kiosk address, where it pairs by itself.
- **Kitchen screens and kiosks set up on the till address move with one tap**: a yellow bar offers Move this kitchen screen (or kiosk). It sends anything waiting, opens the new address and pairs it there as the same device. Then set the new address as the device browser's start page; the old address forwards there if opened again.
- **Disconnect on every device**: the till's Till tab (Disconnect this till, a manager confirms), the kitchen screen's settings, the kiosk's staff panel (five taps in the start screen's top-left corner) and the menu screen's own settings (five taps on the screen, or five presses of OK on a remote). The device goes back to its pairing screen; Till setup or Screens shows it Not paired with its name and settings kept, ready for a new code. Tills and kiosks never disconnect with sales or paid orders still waiting to be sent.
- No migration.

## [2026-10-18 — Online sales transactions, GloriaFood included, with tender]

- **Every online sale in one list**: Online orders → **Transactions** shows each online order of the venue over the days you pick (today, 7, 30, 90 days or any range up to a year), your own online orders and GloriaFood orders together, with how each was paid: Cash, Card at the counter, Card by phone, Paid online, or not marked paid yet.
- **Totals by tender and by source**: sales, refunded, net, tips and the average order, then the net per tender split between your own online ordering and GloriaFood. Filter by source, by tender, or counted orders only. Tap an order for its type, ready time, tips, discounts, delivery and fees, and VAT.
- **Download CSV** saves every order of the view (money in pounds) for a spreadsheet or your accountant. No guest names or contact details in the list or the file.
- Rejected, cancelled and GloriaFood test orders are listed but not counted. GloriaFood orders sit on the same day Cash Recon puts them (your trading day from the GloriaFood link). No migration.

## [2026-10-17 — Screen designer grid; theme colours and custom colours in every builder]

- **The screen designer's grid button now shows the grid.** The lines were drawn so thin they disappeared at the zoom the designer opens at. They now show at any zoom (spaced out when zoomed out, every fifth line darker), the button looks pressed while the grid is on, and your choice is remembered on the device.
- **Colours offer your website's theme colours, plus a custom colour.** The screen designer (board and block colours), the kiosk designer, menu tag colours and the booking email editor's text colour show your website's theme colours as swatches to tap, then a custom colour (your device's colour picker or a typed code like #f5b301). The kiosk designer also has a **Website colours** set to start from.
- **The website builder's colours get a custom colour too**: after the seven theme colours, the rainbow swatch picks any colour. Theme colours still follow the theme; a custom colour stays as chosen.
- **Fixes**: the website footer ignored anything but a theme colour; a promo block on a light custom background now uses dark text; the reservations widget's confirmation buttons set in Reservations widget settings lost their colour. No migration.

## [2026-10-17 — Fix: Pepper answering about the wrong day]

- **Pepper said "the app's clock says today is Saturday 10 October" and gave last Saturday's orders.** The app's clock was right: Pepper had no way of knowing the date unless it looked the venues up first, so for one question it guessed a date and then blamed the clock. Every message to Pepper now tells it today's date and the time at your venues (each venue's own when they are in different time zones), and the day overview it uses for bookings looks at today unless asked for another day. No migration.

## [2026-10-17 — Fix: a kiosk asking for a PIN after pairing; tills update themselves]

- **A kiosk paired on a device that had opened the till address before kiosks arrived showed the till's PIN screen**, and typing a PIN gave "Cannot read properties of undefined". That device was still running the older copy of the till app it kept for working offline, which didn't know kiosks. Reloading the page fixes such a device. The app now also asks the server what each device is (till, kitchen screen or kiosk) and opens the right screens even if an older copy saved it wrongly.
- **Tills, kitchen screens and kiosks pick up new versions by themselves**: each fetches a new version in the background and switches to it at a quiet moment (a till when nobody is signed in, a kiosk back on its start screen, a kitchen screen nobody has touched for 30 seconds). Before, a device kept the old version until someone closed and reopened it. No migration.

## [2026-10-17 — Test the kitchen: every kitchen screen on one page]

- **Try your kitchen flow before service**: Till setup → Kitchen screens → **Test the kitchen** opens a new window with every kitchen screen of the venue side by side, scaled down. They are the real kitchen screens working on pretend orders: nothing reaches the kitchen, the tills, the online orders board or the reports.
- **Send test orders**: build one (dishes, till or online, order type, revenue stream, table or counter, later courses held until you fire them), send a made-up one, or five at once. Then tap and bump on the screens as in the kitchen.
- **See where every dish is**: the Orders list shows each dish's way through the stations (done, there now, still to come), the order ready boards' numbers, and lets you void a dish. Activity lists every tap and which screen made it.
- **Switch the flow, take a screen offline**: try another kitchen flow (new orders go the new way), see a screen's taps wait while it's offline and go when it's back, show screens as set up or one per station, as a tablet, TV or upright screen, one bigger.
- View on Till setup is enough to open it. No migration.

## [2026-10-17 — Fix: custom domains taken offline after the last update]

- **Custom domains (e.g. onethai.com) came back with a certificate warning** after the previous update. The server job that keeps custom domains switched on reads the saved domains from the database; the tighter database protection in that update hid them from it, so it took every custom domain off the server and deleted its certificate. The job now reads them the way the app's own background jobs do, and it no longer changes anything when it can't see any websites at all.
- **Nothing to do in the admin**: once this is deployed, the job switches the domains back on within a minute or two and gets new certificates. The Domain section in Website shows the progress.

## [2026-10-17 — Pepper: help answers, your day in one go, ask about this page]

- **"How do I...?" answered from the Help guide**: ask Pepper how to do something in the app ("How do I set up tip pots?", "Where do I add a fridge?") and it answers from this app's own Help guide, with a link straight to the part that covers it. If the guide doesn't cover it, Pepper says so instead of guessing.
- **Your day in one go**: "Brief me on today" (or another day or venue) gives bookings and big parties, who is working, health & safety checks still due and readings out of range, supplier deliveries due, yesterday's cash-up, online orders still open, sold out dishes, failed booking emails and offline menu screens, leading with what needs doing. Parts your role can't see are left out and named.
- **Ask about the page you're on**: Ask Pepper from the sidebar now knows which page is behind it and the venue and day or week it shows, so "who is on this week?" on the Rota or "what's still to do?" on Food safety needs no venue or date. A label above the message box shows what Pepper is told; tap it to stop for that chat.
- Help subsections can now be linked to directly (/help#tip-pots).

## [2026-10-17 — Encrypted integration keys, connector tokens that expire, a tool list per person]

- **Keys stored encrypted**: the Anthropic key, Loyverse tokens, GloriaFood poll keys and email provider keys and passwords are now stored encrypted with a key kept outside the database, so a leaked database copy doesn't give them away. Keys already saved are encrypted when the server starts. Every deploy adds the encryption key to the server's settings file when it is missing: back that file up, because without it the saved keys would have to be typed in again.
- **Booking emails → Settings**: saved keys and passwords are never shown again. A saved one shows as "Saved, ends 1a2b"; leave the box empty to keep it, type a new one to replace it, or press **Remove** and Save to take it off. The AWS SES secret access key is stored in a field of its own now (moved automatically).
- **Pepper connector tokens expire**: when you make a token, pick how long it works (30, 90 or 180 days, or a year; 90 to start with) and whether it is **Read only** (it can look things up, never change anything). The list shows until when each works, and **Expired** after that. Tokens made before today work for 90 more days.
- **Your AI app only sees the Pepper tools you can use**: the areas your role can see, and the tools that change things only where your role can change them.
- Migration 179.

## [2026-10-17 — GloriaFood orders on the kitchen screens]

- **GloriaFood orders can go to the kitchen screens**, like your own online orders. In Till setup → Kitchen screens → Online orders (shown when the venue is linked to GloriaFood), tick **Send GloriaFood orders to the kitchen screens** and Save. Accepted orders come on as GloriaFood sends them, with an orange GloriaFood label, GloriaFood's order number, the customer's first name, the table number for dine-in, notes and the dishes with their options. Test orders come on too, marked "GloriaFood test order".
- **Dishes follow your kitchen flow**: each GloriaFood dish is matched to your menus by name (capitals and spaces don't matter) and shows under your menu's name, so dish and section links apply; a dish with no match goes by the order type and the links for every dish. Pick which of your order types each GloriaFood type counts as (Pickup, Delivery, Dine in, Order ahead, Table reservation); they start matched by name.
- **Orders for later** come on the minutes you set before their time (20 to start with), listed under Later until then.
- **Ready and collected**: READY at the pass marks the order Ready on the Online orders board and Collected marks it Collected (with Mark them ready when the kitchen finishes on). Ready or Collected on the board, or a cancellation in GloriaFood, takes it off the kitchen screens. GloriaFood itself isn't told.
- Off until you switch it on. Imported orders, orders that arrived while it was off, and orders more than two hours past their time don't come on.
- Migration 178.

## [2026-10-17 — Several kitchen flows, switched from the kitchen screen]

- **Kitchen flows**: Till setup → Kitchen screens now keeps several named flows per venue (a busy night, a quiet night with one cook, the grill down), one in use. Above the designer, the flow names pick the flow to look at (a green dot marks the one in use); **New flow** starts an empty one, **Copy** starts from the flow you're looking at, **Order** (drag) sets the order kitchen screens list them in. The box on the right puts the flow **in use** after a confirm, renames, copies or deletes it (the flow in use can't be deleted). Each flow saves on its own.
- **The flow button on the kitchen screen**: with more than one flow, a button at the right of the top bar shows the flow in use. It lists the flows with the stations each one uses; **Switch**, then **Yes, switch**, sends new dishes that way for the whole kitchen. Dishes already on the screens stay where they are. Every other kitchen screen shows the new flow straight away with a note saying who switched. Switching needs the internet. Each kitchen screen has a **Can switch the kitchen flow** setting in Till setup (on to start).
- Each venue's existing flow became "Main flow", in use.
- Migration 177.

## [2026-10-17 — Menu editor: Publish button beside Save]

- The menu editor's **Publishing** card is now a **Publish** button next to Save. A small badge on it shows how many changes aren't live yet (a dot when the menu has never been published, a clock when a publish is scheduled). It opens the Publishing window with everything the card had: what changed, Publish now, Schedule, Preview print, Discard changes, a scheduled publish with Cancel, and the history with Copy into editor.
- The button is highlighted once the draft is saved and has changes to publish. View-only users see the same window without the buttons that change anything.
- No migration.

## [2026-10-17 — Row-level security that holds for the app's own database role]

- **Each restaurant group's data is now walled off by the database itself**, not only by each page's own checks. Until now the database's row-level security never applied to the app (it owns the tables), so a page that forgot its restaurant filter could have read another group's rows. Every table that belongs to a restaurant group now enforces it: a query sees only its own group's rows. Pages and services that find the group themselves (website pages, the booking widget, online ordering, tills and screens, GloriaFood pushes, Pepper's connectors, background jobs, the platform pages) do so in a separate, clearly marked mode.
- Fixed: the booking widget's venue details call failed every time (it read a deposit setting that doesn't exist).
- Before deploying: every restaurant table must belong to the app's database user. If any were created by hand as another user, the deploy stops and lists them with the command that fixes it.
- Migration 176.

## [2026-10-17 — API tests in the repo: the cross-tenant sweep, and what it found]

- **API tests** (`npm test` in `api/`, and a new CI job on every pull request): the real app against an empty test database, with two restaurant groups made through the API, a stand-in login and a stand-in Claude. The **cross-tenant sweep** calls every admin route that takes an id as one group with the other group's ids (and its own ids mixed in, about 53,000 calls), sends every change the first group made again as the second, and then checks that nothing was read, changed or pointed at across groups. Pepper's chat loop (streaming, routing, refusals) has its own test.
- **Fixed, found by the sweep**: one restaurant group could make records that pointed at another group's: fridges, check times, hold stations, cooking sessions, deliveries, checklists and reviews on another group's venue; a table in another group's room; a table combination of another group's tables; a dish with another group's option group; a staff member with another group's role; a Cash Recon day or wage week using another group's income sources, payment channels, service-charge sources or staff (a wage default even showed their names and pay); online ordering offering another group's menus; a sitting added to another group's special-date opening hours; translations for another group's dishes. A venue named anywhere in a request now has to be the group's own (checked for every page at once), and each of the other cases checks its ids.
- No migration.

## [2026-10-17 — Pepper streams its answers and uses a faster model for everyday questions]

- **Answers appear as Pepper writes them**, in Ask Pepper, the Pepper page, the phone app and the website chat, with a line saying what it is doing (thinking, looking something up, getting a card ready). A card that arrives mid-answer can be pressed once the answer is done. A message typed while Pepper is working stays in the box.
- **A dropped connection no longer loses the answer**: the chat says so, shows "Still working on the last message" until Pepper finishes, then shows the answer. Long jobs can now run up to about ten minutes before Pepper asks you to say "carry on".
- **Faster, cheaper everyday answers**: chats start on a faster model and move to the most capable one for photos and files, building a menu, importing a price list, long chats, or anything the faster one won't answer, and stay there for the rest of that chat. Usage is counted at each model's own price, so everyday questions use far less of the monthly allowance. The Platform page shows both models. Server setting `AI_MODEL_FAST` (empty = every chat on `AI_MODEL`).
- Fixed: when Pepper stopped early ("This is taking a while", too many steps) or couldn't help, that message never showed. A request Pepper can't help with is now left out of the chat, so it doesn't get in the way of the next one.
- Migration 175.

## [2026-10-17 — Pepper: longer jobs, fair use, privacy; fresh-database builds]

- **Long Pepper jobs no longer show an error after a minute.** The server now gives Pepper's chat 5 minutes to answer (other pages keep 1 minute). A job that runs past about four minutes stops between steps and asks you to say "carry on". Installed by the deploy.
- **Big menus from a photo** go in batches of up to 50 dishes: a card that makes the menu with its first sections, then a card per next section or two, all in one reply; press them in order. Price lists read from a PDF or photo go up to 100 products a card. Before, a large menu was cut off half way.
- **One message at a time per chat**, however many servers answer: a second message, or a card's button pressed while Pepper is still working, says to wait instead of mixing the two up (which could break the chat for good).
- **Usage counts what replies cost**: what Pepper writes counts five times and the earlier part of a chat it reads again a tenth or less, so long chats no longer eat the allowance by their size. The monthly allowance and the Platform page are in these units.
- **Fair use and privacy** (Pepper → Settings, owners and admins): each person's **daily share** of the month's allowance (10%, 25% or 50%, or no limit; 25% to start) so one busy day can't stop Pepper for everyone, and **how long chats are kept** (30, 90 or 180 days, or a year; 90 to start). **Who uses it this month** lists each person's use and today against their share; others see their own line.
- **Guests' details in chats**: anonymising a customer now also removes their name, email and phone from Pepper's chats, the website chat and Pepper's Activity, and closes the chats they were removed from (read only, with a Start a new chat button). Activity details are cleared after a year; unsent uploads and used guest codes after a day.
- **Cash Recon**: a submitted day's expenses can no longer be changed or deleted (adding was already blocked) until the day is unsubmitted.
- **Issue log**: platform admins see the restaurant group they are in, with an **All restaurant groups** button for every group's issues.
- Fixed: marking a dish sold out accepted any id (now only your own dishes, draft or live); a malformed id in an address gave a 500 instead of "not found"; refused requests filled the error log (now one warning line each); Pepper could place a supplier order for a later delivery day than its card showed when a cutoff passed in between.
- **Migrations build on an empty database again** (three old migrations stopped a new environment; pg_cron is now optional), checked by a new CI workflow on every pull request with the shared unit tests.
- Migration 174.

## [2026-10-17 — Pepper, the assistant for every area]

- The staff AI assistant is now **Pepper**: **Ask Pepper** in the sidebar, the **Pepper** page, Pepper in the phone app and on the Overview shortcuts. The website chat and guests' AI apps keep a neutral name.
- Pepper now works in **every area**, with each person's own permissions, in the chat and through the staff connector for AI apps (Claude, Cursor and others):
  - **Staff and the rota**: who's working, a week's rota, put people on or off, sick or on time off (several people and days at once), copy a week, staff details, leaving dates and periods off the rota, pay and tips for a week, pay adjustments, fill Cash Recon wages, move or adjust tips, tip pot amounts.
  - **Cash up**: a day or a week with its variance (the page's own figure), enter figures, add an expense, submit a day, see and mark wages paid, fill from Loyverse or GloriaFood.
  - **Online orders**: the day's orders, accept / preparing / ready / collected / turn down / cancel / retime / paid at the counter (GloriaFood orders too), refunds, pause, the report; **sold out** for the tills, online ordering and menu screens at once.
  - **Till and kitchen**: a trading day's figures, its checks, kitchen speed.
  - **Customers**: find, details with bookings, change, newsletter unsubscribe, GDPR anonymise.
  - **Opening times and setup**: booking times, close for dates (with how many bookings are already in them), reopen, tables, booking rules.
  - **Website and more**: publish status and publish, the emergency banner, promotions on or off, reviews (approve, feature, reply), menu screens (status, reload), booking emails sent, report an issue, list issues, request a feature.
  - **Finding a page**: Pepper replies with a link to the page that does the job, only pages the person can open.
- Every change still shows a card first with what will happen and nothing changes until Confirm; every change is listed under Pepper → Activity. A card now does exactly what it shows even when Confirm is pressed later: the day, week, order, check time or refund amount on it is kept, so a cash up confirmed just after midnight still submits the day on the card, and a refund changed on the board in the meantime is refused instead of refunding a different sum.
- Pepper has its own switch on Access → Modules (it was part of Bookings).
- Fixed (security): on the online orders board, another restaurant group could open an order's details, its report, change its status or refund it by its id; and the schedule, venue settings and test data routes took a venue id from another restaurant group (close weekdays, add sittings, change booking rules, add tables, read the schedule). Both now check the order or venue is the caller's.
- Migration 173.

## [2026-10-17 — Self-order kiosks]

- New **self-order kiosks**: a big touch screen guests order on by themselves, upright or wide, in Chrome. A start screen with your pictures and videos, flags for nine languages, Staying or going? with your order types, and an allergen lookup; a menu with sections down the side, a home page of banners and featured tiles, and dish cards; each dish and combo built step by step with its allergens; an order page with "Anything else?", a name or table number when the revenue stream asks, and pay by card or at the counter; then the order number. "Still there?" after a while with no taps, a reach button for guests who can't reach the top of the screen, sold out dishes greyed out at once.
- **Four ways to show choices**: grid, list, a slider with a level scale (No spice ... Very spicy, marked with flames, stars or dots) and a spin wheel. The kiosk design sets the default; each option group and each combo step can pick its own.
- Kiosk orders are counter orders like the till's: they go to the kitchen and its flow, the tills' Counter list, Till reports (with the kiosk named) and Cash Recon. A kiosk can only place its own orders and take card payments; card payments use a test reader for now (no money taken).
- **Till setup → Kiosks**: add a kiosk (name, revenue stream, design, card reader, receipt printer) and pair it with a code at the till address. **Kiosk designs**, shared by every venue, are edited on their own page with the kiosk itself beside the settings, showing every change as you make it: brand colours (with ready-made sets and a warning for colours hard to read together), fonts, logo, the start screen, languages, the menu home page, sections left off, choices, paying and timing. Explicit Save.
- **Menus → Variant groups**: a Self-order kiosk box (how the options show, the words at the two ends of a scale), and on each option a picture (pick one or drop one on it), a line of words and a level from 0 to 5. Options now drag into order.
- **Combos**: each step can say how a kiosk shows its choices; a choice typed in for a combo can have a picture and words.
- New **Menus → Translations**: every word a kiosk can show next to its translation in the language you pick, with the kiosk's own words and the 14 allergens already in every language. **Suggest the missing ones** asks the AI assistant for a first draft; suggestions are marked Check and nothing is kept until Save.
- If the internet goes, a kiosk pauses new orders; a card order already paid is kept and sent when the internet is back, and the guest shows the kiosk's own number at the counter. A pay-at-counter order is never sent twice when its reply is lost.
- Media uploads are now allowed with Till setup manage (for kiosk pictures).
- Fixed: a new option group's options came back sorted by name instead of the order they were typed in.
- Migration 172.

## [2026-10-16 — Combos]

- **Combos**: any menu item can be a combo (Dish / Combo at the top of its panel). It has its own price (it can be £0) and **steps**, each with at least / at most (at least 0 = optional), **the same choice more than once**, **pick it by itself when there's one choice**, **show a button** instead of opening an optional step, and **when it shows** (only after a pick in an earlier step, e.g. a sauce pot only with fries). Choices are dishes from the menu, whole sections, or choices typed in just for the combo (with a kitchen name), each with an extra charge. A picked dish still asks its own options at its own extra prices. Drag to order steps and choices; the panel shows "Shown as from £x" and anything that stops the combo working.
- **Manual or Automatic**: a manual combo is used when chosen (its button, or **Make it a combo** on a till line); an automatic one also applies by itself when an order has its dishes as separate items, on the till and online, whenever that makes the order cheaper. The items stay as entered and the saving shows as a line.
- **Till**: combos open with a chip per step, steps behind buttons, Included steps and each dish's options under it; Add says what's missing. The check, receipts, kitchen tickets and kitchen screens show the combo with its parts under it, each part going to its own station.
- **Online ordering**: one step at a time with Back / Next, then a last page with the whole combo; the basket, status page, emails and the orders board list the picks.
- **Website, printed menus and menu screens** show a combo's description and price, with "from" when choices can cost more. Menu screens' Menu list and Featured dish blocks can instead show **How to order (steps)**.
- **Option groups** (Menus → Variant groups): **The same option more than once** (2 x Extra cheese, with − and + on the till and online) and **Don't open it by itself: show a button for it** for optional groups. Repeats show as "2 x Cheese" everywhere.
- The till's meal deals became combos (their slots are steps); nothing to redo.
- Migration 171.

## [2026-10-16 — Tax rates, order types and revenue streams]

- New **Menus → Tax rates**: your list of rates (Standard 20% and Zero 0% to start), one marked default, each with its own % at a location if it differs. **Check** shows every dish's rate for each order type at a location and revenue stream, as the till, online ordering and the Deliveroo file work it out.
- Tax is now set on the **menu**, the **section** and the **dish** (a Tax box in each), the dish's setting winning over its section's and the section's over its menu's. Each setting can have **exceptions**: a different rate for some order types (e.g. Take out, Delivery and Collection at 0% for cold food), a location or revenue streams. Two exceptions that clash are flagged and Save stays off. Tax changes go live when the menu is published. The dish and section eat-in / takeaway VAT boxes and the VAT defaults in Till setup and Ordering setup are gone; existing rates were moved over (eat-in % as the rate, takeaway % as a takeaway exception).
- New **Till setup → Order types** (for every location): Eat in, Take out, Delivery, Collection and any you add, with a colour; drag to order, remove and put back.
- **Revenue centres are now revenue streams**: groups of tills for reporting sales by place or device. They no longer decide VAT. Each picks which order types its tills offer, and for each whether to ask for a **customer name** and a **tent number** (No, Ask or Must), and the type new checks start as.
- On the **till**: counter orders start by picking the order type and typing the name or tent number if asked; More → Order type changes a check's type (its items take the new type's tax) and More → Tent number sets the tent; a detail the type must have is asked for at Send and Pay. The name now shows in a counter order's header. Kitchen tickets, receipts and the kitchen screens show the order type, name and tent; the kitchen screen's tabs are your order types.
- **Online ordering** (Ordering setup): pick the order type collection orders count as (Collection to start with) and optionally the revenue stream online sales count under. **Deliveroo file**: pick the order type for VAT (Delivery to start with).
- **Kitchen flow** links filter on your order types and revenue streams.
- **Till reports**: sales by revenue stream and by order type on each day; a check shows its order type, name, tent and stream, and its history names type changes.
- Fixed: the section and dish panels on the Menus page didn't scroll, so anything below the fold (now the Tax box) couldn't be reached on a smaller screen.
- Migration 170.

## [2026-10-16 — Kitchen flow designer, runners and order ready boards per expo]

- New **Kitchen flow** in **Till setup → Kitchen screens**: draw how dishes move through the kitchen. Boxes for Orders in and every station; drag a box's dot onto another box (or tap the dot, then the box) to send dishes on to it, and tap a link to choose which dishes take it (dishes, sections, revenue centres, order types). From each station a dish takes the links that name it most closely, so a burger bun can go Prep 1 → Prep 2 for the meat while the fries go Prep 1 → Expo 1, and Prep 3's dishes go to Expo 2. **Check a dish** shows a dish's way; a way round in a circle can't be saved; **Tidy**, full screen, explicit Save.
- Four kinds of station: **Prep**, **Expo** (the pass), **Runner** (takes orders out) and **Order ready board** (shows numbers on menu screens). An expo can send to a board and a runner at once, or to a runner that then sends to the board; a runner can be for eat in only.
- Kitchen screens follow the flow: a dish comes onto the next station when the one before bumps it ("From Grill"), dishes going different ways say where they go next, the expo shows each dish where it is now ("At Fryer") and its READY finishes dishes still at earlier stations, a line shows when some of the order goes through another expo, and a runner gets the order once the expo is done (**DONE**; when the runner is the last step it hands the order over). A station can't bump what hasn't reached it, or bring back what the next station has already done. Prep timers start when the dish reaches the station.
- New station option **Show orders before their dishes get here** (on for expos).
- **Order status block** (menu screens): pick an order ready board by name (e.g. ORB 1: ready once both expos are done), Preparing and Ready side by side or one above the other (Ready first if you like), a colour for the preparing box, and an animation when a number changes: float over, fade, pop or zoom.
- Fixed: an Order status animation could be skipped when the screen drew the board in the same millisecond as the change.
- Existing routing became the flow: each station's dishes come in from Orders in as before, and every prep station sends on to every expo. Kitchen orders in progress are cleared.
- Migration 169.

## [2026-10-16 — Kitchen screens (KDS) and an order ready board]

- New **kitchen screens**: Android tablets or TV boxes in Chrome show the orders to cook. Set up in **Till setup → Kitchen screens**: stations (Grill, Fryer, Bar ...) and the pass, amber / red times per station, what goes where (like printers), the screens (paired with a code at the till address, each showing one or more stations), and online orders.
- On the screen: tickets left to right, oldest first, with a timer that turns amber and red; table, order number, eat in or takeaway, covers, server, notes, allergies, options and removals. Tap a dish to mark it done, pick a ticket and **BUMP** it. **The pass** sees whole orders, shows which stations it is waiting for, and marks orders ready, then collected. **Rush**, **SUM** (how many of each dish are on order), **Prev** (bring back a ticket bumped by mistake), **Remake** (with a reason), an **On order** counts view (e.g. wings by the piece), filters for eat in / takeaway / online, speed figures along the top, orders for later, text sizes, full screen, a beep for new orders, and bump bar / keyboard keys.
- Held courses wait until fired; voids show crossed out; dishes moved or merged on the till move on the kitchen screen too.
- **Online orders** go to the kitchen when accepted (orders for later come on when it's time to start them); when the pass marks one ready, the online order is marked ready and the guest gets the email (both can be switched off).
- Kitchen screens keep working through a short internet drop: they keep their tickets and save taps until the connection is back. Kitchen and till without the internet needs the venue hub (later).
- **Order ready board**: a new **Order status** block for menu screens (Screens → board designer) shows order numbers being prepared and ready to collect, and changes as the kitchen bumps them.
- **Till reports → Kitchen**: speed of service per station (tickets, dishes, average, middle, 9 in 10, slowest, on time, late), the average by hour, remakes with reasons, and a CSV of every bump and remake.
- Fixed: in Till setup, tapping the label of a row of buttons (e.g. "Opens in", "Used for", "VAT") pressed the first button and changed the setting.
- Migration 168.

## [2026-10-16 — Menu screens: video, walls, transitions and animation; dropping photos into the editors]

- **Video on boards**: a Video block plays a video from Media on a loop (sound off unless ticked). Media now takes MP4 and WebM videos up to 150 MB. Each screen keeps a copy, so videos play without the internet. In a playlist, **Video length** shows a board for exactly as long as its video.
- **Scrolling text** block: a line of text moving across the board, with speed, gap and direction.
- **Animation**: any block can come on with a movement (fade, rise up, drop down, from the left or right, zoom, pop, wipe) after a delay, and keep moving while on (pulse, float, swing, slow zoom, blink). **Play** in the designer shows the board as the screens will; the board can replay its entrances every so many seconds.
- **Transitions**: each board in a playlist comes on with a cut, fade, slide, zoom or wipe at the speed you pick. The playlist **Preview** plays the boards with their transitions.
- **Walls**: several screens side by side (or stacked) show one board between them, as one picture, with a gap for the frames. **Walls** tab: grid size, which screen goes where, the gap, **Make a board this size** (the designer then shows where the screens meet), and a preview of each screen's part.
- Screens now keep in step: they set their clocks from Macaroonie, so screens with the same playlist (and every screen of a wall) change boards, play videos, move scrolling text and run transitions at the same moment.
- A screen that has been offline picks up changes as soon as it is back, instead of within a minute.
- **Dropping photos from your computer**: onto a board (onto a picture or video block to replace it, anywhere else to add one, the photo's own shape), onto a menu print design page, onto the website page builder (onto an Image, Hero or Story block to use it there, onto any other block to add an Image block after it), and onto any picture field (website settings, block settings, dish and section photos on the Menus page). Dropped files go into Media; the same file dropped twice is kept once. A file dropped anywhere else no longer opens in the browser over the admin.
- Fixed: in the board designer and the menu print designer, pressing on a photo and dragging didn't move the block (the browser started dragging the picture instead). On iPads, pressing on a photo no longer brings up the picture menu.
- Fixed: the website page builder's grip handle (drag to reorder blocks) never appeared. It now shows when you point at a block, on the selected block, and always on touch screens.
- Fixed: turning a screen (Mounted) or changing its fit didn't reach the screen until the board changed.
- People who manage Screens (but not the website or menus) can now upload to Media.
- Deploy: a new nginx step lets the two Media upload addresses take files up to 160 MB.
- Migration 167.

## [2026-10-16 — Menu screens: digital menu boards]

- New **Screens** page (Website in the menu, module Menu screens): put your menus on screens in the restaurant. Any Android TV box or stick, smart TV with Chrome, tablet or PC works, installed from Chrome (full screen) or in Fully Kiosk Browser.
- **Adding a screen**: open screens.your-domain on it, it shows a six-letter code; press **Add screen** and type the code. Each screen has a name, an ID (S1, S2 ...), a venue, its own size, how it's mounted (turned for a screen on its side) and what it shows. **Identify** shows its name on the screen; **Reload**; **New device for this screen**; online / last seen and what it is showing now.
- **Board designer**: boards of any size (Full HD, 4K, portrait or landscape, or your own). Blocks: menu list (a section or picked dishes, with prices, options, tags, calories, 1 to 4 columns), featured dish with its photo, a lone price for photo designs, heading, text, image, box or line, clock, allergen key. Drag to move, corner to resize, snap grid, layer order, colours and fonts (website fonts plus bold menu-board fonts), £ sign and whole-pound prices. Live or draft prices and a venue's sold out dishes in the preview.
- **Playlists**: boards take turns for the seconds you set, with times of day and dates per board (breakfast, lunch, dinner); nothing on = a black screen.
- Prices on screens are the published menus: publishing (now or scheduled) changes every screen within seconds. Sold out dishes are crossed out (or left out) as soon as they are marked.
- Screens keep showing their boards, photos and fonts when the internet drops, and pick up changes when it is back.
- **Till: sold out**: hold a dish down (or tap a sold out one) to mark it sold out for today or until put back, or back on. It shows on every till, online ordering, the Online orders board and the screens. New till role permission **Mark dishes sold out** (on for Supervisor and Manager); others need a manager's PIN.
- Fixed: the times-and-dates editor (Ordering setup, Promotions) showed "{datesLabel}" and "{resetLabel}" instead of its labels.
- Migration 166.

## [2026-10-16 — Menus: publish changes now or at a set time]

- Saving a menu now saves a draft. The website, online ordering, the till, the Deliveroo menu file, cooking check dish buttons and the allergen lookup keep showing the live menu until you publish.
- **Publishing** card at the top of every menu: what is live, every change waiting to go live (price changes, dishes added and removed, sections, notes), then **Publish now** (asks first), **Schedule** (a date and time; it switches by itself within a minute of that time), **Preview print** (the draft), **Discard changes** (puts the live menu back into the editor) and **Publish history** (preview or copy back an earlier version). Scheduled publishes can be cancelled before they go live.
- Menus list: LIVE, LIVE · CHANGES NOT PUBLISHED, NOT PUBLISHED, GOES LIVE (with the time) and HIDDEN FROM GUESTS chips. Print on the list prints the live menu; Print in the editor and Preview in the menu designer print the saved draft. Deleting a menu now asks on the page instead of in a browser pop-up.
- Staging websites show the draft, so menu changes can be checked on staging first.
- Every menu that existed is published as it is when this goes out, so nothing disappears. A new menu isn't live anywhere until its first publish.
- Ask AI: menu changes say they are in the draft; new **publish** (now or at a time) and **cancel a scheduled publish** with a confirm card listing the changes. Allergy questions read the live menus.
- Fixed: the website menu block now shows calories (they were dropped on the way to the page).
- Migration 165.

## [2026-10-15 — Staff: leaving dates and periods off the rota]

- **Staff > a person > Leaving**: set their last working day (and a reason if you like). From the day after they are off the rota: later weeks don't show them, and the week they leave in shows their remaining days as LEFT. Earlier weeks still show them, with their shifts, pay and tips. If they were already on the rota after that day, the app says how many entries that is and asks before taking them off. Clear leaving date puts them back (entries already taken off aren't restored).
- **Staff > a person > Off the rota**: add periods (from and to date, reason) when someone can't be rostered, such as long leave or a season away. Those days show as AWAY on the rota and can't be tapped; someone away the whole week is listed under the grid in "Off the rota all week". Their entries in the period are taken off when it is added (the app asks first). Periods can't overlap. Paid holiday still goes on the rota as PTO.
- Staff list: Last day / Off rota badges, and people past their last day move to a Left group at the bottom.
- Rota: Copy from week skips shifts that would land on those days; the printout and image show them as Left or Off rota. Hours, pay and tips leave out someone off the rota all week unless they have money that week.
- Wages: people who left before a week aren't put on its new wage list or offered in Add person.
- Till: someone past their last working day can no longer sign in.
- Migration 164.

## [2026-10-15 — GloriaFood: see the orders behind the figures]

- **Cash Recon day > GloriaFood orders**: every GloriaFood order on that trading day (counted the same way as Fill from GloriaFood), with the orders counted, order totals, tips and the total by payment method. Tap an order for its times and amounts (subtotal, delivery fee, service fees, tip, tax, how it was paid); orders GloriaFood sent directly also list their dishes. Cancelled, rejected and test orders are listed but crossed out. Imported orders are marked Imported, with the file and line they came from. Arrows step to the next or previous day. Shown on submitted days too, and to people who can only view Cash Recon. No customer details.
- **Online orders board**: on past days, orders imported from GloriaFood's export now show (when "Show GloriaFood orders on the Online orders board" is on) under Done, which opens by itself on a past day. They carry an Imported label and can be looked at but not moved or printed. Today's board never shows them.
- The board's order count and total no longer include GloriaFood test orders.
- No migration.

## [2026-10-15 — Purchasing: tidier order lines, choose what each line shows]

- The pack you're ordering (Case, Box, Bag, with its size) now sits next to the quantity, in larger type. When another supplier sells the item, tap the pack to switch.
- Supplier, price, last order and a new Last quantity column (at the end of each line) are hidden until you switch them on with **Show**. Each device remembers the choice. Price is offered only to people allowed to see prices.
- On phones, Par and the remove button sit beside the item name, so the pack, quantity and last figure stay on one line.
- No migration.

## [2026-10-15 — GloriaFood import: picking a file no longer blanks the screen]

- Cash Recon settings > GloriaFood > Import past orders: choosing a file could leave the whole window blank (menu included) until Back was pressed. The hidden file input behind the Choose file button sat far below the screen, and when the browser put focus back on it as the file dialog closed, the window scrolled the app out of view. Hidden inputs now stay on screen, so the preview shows as it should.
- The same fix covers the other hidden inputs in the admin (the colour pickers on Settings, the module switches on Access).
- No migration.

## [2026-10-15 — Admin: a page that crashes shows a message, not a blank screen]

- If something on a page fails while it is being shown, the admin (and the phone app) now shows "This page stopped working" with the error and a Reload page button. Before, the whole admin went blank. The menu stays usable, and moving to another page clears the message.
- GloriaFood > Import past orders: if the server's reply isn't what the import expects, or the browser can't read the chosen file (for example a OneDrive or iCloud file not downloaded yet), the card now says so instead of showing nothing.
- No migration.

---

## [2026-10-14 — Admin: service worker error in the console]

- The admin's browser console showed "Uncaught (in promise) non-precached-url ... /index.html" on every page since 22 August. It came from the app's offline helper (service worker) and didn't affect any page, but it hid real errors. Fixed.
- No migration.

---

## [2026-10-14 — Guestplan block uses Guestplan's own button]

- The Guestplan booking block no longer puts its own "Book a table" button on the page. That button was meant to open Guestplan's form in one tap, but on the live site it didn't open the form and sent visitors back to Guestplan's own button for a second tap.
- Guestplan now loads with the page and shows its own floating booking button and form. The catch, which is why the old option existed: on a computer Guestplan may open its booking form by itself when the page loads.
- The "Start closed" option is gone from the block. Blocks that used it also lose their heading, because there the heading was the button's label and would otherwise suddenly show on the page. A Guestplan block with no heading no longer leaves an empty gap where it sits.
- Migration: `163_guestplan_own_button.sql` (removes the old setting from saved and published pages).

---

## [2026-10-14 — Import past GloriaFood orders]

- Cash Recon settings > **GloriaFood** > **Import past orders**: import the order list exported from GloriaFood's admin, so Fill from GloriaFood works for days before the venue was linked (GloriaFood's own link has no history). Choose a CSV or Excel file and the window shows what it found before saving: orders to add, dates, the accepted total by payment, rows it can't use with their row numbers, and any figure your mapping uses that the file doesn't have.
- Columns it must have: **Order ID**, **Outcome**, **Total**, and **Fulfillment date + Fulfillment time** (or **Confirmed date + Confirmed time**). Worth including: **Payment method** and **Type**. Subtotal, taxes, tips, delivery fee, service fees, cash discounts, channel, currency and card type are used when present. Column order doesn't matter. **Template** downloads an empty file with every column it reads.
- Guest names, emails, phone numbers, addresses and comments in the file are never read. Orders GloriaFood sent directly are never changed, rows from when they started arriving are left out, and importing the same file again updates it instead of adding twice. Imported orders don't appear on the Online orders board. **Remove imported orders** takes them out again.
- The export has no dishes or discounts, so Items before discounts and Discounts are £0 on imported days.
- The fill window no longer says no GloriaFood orders exist when only imported ones do.
- Migration: `162_gloriafood_import.sql` (`gloriafood_orders.received_via` allows `import`; `gloriafood_venue_links.last_import_at` / `_by` / `_file`).

---

## [2026-10-14 — View and Manage on every page]

- Every area now follows the same rule as the dashboards: **View** opens the page to look things up, **Manage** is needed to change anything. With View the change buttons are hidden or greyed out and a blue "View only" bar says so; the app also refuses the change if it is tried another way. This covers Cash reconciliation (week grid, each day, wages, expenses, settings, the phone pages), Food safety, Checklists, the H&S action log, Timeline and Bookings, Tables, Rules, Schedule, Venues, Customers, Menus (and option groups, allergens, the print designer), Online orders and Ordering setup, Till setup, Floor plan and Till reports, Website, Reservations widget, Reviews, Media, Emails, Staff, Rota setup, Issue log, Feature requests and Test data.
- Pages that used the older fixed roles (Owner / Admin / Operator / Viewer) now follow each role's View / Manage settings in Access → Roles, so custom roles work there too. A few changes still also need an Owner or Admin login: Cash Recon settings, unsubmitting a day or week, deleting a booking and refunds. Removing an email suppression needs the Owner.
- What changes with the built-in roles: Operators can now only look at customers (no more editing, importing or unsubscribing; anonymise and export were already Owner / Admin). Viewers can now look at customers, and can no longer add bookings or change booking notes, which they could before. Change any of this in the role's matrix if it doesn't suit.
- Email settings no longer show the provider's API key or password to people with View.
- Tenants created since roles were introduced had no built-in roles stored, so roles couldn't be edited for them; every tenant now has the four built-in roles.
- Fixed: the Feature requests list and upvoting failed with a server error for everyone.
- Migrations: `160_builtin_roles_every_tenant.sql` (adds the four built-in roles to every tenant that lacks them), `161_feature_upvotes_user_text.sql` (`feature_request_upvotes.user_id` becomes text).

---

## [2026-10-14 — Dashboards: View can use, only Manage changes the layout]

- On the H&S, Cash Recon, Rota and blank Dashboards pages, people with **View** on that dashboard no longer see Edit layout, New dashboard, Create dashboard or Add widget. They can still open every dashboard, switch tabs, change the date and use the widgets. Before, the buttons showed for everyone and saving failed for View users.
- What someone can do inside a widget still comes from that widget's own area (for example Cash Reconciliation for the cash widgets), so View on Cash Recon Dashboard plus Manage on Cash Reconciliation means filling in figures without changing the layout.
- No migration.

---

## [2026-10-14 — GloriaFood orders in Cash Recon and on the orders board]

- Cash Recon settings > **GloriaFood**: link a venue to its GloriaFood restaurant. Either GloriaFood sends each accepted order to the venue's own address (integration *Push Accepted Order*, JSON), or Macaroonie collects them every minute with a key (*Poll Accepted Order v2*). GloriaFood only hands orders over as it accepts them, so orders count from the day the venue is linked.
- Map income sources, service charges and payment channels to GloriaFood figures: order totals, food subtotal, discounts, delivery fees, tips, service fees, tax, and the totals by **payment** (paid online, cash, card at the counter, card by phone) or by order type. Then **Fill from GloriaFood** on a day or a week, as with Loyverse. Only accepted orders count; cancelled orders and GloriaFood's test orders are left out.
- An order counts on the day it is collected or delivered (or the day it was accepted, if you prefer), with the venue's trading-day start.
- Switch on **Show GloriaFood orders on the Online orders board** to see them on the board and the phone, with an orange GloriaFood label, type and payment. Staff can move them to Ready and Collected (GloriaFood isn't told).
- The settings page lists the latest orders received. The first order sets which GloriaFood restaurant the venue takes orders from, and orders from any other restaurant are refused. Guest names, phones and addresses are kept for 30 days only.
- The Loyverse mapping editor and fill window now share their code with GloriaFood (no change in how they work).
- Migration: `159_gloriafood.sql` (new tables `gloriafood_venue_links`, `gloriafood_orders`; `cash_daily_reports.gloriafood_filled_at` / `_by`).

---

## [2026-10-13 — Deploys no longer fail while the API is still starting]

- The deploy's health check ran 3 seconds after restarting the API and failed whenever the API took a little longer to start (two of the last three deploys, both fine on a rerun). It now tries every 2 seconds for up to 30 seconds and only then fails the deploy.
- nginx warned "protocol options redefined for 0.0.0.0:443" on every deploy because the custom domain blocks ask for HTTP/2 and the apex block didn't. Each deploy now adds `http2` to the HTTPS listen lines that lack it on an address where HTTP/2 is already on (`scripts/ensure-nginx-http2.sh`). Nothing changes for visitors: nginx already served those sites over HTTP/2.
- No migration.

---

## [2026-10-13 — Optional password for the staging site]

- In the publish window, under **Staging**: **Add a password**. Visitors to your staging address are then asked for it before they see anything; once entered, their browser remembers it for 30 days.
- The **Staging** button and **Open staging** take you straight in without typing it (the button shows a small lock while a password is set).
- **Change password** signs everyone out of staging; **Remove password** (confirmed) opens it to anyone with the link again. Owners and admins only. The live site never asks for a password.
- Migration: `158_staging_password.sql` (new table `staging_access`).

---

## [2026-10-12 — Publish button shows whether the live site matches staging]

- Under **Publish** (top of the website menu): *Live matches staging · published 3 days ago*, or *4 changes not live yet · last published yesterday*, with the number on the button too. It updates by itself a moment after each save.
- The publish window lists what publishing would change: Home page, Header, Footer, Brand & theme, SEO and the other sections, each page or pop-up (new, changed, removed or hidden), and each location's page and details.
- Fixed: a location's own **Brand & theme** (Brand & theme > site override) only ever showed on staging; the live site kept the default. It goes live with your next publish.
- Fixed: **Override staging with production** re-created pages under new ids and lost the Order online page's link to ordering.
- No migration.

---

## [2026-10-12 — Guestplan button opens the booking form in one tap]

- The Guestplan block's floating **Book a table** button (Start closed) loaded Guestplan, which then showed its own button on top, and guests had to tap that too. One tap now loads Guestplan and opens its booking form, and our button makes way for Guestplan's so the two never stack. If Guestplan opens itself (on some screens), it is left open.
- No migration.

---

## [2026-10-12 — Till PINs work as soon as they are set]

- A PIN set or changed in **Till setup** didn't work on a till that was already open: the till only knew the PINs from its last config download. It now fetches the latest config when a typed PIN matches nobody and checks again, so a new PIN signs in straight away.
- Live updates (the timeline, online orders, tills) now reach every screen. The server runs several copies of the API, and an update used to reach only the screens connected to the copy that made the change; they now pass through Redis to all of them.
- A till opened at `http://` is sent to `https://` (signing in needs it), and if the PIN can't be checked the till says why instead of staying on "Checking…".
- No migration.

---

## [2026-10-12 — Custom domains switch on by themselves]

- After **Verify DNS**, the server now switches the domain on by itself, usually within a minute or two (web server block and HTTPS certificate). Nobody has to run the server script any more.
- **Website > Domain** shows how it is going and updates by itself: switching on; waiting for DNS (with where the domain points now, or a leftover IPv6 record that points elsewhere); or works on http:// only, with certbot's reason and when it tries again. Pressing Verify DNS tries again sooner.
- The www / bare twin is switched on with the domain when its DNS points at the server, also when that record is added later. If the twin's certificate fails, the main address keeps working over HTTPS.
- A failed certificate is retried after 5 minutes, 15 minutes, 1 hour, 6 hours, then daily, to stay inside Let's Encrypt's limits.
- A domain no tenant has saved any more (changed or removed) is taken off the server with its certificate.
- Server: every deploy installs it (`scripts/install-domain-sync.sh`: a systemd timer every minute, plus a run straight after Verify DNS). Logs: `journalctl -u macaroonie-domains`. Switch off with `sudo touch /var/lib/macaroonie-domains/disabled`; the Domain section then shows platform admins the manual command again.
- No migration.

---

## [2026-10-12 — Custom domains reach the site]

- A custom domain (e.g. `onethai.com`) showed a plain 404 even with DNS right: the server had nothing set up for it, so its web server answered with its default 404. New server script `scripts/nginx-custom-domain.sh <domain> [other names]` switches a domain on: web server block and HTTPS certificate, with the www / bare version redirected to it.
- **Website > Domain** says whether the domain is switched on yet (and gives platform admins the command), and links the domain only once it works over HTTPS. The guide no longer says the certificate is issued automatically.
- Saving the Domain section (e.g. switching **Site is live**) no longer clears DNS verification; only typing a different domain does.
- The domain is saved clean (no `https://`, path or trailing dot); a Macaroonie address or another site's domain is refused with a clear message.
- Verify DNS accepts an A record pointing at the server without the `APP_PUBLIC_IPS` setting, and the guide lists the IP address to use.
- No migration.

---

## [2026-10-12 — AI assistant: menus]

- **Ask AI** (and the staff connector for your own AI app) now works with menus as well as bookings, H&S and purchasing.
- **Look things up**: the menus, what is on one, prices and option prices, allergens with their level, dietary tags, calories. **Find dishes** by name, by tag, or free from allergens; a dish where the allergen can be removed on request is listed separately, so the guest can ask for it without.
- **Build a menu from a photo or PDF**: attach it and ask for a new menu. The card shows every section and dish before anything is saved; new menus aren't published until you say so.
- **Change menus**: rename, move to a venue, publish or unpublish, copy; add dishes and sections; change a dish (price, description, calories, allergens and level, dietary tags, options and their prices, section and position); change or remove sections; remove dishes; change prices across a menu, sections or dishes by a %, an amount or to one price, with rounding.
- Changes need an owner or admin login, the same as the Menus page. Allergen changes and price changes of more than half are flagged on the card. Options use your existing option groups (a new name makes a new group, and the card says so); allergens are never guessed.
- No migration.

---

## [2026-10-12 — Deliveroo menu file]

- **Menus > Deliveroo menu**: open the menu file you download from the Deliveroo Hub (Menu, Menu Manager, Bulk management), or the same file saved from Excel, and update it from your menus here.
- Each Deliveroo item is matched to a dish by name (exact names, names with "Can" or "330ml" or a name in brackets, close names to check with one tap). Matched items get the **delivery price** (menu price plus a % per venue, rounded up or to the nearest 1p, 5p, 10p, 50p or £1), **VAT rate**, **description**, **allergens** (as Deliveroo's codes) and **calories**; name, in-store price, dietary and energy can be switched on too. An empty value on your menu never clears what Deliveroo has.
- **Review**: old and new price and every change per item, filters (changes, to check, problems), choose another dish or leave an item as it is, keep Deliveroo's value or type your own for any column, and change the prices of the items shown by a % or to one price.
- **Download** the CSV for Deliveroo (same columns, order, item ids and line endings; other columns untouched) or an Excel copy to edit. The CSV can't be downloaded while a dish has an allergen with no Deliveroo code, so no allergen goes missing.
- **Save settings** and **Save matches** keep the price rule, codes, matches and your own values per venue for the next file.
- Migration **157**.

---

## [2026-10-11 — Till (POS): table service, counter, offline]

- **The till** runs in Chrome or Edge on an Android or Windows tablet or PC at the till address (`pos.` + your domain), installable as an app. Staff sign in with their own PIN. It keeps taking orders and payments without the internet and catches up when the connection is back.
- **Table service**: floor plan with live table colours, tabs, covers, seats, courses with **hold and fire**, dish choices (No / Light / Extra / On the side, and follow-on questions such as Steak then Cooking), meal deals, notes and allergies, **Send** to the kitchen, change or delete before sending, **void** with a reason after.
- **On a check**: discounts and comps (with a manager's PIN when the role's limit is passed), service charge by revenue centre and covers, offers from Promotions, split or move items to another check, merge checks, move table, change server, item not on the menu, print bill, no sale.
- **Paying**: cash with change, card (on your own card machine for now), voucher and others, tips, as many payments as needed; receipt or not. **Closed** checks: reprint, refund, reopen.
- **Counter mode**: numbered orders, paid first, sent to the kitchen when closed.
- **End of day**: X report, **Close the day (Z)** with the cash count; the Z figures can fill the day in Cash Recon automatically.
- **Admin**: **Till setup** (tills and pairing codes, revenue centres, printers and what prints where, staff PINs, till roles, courses, receipts and payments, Cash Recon map), **Floor plan** designer, **Till reports** (days, checks with their full history, refused offline changes, print queue). Menus gain a Till box per section and dish (course, colour, kitchen name, meal deals); Variant groups gain the till options; Promotions can apply online, on the till, or both.
- **Not yet**: the venue hub (kitchen printers and keeping tills in sync on the venue network), card machine links, kitchen screens. Until then bills and receipts print from the till's own print dialog and kitchen tickets wait in the print queue.
- Migration **156**.

---

## [2026-10-11 — Rota: take someone off a week]

- **Rota**: each name has a button (person with a minus) that takes that person off the week you are looking at, after you confirm. Their row goes, any shifts or time off they had that week are cleared, and they are listed under the grid in **Off this week's rota**, where **Put back** brings them back. Saved with **Save rota** like the rest of the grid; **Discard changes** undoes it.
- This week only: next week they are on the rota as usual. Someone taken off isn't on the printout or image, or in hours and pay and tips (unless they have money that week, such as a pay adjustment or wages owed). **Copy from week** leaves them off.
- Migration **155** (`rota_week_staff.removed`).

---

## [2026-10-11 — Purchasing: pick another delivery date; date buttons open the calendar]

- **Place order**: under each supplier's delivery date, **Their delivery days** shows the supplier's next four delivery days to tap. Tapping the date itself now opens the calendar for any other day.
- Past today's cutoff, the warning says which delivery is offered first. At exactly the cutoff time the order now counts as late, matching the warning.
- **Date buttons open the calendar on a computer**: on a desktop browser, clicking a date button (Purchasing, dashboards, Online orders, menu schedules, Timeline, Bookings, phone Expenses) only did something if you hit a hidden icon. Clicking anywhere on it now opens the calendar.
- No migration.

---

## [2026-10-11 — Cash Recon: fill from Loyverse]

- **Loyverse link** (Cash Recon settings → **Loyverse**, owners and admins): add a Loyverse access token (checked with Loyverse before it is saved, never shown again), pick the venue's Loyverse **store** and when its **trading day starts** (e.g. 04:00 for venues open past midnight).
- **Field mapping**: each income source, service charge source and payment channel is filled with a sum of Loyverse figures, each added or subtracted: gross sales, net sales, refunds, discounts, taxes, tips, surcharges, total collected, one **item** (e.g. a Gratuity item), a **category**, or a **payment type** (tender). For example income "Loyverse sales" = Gross sales − item Gratuity; service charge "Gratuity" = item Gratuity + Tips; each takings channel = its payment type. **Match payment types by name** maps channels in one go.
- **Fill from Loyverse** on a day (also on the phone Cash Up page), the week grid and the week cards: a window shows each mapped line with the Loyverse figure next to what Cash Recon has, the day's receipts, and payment types not mapped to a channel. Tick the days and fill. Only mapped lines are written, their notes stay, and submitted days are never changed.
- Income, takings and service charge amounts can now be negative (a day where refunds were bigger than sales), shown as −£x.
- **Fixed**: saving a cell in the week grid wiped that day's note and reset each expense's VAT and "paid by card". A venue with no booking schedule showed no days in the week grid; it now shows every day.
- Migration **154** (`loyverse_connections`, `loyverse_venue_links`, `cash_daily_reports.loyverse_filled_at` / `_by`).

---

## [2026-10-11 — AI assistant: purchasing by chat]

- **Ask AI** (and your own AI app through the staff connector) can now work with Purchasing, alongside bookings and H&S. Every change shows a card with the details and a **Confirm** button; nothing changes until it is pressed.
- **Look things up**: search the inventory with supplier prices (price per kg, litre or each, venue prices, which supplier is chosen, recent price changes), suppliers, order lists and their pars, a venue's order, and purchase orders.
- **Change the catalogue**: add or change items, supplier prices (price, pack, VAT, code, minimum and steps, a venue's own price), which supplier an item is ordered from, suppliers (including a venue's own account number, delivery days and cutoff), order lists and pars.
- **Import a price list**: attach a CSV, or a PDF, photo or email of a supplier's list and the assistant reads the products out of it. The card shows what would be added and changed, and the rows it would skip, before anything is saved.
- **Order**: fill in a venue's order (quantities in packs, fill to par, switch supplier, add items not on the list), place it (one purchase order per supplier, emailed to suppliers that take email), send or mark sent, change or cancel a purchase order, and **book a delivery in** with shortages and temperatures, which also saves the Food safety delivery check.
- Same permissions as the pages: Purchasing setup for the catalogue, Purchasing for ordering. Staff without Purchasing setup see no prices in the chat or on the cards.
- No migration.

---

## [2026-10-11 — Purchasing: inventory, suppliers, order lists and purchase orders (replaces Order sheets)]

- **Order sheets are replaced by Purchasing.** Existing order sheet templates, categories and orders are removed (not converted).
- **Inventory** (Purchasing → Inventory): every product you buy, counted in weight, volume or count, with its storage (ambient, chilled, frozen). Prices live on **supplier prices**: the supplier, their code, the pack (e.g. Case of 6 × 2 kg), the price per pack before VAT, VAT, and an optional minimum and step. One supplier can have several prices for an item. Each shows its price per kg, litre or item. Set a **company choice** (star), a different choice per venue, and **venue prices** where a venue pays a different price. Every price change is kept in **History**. **Import** loads a whole price list from CSV or Excel, with a check before anything is changed.
- **Suppliers** (Purchasing → Suppliers): contact details and how orders reach them: **email** (sent straight away, with a PDF or Excel copy attached), **print**, **Excel** or **PDF**. Delivery days, order cutoff, days from order to delivery, minimum order and delivery charge, and per-venue account numbers, delivery days and cutoffs.
- **Order lists** (Purchasing → Order lists): what a venue orders from, mixing any suppliers, with a **par** (usual quantity) per venue.
- **Placing an order** (Purchasing): pick a list, tap quantities (saved as you go), **Fill to par**, switch an item to another supplier, add anything from the inventory, then **Review & place**: one purchase order per supplier, each for its next delivery date (changeable) with an optional note. Quantities below a supplier's minimum or step are rounded up; orders below a supplier's minimum order are flagged.
- **Deliveries**: To send (email, print, PDF, Excel, mark as sent, change quantities, cancel), due today, coming up, received. **Book in delivery** records what arrived (short, damaged, substituted, not delivered), the packaging / damage / quality checks and the chilled and frozen temperatures, and writes the venue's **Food safety delivery check** automatically.
- Staff placing orders see prices only if their role can view purchasing setup.
- On the phone: **/mobile → Purchasing**. Overview shortcuts: Purchasing, Inventory, Suppliers.
- Test data: "Past purchase orders" and their delivery checks replace past order sheets.
- Migration 153 (purchasing tables, Order sheets modules renamed to Purchasing and Purchasing setup, nav: Purchasing with Order lists, Inventory and Suppliers).

---

## [2026-10-11 — Order sheets: other tenants' sheets no longer reachable]

- Order sheet categories, templates, items and orders are now limited to your own company in every request. Before, the order sheet pages could list other companies' templates and orders, and open, edit, empty or delete them by id.
- Reading order sheets now needs Order sheets (or Order sheet setup) access, and filling in quantities or changing an order's status needs Order sheets manage. Before, any signed-in user could do both.
- An order can only hold items from its own template, and templates and items only take your own venues and categories.

---

## [2026-10-11 — Blank dashboards, and every dashboard can use every widget]

- New **Dashboards** page (sidebar, under Overview): create a blank dashboard and add any widgets you like, mixed on one page, for example today's checklists, fridge temperatures, the days of the week from Cash Recon and who's on from the rota. Also on the phone app as the **Dashboards** tile.
- The **H&S, Cash and Rota dashboards now share all widgets**: Add widget lists every widget, grouped under Health & safety, Menus, Cash and Rota, with the page's own group first.
- Widgets follow access: Add widget only lists widgets from areas you can open (and says how many it left out), and someone without access sees a short note in that widget instead of its figures.
- One date bar for every dashboard: a day for checks, a week for cash and rota, or both (inner arrows a day, outer arrows a week) when a dashboard has both. Tap the date to pick any date.
- **New dashboard** button in the dashboard header, no need to go into Edit layout first. New dashboards go after your existing ones.
- Migration 152 (dashboard kind `custom`, `custom_dashboard` module permissions, Dashboards nav link).

---

## [2026-10-11 — Rota tips: half-point +/− buttons, spare points, carry-over]

- In the tips table (Rota page and the Rota dashboard's Tips widget), each person's **Points** now has **−** and **+** buttons, like the £ buttons next to their total. **−** takes half a point off someone and puts it in the week's **spare points**; **+** gives half a spare point to someone, so you take off someone first.
- Spare points keep their share of the pots, so taking half a point off one person doesn't change anyone else's tips. The Unallocated box shows how many spare points there are and what they are worth.
- **Unallocated tips now carry over to the next week**: the £ left unallocated plus what any spare points are worth. Next week's Unallocated box shows the amount carried over, and you can hand it out there with +.
- The **Moved** column is now **Changed** and includes the taps. **Undo point taps** (in the box, with a confirm) puts everyone's points back.
- Migration 151 (`rota_week_staff.points_nudge`).

---

## [2026-10-10 — AI assistant: attach photos, screenshots and files]

- The staff assistant (Ask AI, the AI assistant page and the phone app) can now read files: photos, screenshots, PDFs, and text or CSV files. Attach with the paperclip, paste a screenshot into the message box, drag files onto the chat, or on a tablet or phone take a photo with the camera button. For example, attach a delivery note and say "Log this delivery", or a booking request email and say "Book this".
- Up to 5 files per message and 10 per chat. Photos up to 5 MB (big phone photos are made smaller first), PDFs up to 10 MB, text files up to 1 MB. Word, Excel and PowerPoint files need saving as PDF or CSV first.
- Sent files show in the chat: tap a picture to see it full size, or a PDF to open it. Only the person who sent a file can open it.
- The assistant says what it read before acting on it, and every change still shows a card to confirm. If Claude can't read a file, the message and the file go back into the message box to try again.
- Migration 150 (`ai_attachments`).

---

## [2026-10-10 — AI assistant: booking past the usual limits, and health & safety]

- **Booking past the usual limits**: when a party is outside a venue's usual party size, or a time is over its covers limit, the staff assistant says which limit is in the way and asks first. Say yes and the card (**Book past the usual limits?**) lists the limits in an amber box; press **Book anyway** or **Move anyway**. The booking goes on the smallest free table that fits, or the Unallocated row if none does, to seat on the timeline. Guests and the booking widget still can't go past the limits.
- **Health & safety by chat**: the staff assistant (and your own AI app through the connector) can now show the day's H&S status and the food safety log, log fridge/freezer, hot/cold hold, cooking and delivery checks, add corrective actions, tick or untick checklist tasks, and list, add and complete H&S action log entries. Fridges, check times, dishes and tasks can be named the way you say them. Every change shows a card first; out-of-range readings show an **Out of range** box. What it can do follows your Checklists, Food safety and action log permissions.
- Activity on the AI assistant page now lists H&S changes too, and marks bookings made past the usual limits.
- Fixed: a manual (timeline) booking on the Unallocated row failed with "No unallocated table row configured" at a venue that didn't have that row yet; it is now made when needed. The same booking route now checks the venue and tables are your own.
- Fixed: moving a booking (guest manage page and AI) to a time with no covers limit could be refused as "no longer available".
- No database change.

---

## [2026-10-10 — Allergen lookup: tags in a pop-up grid]

- The allergen lookup (H&S dashboard widget, Overview tile and the phone app) no longer lists every allergen and dietary tag above the dishes. Press **Allergens & diet** to pick from a grid: tap once for dishes that have it, twice for dishes free from it.
- The filters you picked show under the search; tap one to remove it, or Clear to remove them all.

---

## [2026-10-10 — AI: set the Anthropic key on the Platform page]

- Platform admins can add, replace, check and remove the Anthropic API key on the Platform page (AI usage tab), instead of editing the server's settings file. A key is checked with Anthropic before it's saved, and only its last four characters are ever shown again.
- A saved key wins over the one in the server's .env file; removing it goes back to that one.
- If the key stops working, staff see "The AI assistant's key isn't working" in the chat instead of a general error.
- Database: migration 149.

---

## [2026-10-10 — Customers: each restaurant group sees only its own]

- Fixed: the Customers page, the customer search in the booking form and a customer's details, edit, newsletter unsubscribe, GDPR export and anonymise now only ever reach your own restaurant group's customers. Before this fix, other groups' customers could appear in the list and search.
- No database change.

---

## [2026-10-10 — AI assistant: bookings by chat and from AI apps]

- **Ask AI** in the sidebar (and the new **AI assistant** page, and AI assistant in the phone app): ask about bookings in your own words, check tables, book, move, change status, update guest details and add staff notes. Every change shows a card with the exact details; nothing happens until you press **Confirm**. What it can do follows your role.
- **Your own AI app**: AI assistant > Connect gives your restaurant group's connector address and lets you make access tokens, so Claude Code, Cursor and other MCP apps can do the same with your permissions.
- **Guests' AI apps**: a public connector (macaroonie.com/mcp) lets guests find your restaurants and book, change or cancel from their own AI app. Changing or cancelling needs a 6-digit code we email to the guest.
- **Website chat**: the new **AI chat** block (in the page, or a chat button in the corner) answers guests and takes bookings, with the same Confirm card and emailed code. Switch it on under AI assistant > Settings.
- Owners and admins get Settings (switches for the staff assistant, guests' AI apps and the website chat, and this month's usage) and Activity (every booking change made through AI). The chats share a monthly allowance set by the platform; the connectors keep working when it runs out.
- Server: set `ANTHROPIC_API_KEY` to turn the chats on (`AI_MODEL`, `AI_EFFORT` optional). Without it the connectors still work.
- Database: migration 148.

---

## [2026-10-10 — PDF menus: uploads fixed, and the switch now controls the block]

- Website > PDF menus works per location again: uploads were failing and the list always looked empty.
- The page now says it's only for menus you haven't built on the Menus page (those show with the Menu (inline) block and have their own printable PDF), and lists the menus built in the app for that location.
- **Show PDF menus** no longer talks about a header link. Off: the PDF menus block shows nothing on the site, isn't offered when adding blocks, and the location's menu page is hidden. On: add the PDF menus block anywhere; every page template now includes it.
- Removing a PDF asks you to confirm; Upload appears once you've typed a label.

---

## [2026-10-10 — Allergen notice builder]

- New **Allergen notice** card in Menus > Allergens & dietary: set the notice's title and text, tap the allergen and dietary badges its key should list, choose whether a menu lists only the ticked badges its dishes use or all of them, word the note that explains the asterisk, and add a line for online ordering only. Preview, then Save.
- The notice shows on printed menus (an Allergies & Diet footer note now prints it instead of its own words; in the menu designer the Footer notes block prints it and the Allergen key block prints the key), the dietary list, under the website Menu block (with a "Show allergen notice" switch in the block settings) and on the online ordering page, where it replaces the fixed allergy sentence.
- Database: migration 147 (each tenant's notice starts from its first Allergies & Diet footer note).

---

## [2026-10-10 — Keep an allergen or dietary tag off menus]

- Each allergen and dietary tag has an **On menus** setting (Show / Hide) in Menus > Allergens & dietary. Hide leaves its badge off the website, printed menus and their keys, the dietary list and online ordering, for example the Gluten allergen when dishes already show Gluten-free.
- Hidden tags are still set on dishes as usual and still show in the Allergen matrix, the allergen lookup and the menu editor. The tags list marks them "Not on menus"; the matrix and dish panel show a crossed-out eye.
- Database: migration 146.

---

## [2026-10-10 — Allergens separate from dietary tags, with four levels]

- Menus > **Allergens & dietary** (was Dietary tags) now has two lists: **Allergens**, which now includes the 14 standard UK allergens, and **Dietary tags** (vegan, gluten-free, spicy...). Existing tags that were clearly one of the 14 (for example N for nuts) became that allergen, so dishes keep their badge. Drag to reorder each list; **Merge into another tag** moves every dish from a duplicate tag onto another.
- Each allergen is set per dish as **Contains**, **May contain**, **Can be removed** or not at all, in the dish panel (tap a tile to step through) or the Allergen matrix (tap a box to step through). Dietary tags stay on or off.
- On the website, printed menus, the dietary list and online ordering, all three levels show the allergen's badge as before; Can be removed adds a small asterisk, explained as "Can be removed on request". Printed keys now list only the badges the printed dishes use.
- Allergen matrix, H&S dashboard Allergen lookup, Overview tile and the phone Allergens page show the three levels apart. "Free from" also lists dishes the allergen can be removed from, marked "Ask for it without ..."; dishes that may contain it are never free from it.
- New tenants get the 14 allergens automatically.
- Database: migration 145.

---

## [2026-10-10 — Cash Dashboard: Tips to pay out widget]

- New Cash Dashboard widget **Tips to pay out**: the week's tips to pay staff in cash and by bank transfer, shown big, then each tip pot (what came in, how it is paid out) and each person's Bank and Cash amounts. Same figures as the Rota page's tips table.
- Edit layout switches to hide the detail: tip pots, the staff list, each person's total, people with nothing to pay, and notes.
- Needs access to rota tips.
- Database: migration 144 (widget type only).

---

## [2026-10-10 — Tips table lines up]

- Rota tips table: each person's figures now sit on one line next to their name, the totals line up under the Total heading and with the footer, "exact £x" no longer wraps, and long pot names wrap onto two lines instead of widening the column.
- No database change.

---

## [2026-10-09 — App colour scheme: grey page, white cards, accent card headers]

- Every page now uses the Rota dashboard's look: a light grey page background, white cards, and a coloured header band on each card in your website's accent colour. Settings, Booking rules, Ordering setup, Menus, Website builder, Emails, Team, Modules & roles, Platform, Test data and the Overview tiles all get the band.
- Stronger lines and secondary text throughout, so lists, tables, inputs and buttons stand out from the page instead of blending into it.
- Page title bars are white. Bookings, Timeline, Customers and the Cash Recon week grid keep a white work area.
- The Rota page's grid, Hours and pay, and Tips now sit in cards like the Rota dashboard, with the week's totals in the headers.
- No database change.

---

## [2026-10-09 — Tip pots: paid in cash or by bank, to shares or specific people]

- Rota setup, each tip pot: **Paid in** Cash or Bank transfer, and **Paid to** each person's share or **specific people**.
- A pot paid to specific people goes in full to the people picked on the Rota page (Change on the pot's card), split equally; the pick carries on to later weeks. Everyone's other tips are adjusted in cash so each person still gets their share overall (e.g. £200 cash + £40 card shared by 6: the card tips go by bank to one person, who gets no cash; the other five get £40 cash each).
- The tips table shows a Bank and a Cash column per person and a Pay out line. Someone paid more than their share through such a pot shows "hands on £x".
- Database: migration 143 (tip_pots.payout_method, payout_to; rota_week_pot_payees).

---

## [2026-10-09 — Checklists: Tick all; cooking check items]

- Checklists (Checklists page, H&S Dashboard, Ops app): **Tick all** ticks every task at once. The Complete button is gone: a checklist is complete as soon as every task is ticked, and unticking any task makes it not done again. On a dashboard widget, tap **All done** then **Untick all** to undo a Tick all.
- H&S settings, new **Cooking items** section (per venue): choose whether the cooking check buttons show your **menus**, **your own items**, or **both**, and keep the own list (name + optional category, drag to reorder). "Log a dish not on the list" still lets you type any dish.
- The H&S test data generator picks cooking dishes from the same list.
- Database: migration 142 (fs_cooking_settings, fs_cooking_items, fs_cooking_checks.cooking_item_id).

---

## [2026-10-07 — Ops app tidy-up]

- Cash up day: a **Wages paid today** card lists the cash wages paid from the till that day (they count in the day's variance) and warns when cash wages have no Paid on day (those only count in the week).
- Phone wages: Bank transfer and Paid on for all are hidden, Pay everyone in full is a solid button, each person has a bold header. Typing a paid amount or Full sets Paid on to today (this week).
- Phone H&S Dashboard: logging only (no layout editing); the dashboard tabs sit in a framed strip with arrows to scroll.
- The Ops app no longer shows the Standard view button.
- Ops app home: module buttons two per row.
- No database change.

---

## [2026-10-07 — Allergen lookup on the Ops phone app]

- Ops app (/mobile): new **Allergens** module. Pick a menu, search a dish, or filter by allergen or diet (contains / free from). The menu and search stay at the top while scrolling.
- Allergen lookup (phone, H&S dashboard widget, Overview tile): tap a dish to see its description and every tag by name.
- No database change.

---

## [2026-10-07 — Allergen matrix and allergen lookup]

- Menus: new **Allergen matrix** page (Menus, Allergen matrix). Pick a menu and search dishes; each dietary or allergen tag has its own column, tap a box to turn a tag on or off for a dish, then Save.
- Dashboards: **Allergen lookup** widget for H&S dashboards and an Allergen lookup tile for the Overview. Read-only: pick a menu, search a dish, or tap tags to list dishes that contain them or are free from them.
- Migration 141: adds the new widget and tile types and the nav link for existing tenants.

---

## [2026-10-07 — Menu dietary list print]

- Menus: **Dietary list** next to Print opens a sheet listing each dish with its dietary tags as icons, grouped by section, with a key of the icons used. **Choose dishes** lets you untick dishes to leave them out; the choice is remembered on that device. No database change.

---

## [2026-10-06 — Order sheets: hide zero lines]

- Order sheets: **Hide zero** button beside the search box on an order shows only the lines with a quantity. A line you take down to 0 stays until you turn it off, and searching still finds every item. Remembered per browser. Works on the phone Order Sheets page too. No database change.

---

## [2026-10-04 — Website Tabs block; full-screen page builder]

- Website page builder: new **Tabs** block (Layout). Each tab holds its own blocks: tap a tab on the page and add blocks to it, or drag a block onto a tab's name to move it there. Rename, reorder, add and remove tabs in the panel; choose underline, pills or boxed tabs, alignment, the open tab's colour, a background, and whether phones show tabs or drop-down sections. A tab's link anchor (e.g. #dinner) opens that tab from any link.
- Page builder **Full screen** button: hides the app and website menus so only the page and the block settings show. No database change.

---

## [2026-10-04 — Staff paid by cash, bank transfer or a split]

- Staff page: **Paid by** for each person: Cash in hand, Bank transfer, or Split (a fixed amount by bank transfer each week, the rest cash in hand). Migration 140.
- Rota pay table adds Bank and Cash columns when anyone that week is paid by bank; the Rota dashboard's Hours and pay widget has a **Show bank transfer and cash** option.
- Wages list (Cash Recon Wages page, phone Wages page) has a **Bank** column, filled from the person's Paid by setting and editable; Full pays only the cash part, and the totals show Bank transfer, Paid (cash) and Cash left to pay. The Cash Dashboard wage widgets have a **Show bank transfer** option.
- Fill Cash Recon wages writes each person's bank transfer part. Only unpaid cash carries to next week's rota pay.

---

## [2026-10-04 — Test data: past H&S logs; menu blocks on extra pages]

- Test data page: **Generate past health & safety logs** for a chosen past date range. Fills fridge/freezer and hold readings inside each unit's limits, cooking checks with random dishes from your published menus, past order sheets on their delivery days, delivery checks matched to the order sheets (supplier, items, chilled/frozen temperature), and marks past checklists and audits complete with every task ticked. Optional share of out-of-range readings with corrective actions. **Clear generated** removes only what it made. Migration 139.
- Website: a Menu, Gallery or Reviews block on an extra page or in a modal now shows its content. Before, a menu block there showed "Menu not configured — pick one in the inspector" on the live site even with a menu picked. An unconfigured menu block now shows nothing on the site.

---

## [2026-10-02 — Platform page: any size of business, loyalty, 25 years]

- macaroonie.com now speaks to single sites, multi-site groups and franchises, not only franchisees (headline, intro, "Built for any size of operation" section, menu link "Who it's for").
- Wages are no longer described as cash only.
- Roadmap adds Loyalty, and a second group, AI that works for you: AI insights, an AI assistant, and an MCP server for your own AI tools (all planned).
- New How we build it section: AI-centric rapid development, built to measure, a modern stack, security.
- Team section: 25+ years in hospitality, starting as operators of chain restaurants, hotels, pubs and independents before moving into technology.

---

## [2026-10-02 — Platform page: roadmap and team]

- macaroonie.com has two new sections: Coming next (EPOS in development, kitchen display screens and self-order kiosks planned) and Who's building Macaroonie (the team's background across hospitality operations and every department). A Roadmap link is in the top menu.

---

## [2026-10-02 — office/ops nginx script: HTTPS without certbot editing]

- `scripts/nginx-office-ops.sh` now sets up HTTPS for office and ops itself: it uses a certificate already on the server that covers both names (the wildcard one does), or gets one with certbot's webroot mode, and writes the redirect from http itself. Fixes what the first run left behind (office answering with the API's 404, then redirecting to itself). Running it again on the server rewrites the file cleanly.

---

## [2026-10-01 — Website builder: Staging link next to Publish]

- A Staging button next to Publish at the top of the website menu opens the staging site in a new tab, without opening the publish window. It shows once the site has an address under Domain.

---

## [2026-09-30 — office and ops addresses, platform page with register interest]

**Migration:** `138_platform_interest.sql`

- The admin moves to office.macaroonie.com and the phone app to ops.macaroonie.com. On its own address the phone app installs as a separate app on Android too. The Mobile view / Standard view buttons switch between the two.
- macaroonie.com becomes a page about the platform with a register-interest form (name, email, company, phone, number of sites, message, consent). Old admin links there forward to office.macaroonie.com. Guest links (manage booking, reservations) and the API keep working on macaroonie.com.
- Platform admins see the forms on the Platform page's Registered interest tab: contact details, status (New / Contacted / Closed), notes, delete. With INTEREST_NOTIFY_EMAIL set, each form is also emailed.
- office and ops can't be used as a restaurant's site address.
- Server steps (DNS, nginx scripts, Auth0 settings) are in Docs → Deployment → Moving to office / ops.

---

## [2026-09-30 — Cash Dashboard: wage widget options]

- The Wages paid and Week staff list widgets have three options in Edit layout: Hide list changes (no Add staff, Copy from, Set as default or remove buttons), Hide pay-all options (no Pay everyone in full or Paid on for all), and Name and Paid only (just each person's name and what they were paid, with the Full button).

---

## [2026-09-30 — Rota pay adjustments, cash advances, one wages list]

**Migration:** `137_rota_pay_adjustments.sql`

- Rota pay: a new Adjustments column. Tap it to add extra pay, a deduction or a cash advance for the week, each with a note; tap one to change it, or remove it (asks first). Total pay is rota pay plus adjustments, and it is what Fill Cash Recon wages writes (with the adjustments in the wage row's notes).
- Cash advance: paid now from the till, so it is added to this week's pay and wages, and taken off next week's pay automatically ("Advance repaid").
- Not paid in full: when someone is paid part of their wage in cash, the rest is added to their rota pay next week as "Owed from last week". A row with no cash paid isn't carried (bank transfer, or not paid yet).
- Wages are no longer submitted (days still are), so the wages list is never locked.
- One wages list everywhere: the Cash Recon Wages page, the Cash Dashboard's Wages paid and Week staff list widgets and the phone Wages page all show Name, Total, Paid, Paid on and Notes (no pay type), with a Full button per person and Pay everyone in full. Changes are kept with Save or thrown away with Discard changes.

---

## [2026-09-30 — Food safety: setup in H&S settings, cooking sessions by session]

- H&S settings is now one window with a section for each kind of setup: General, Fridges & freezers, Fridge check times, Hold stations, Hold check times and Cooking sessions, with a venue picker. The Food safety page keeps only the checks: the Equipment tab and the station and time lists under Holds are gone, and so is the cooking panel's gear. Where nothing is set up yet, the page offers a button straight into the right section. Removing anything now asks to confirm.
- Cooking sessions can be dragged into order. New sessions go to the end.
- The session is picked in the temperature pop-up instead of tabs above the dishes. It starts on the session you picked last, or on the session running now by its time. Reopening a reading lets you move it to another session.
- Today's checks is grouped by session, each showing how many of its required items are done (e.g. Dinner 1/2).

---

## [2026-09-30 — Menus: several print designs per menu, and hiding sections]

**Migrations:** `135_menu_print_designs.sql`, `136_menu_section_visibility.sql`

- Menu designer: a menu can have any number of print designs (e.g. an A3 poster and an A5 table card). A Designs bar under the top bar opens each design, copies the open one or starts a blank one. Each design has a name, and one is chosen for printing (Print button and the website's PDF link); the rest are kept without changing what prints. Deleting the printing design goes back to the automatic layout. Existing designs become "Design 1" and keep printing.
- Menus: each section has "Where it shows": Everywhere, Hide on website (printed menus only; also left out of online ordering), or Hide everywhere (not printed either, kept on the page to show again later). The section heading shows a Print only or Hidden badge.
- Copying a menu copies all its designs and section visibility.

---

## [2026-09-30 — Menus: dish option prices no longer reset]

- Fixed: in a dish's panel, changing one option's price (for example Fried egg) reset that dish's other custom option prices to the group default, often £0.00, and saving lost them. Every custom price now stays until you change or reset it.
- Fixed: on Variant groups, the price boxes can be cleared and typed into normally (typing 1.75 used to come out as 0.02).

---

## [2026-09-30 — Menu designer: pick which footer notes print]

- Menu designer: the Footer notes block has a "Show all notes" switch. Untick it and tick the notes you want in that spot, e.g. allergy notice at the bottom of page 1 and the service charge note on page 2. With all notes on, new notes appear automatically.
- Footer notes now keep their ids when the menu is saved (they were re-created with new ids on every save), so a pick survives edits to the menu. Copying a menu carries the pick over to the copy's notes.

---

## [2026-09-30 — Menus: drag dishes to reorder]

- Menus: drag a dish by its grip to reorder it within its section, on touch screens as well as with a mouse. A dish can't be dragged into another section. The arrow buttons still work. Save changes keeps the order.

---

## [2026-09-29 — Page builder previews every page in the site's template]

- Fixed: the page builder showed the Classic template (and default colours) for extra pages, modals and location pages, while the home page showed the site's real template (e.g. Onethai). The canvas took the template and theme from the page being edited, and only the home page carries them. Every page now previews with the site's template and Brand & theme, or the location's own when it has a site override, matching the live site.

---

## [2026-09-29 — Online ordering: basket title colour]

- Fixed: with a basket text colour set on the Online ordering block, the "Your basket" title stayed in the brand colour (invisible on a brand-coloured basket). It now follows the basket text colour, on desktop and in the phone basket.

---

## [2026-09-29 — Online ordering: promo box, tidier category bar]

**Migration 134** (`promotions.show_in_box`, `box_bg`, `box_text`, `box_image_url`).

- The line of offers under the ordering page title is replaced by a **promo box**: a card for each promotion marked *Show in the promo box*, above the basket on desktop and under the title on phones. One offer at a time; swipe or tap the dots. Each card shows the label, name, description, small print and a button: Apply offer, See dishes or Start your deal, or *Applied −£x*.
- Promotions → Promo box on the ordering page: show it or not, background colour, background image, text colour, with a preview. Code promotions never show there.
- Online ordering block: **Show the promo box** switch.
- The category bar (with search) is now a rounded box with a subtle outline and a soft fade at the scrolling edge.

---

## [2026-09-29 — Online ordering: minimum order quantity per dish]

**Migration 133** (`menu_items.min_order_qty`).

- Menus → dish → Online ordering: **Minimum order quantity**. Guests must order at least that many of the dish (all options together). The ordering page shows *Min N* on the dish, starts the dish window at the minimum and won't go below it; the server rejects a basket under the minimum. The Menus page shows a Min badge on the dish row.

---

## [2026-09-29 — Website builder: Publish button]

- **Publish** is now its own button at the top of the website builder menu, above Home, showing when the site was last published (or that it hasn't been). It opens a window with the staging link, Publish now, scheduling and Override staging with production.
- "Domain & publish" is now **Domain**: subdomain, custom domain and the Site is live switch.

---

## [2026-09-29 — Website: Heading block]

- New **Heading** block for the page builder: a section title with an optional small line above and line below, heading level H1 to H4, size, alignment, font (theme heading, theme body or any listed font), weight, italic, capitals, a short bar or lines either side, theme colours, background and spacing. Edit on the page or in the panel; large sizes shrink to fit on phones.

---

## [2026-09-29 — Promotions: only your own venues and menus; dish picker in a pop-up]

- Fixed: the Promotions editor listed venues (and dishes) from other restaurant groups, and the promotions list, switches and delete were not limited to your own group. Every promotions query, and the ordering settings venue check, now filters by your group.
- Dish choices (dishes a discount covers, the free dish, meal deal parts, dishes the basket needs) open in a pop-up. The editor shows only what you picked, as tags you can remove, with a Choose / Change dishes button.

---

## [2026-09-29 — Promotions: free dish, meal deals, spend more save more]

**Migration 132** (`promotions.bundle`, `bundle_price_pence`, `tiers`; three new promotion kinds).

- **Free dish**: once the order qualifies (e.g. spend £30), one of the dishes you pick is free, or a % off. The basket tells the guest and has a Choose button that takes them to the dishes. The free dish doesn't count towards the minimum spend.
- **Meal deal**: parts (e.g. Starter + Main + Drink, each from the dishes or sections you pick) for a set price. Every complete deal in the basket costs exactly the deal price, using the dearest dishes that fit. Guests with part of a deal see "Add Drink to get Lunch deal" with a button to the drinks.
- **Spend more, save more**: spend levels with their own % or £ off the whole order (e.g. £20 gets 10%, £40 gets 15%). Guests see how much more to spend for the next level.
- Dish labels (e.g. DEAL) work on meal deals and free dishes too.
- Fixed: Buy X get Y could take a penny too much off in some baskets. Discounts are now worked out to the exact penny.

---

## [2026-09-29 — Promotions for online ordering]

**Migration 131** (`promotions`, `order_promotions`, `orders.discount_pence`, `order_items.discount_pence`; new module `promotions`, nav link under Online orders).

- New **Online orders → Promotions** page. Set up:
  - % or £ off the whole order, % or £ off chosen dishes or whole sections, and Buy X get Y (the cheapest free, or a % off).
  - Conditions: a minimum spend, a particular dish in the basket, and a cap on the discount.
  - How guests get it: automatic, tap to apply in the basket, or a promo code.
  - A limit on the number of uses, dates and times of day (like menu times), and which venues.
  - Priority by dragging the list, and "can't be combined with other promotions".
  - Each promotion can be switched on and off, copied or deleted, and the list shows its uses and the total discount given.
- On the ordering page, guests now see:
  - each discount as its own line in the basket, at checkout and on their order page;
  - offers they can tap to apply, and hints such as "Spend £5.50 more to get 10% off";
  - a "Have a promo code?" box, and labels (e.g. 2 FOR 1) on the dishes an offer covers.
- Links like `/order?promo=CODE` apply a code for the guest.
- The server works out every discount again when the order is placed. A promotion that has just run out is removed with a message.
- Staff see discounts on the order, the printed ticket, the confirmation email and the Report, which now shows the discounts given and each promotion's use.
- New **Promo** website block: shows one promotion (heading, what it takes off, small print, a code if it has one) with an Order now button that opens the ordering page with the offer ready. It has Banner and Voucher card styles and hides itself when the promotion is off, ended or used up.

---

## [2026-09-29 — Online ordering: search as an icon beside the categories]

- The Online ordering block's search can now show as a round magnifier icon at the start of the category bar, on phones only or everywhere, instead of a full-width box. The icon stays put while the categories scroll under it; tapping it opens the search box, and the cross (or Escape) closes it.
- Searching while scrolled down the menu now brings the results into view just under the bar (it could look empty before).

---

## [2026-09-29 — Online ordering: dishes in the basket are marked on the menu]

- On the ordering page, a dish that's already in the basket shows a small basket badge with how many are in it, and an outline in the site's main colour. It updates as dishes are added or removed.

---

## [2026-09-29 — Online ordering: colours for house favourites]

- The Online ordering block's "Highlight house favourites" option now has a background and a text colour (from your theme) for favourite dishes, as well as the badge and coloured edge.
- Reminder: block settings are part of the page, so the live site shows them after you Publish (staging shows them straight away).

---

## [2026-09-29 — Online ordering: category bar and basket fit below the site header]

- On the ordering page, the sticky category bar (with the search box) and the basket no longer slide under a sticky site header. They now sit just below it automatically, whatever the header's height. The search box was hidden under the header, which is why it seemed missing.
- The block's "Space for a sticky site header" setting is now only an override: leave it at 0 for automatic.

---

## [2026-09-29 — Online ordering block: layout, search, favourites and more]

- The Online ordering block (Website → Pages & modals → Order online) has new settings:
  - Change the title and the text under it, or hide either. {venue} and {address} fill in the venue's details.
  - Basket beside the menu, or pop-up only (a basket button at the bottom on every screen).
  - The basket and the category bar can stay in view while scrolling, with space for a sticky site header. The category being looked at is highlighted.
  - Basket background and text colours from your theme.
  - Show or hide "Includes VAT" under the total.
  - A search box for dishes.
  - House favourites (ticked on the Menus page) can get a badge and a coloured edge.
  - Turn off the note box on each dish.
- Fixed: "Includes VAT" never showed on the ordering page, because dish VAT rates weren't sent to it.
- Fixed: nothing on your website could stay stuck to the top of the screen while scrolling, including the header block's sticky header. It now works in current browsers.

---

## [2026-09-29 — Online ordering: menu times and scheduled menu changes]

**Migration 130.**

- Ordering setup: each chosen menu has **Set times and dates**. Give it times of day per weekday (for example lunch Mon to Fri 11:00 to 15:00), and From / Until dates to schedule a menu change ahead.
- Menus with times or dates can't overlap each other: Save stays off with a message naming the two menus until they don't. A menu with neither (such as drinks) stays available all the time alongside them.
- Guests see when each menu is served. At checkout they're only offered collection times when every dish in the basket is served, and placing the order checks it again. A menu whose dates haven't started or have ended isn't shown.

---

## [2026-09-29 — Rota: sickness and time off, Clear rota, print margins]

**Migration 129.**

- Rota: each name has a small square button that picks what a tap puts in for that person: ON / OFF (as before), SICK / OFF, PTO / OFF (paid time off), UTO / OFF (unpaid time off) or ABS / OFF (absent). Tapping their shifts then flicks between OFF and that option; a shift that was ON changes straight to it. In Hours mode each period has a working / time off box.
- Pay: PTO is paid like the shift; SICK, UTO and ABS are unpaid. None of them count as hours worked or earn tip points. The pay table lists time off under each person's hours. Fill Cash Recon wages uses worked + PTO hours.
- Time off shows in its own colour on the printout and image, the who's-on list shows who is off, and Copy from week copies only worked shifts.
- **Clear rota** next to Save rota empties the week (after you confirm); press Save to keep it.
- Print / PDF keeps a margin round the rota even when the print dialog's Margins is set to Minimum or None.

---

## [2026-09-29 — Boxed inset: mobile values now save]

- The per-step **Mobile** value in Website → Brand & theme → Layout now saves. Before, the Layout card appeared to save but the mobile value was thrown away by the server, so phones kept the desktop padding. Save again, then republish the site.
- The step value boxes accept typing again: you can clear a box and type a new number. Before, clearing it put 0 straight back and the cursor jumped.
- A failed Layout save now shows the error next to the Save button.
- Website → Pages & modals: **Save details** is greyed out until you change the title, slug, type, published box or HTML, like the page builder's Save.

---

## [2026-09-29 — Menus: section panel, section VAT, printed colours, Dietary tags]

**Migrations 127, 128.**

- Menus: tap a section's heading to edit it in the side panel, like dishes: title, subtitle, icon, Highlight, print options. The heading now shows badges for what is set. Deleting a section asks you to confirm in the panel.
- Sections can have their own VAT rates (takeaway and eat in) for online ordering. A dish uses its own rate, then its section's, then the venue default in Online orders, Setup.
- Printed menus and saved PDFs keep the colours of dietary tags, highlighted sections and house favourites. Before, the print left them white unless "Background graphics" was ticked.
- "Dietary groups" is now called **Dietary tags** everywhere (Menus → Dietary tags). Tap a tag to edit it; adding and editing use a pop-up form with a live preview and colour swatches.

---

## [2026-09-29 — Media as a page; boxed inset labels show phone values]

- **Media** in the sidebar now opens as a normal page instead of a pop-up over the screen. Image pickers elsewhere still open it as a pop-up.
- Website → Brand & theme → Layout: the default step and mobile override buttons now show each step's phone value (for example "8px mobile"), and the mobile override row shows only the phone value. The block inspector's Boxed inset buttons do the same. Before, they always showed the desktop value, so a saved mobile value looked missing.

---

## [2026-09-29 — Technical docs page no longer blank]

- The in-app technical documentation page (/docs) loads again. A code sample in the Overview tiles section was being run as code instead of shown as text, which crashed the whole page.

---

## [2026-09-29 — Ordering page: mobile fixes, designable page, ordering block]

**Migration 126.**

- The ordering page works properly on phones: the category tabs scroll sideways and the dishes keep a margin on both sides. Before, the tabs pushed the page wider than the screen and the cards and tabs were cut off at the right edge.
- The ordering page is now a page you design in **Website → Pages & modals → Order online**. Add a hero, text, photos or anything else around the new **Online ordering** block (menu, basket and checkout). It always lives at /order (and /locations/<location>/order), stays published and can't be deleted.
- New **Online ordering** block for the page builder: put ordering on any page (one per page). Pick a venue or leave it on Automatic; optional heading and "hide the venue name".
- Sites published before this change keep working and show the same ordering page until they are next published.

---

## [2026-09-29 — Online ordering: GDPR consent and newsletter]

**Migration 125.**

- Checkout has a new **Your privacy** section. A required box: the guest agrees their details, including any allergy information, are used only to prepare the order and contact them about it; Place order stays greyed out until it is ticked. An optional, unticked box subscribes them to the newsletter ("occasional, carefully crafted emails with news and offers"). Both use your brand name, and link to your Privacy Policy page when you have one.
- Every order records exactly what the guest agreed to and when. The staff order view shows it.
- Customers: newsletter subscribers are marked in the list, a **Newsletter** button lists only subscribers, and a profile shows when and how they subscribed with an **Unsubscribe** button. Staff can't subscribe anyone.
- GDPR anonymise now also clears the customer's online orders (name, email, phone, notes, allergy information) and takes them off the newsletter; the export now includes their online orders and consent.
- The default Privacy Policy (Website → Legal & cookies, for newly generated pages) mentions online orders and the newsletter.
- Orders placed earlier with the old "Send me news and offers" box ticked carry that opt-in onto the customer.
## [2026-09-29 — Online ordering follows the menu's variant settings]

- The two variant settings in a menu's details now apply to online ordering, as they already did on the website and the printed menu. "Don't show the variant option at all if it isn't priced" leaves options with no price (or £0) out of the dish options, and the server refuses them. "Don't show a price on zero-priced variants" hides the £0.00 next to such options.
- An option with no price no longer shows "£0.00" or makes the dish free: the dish's own price applies. A dish whose only options have no price, and which has no price of its own, is left off the ordering menu.
## [2026-09-29 — Pages that couldn't scroll]

- Food safety, Checklists, H&S Action Log, Online orders, Ordering setup, Reviews, Issue log, Feature requests, Changelog and Backlog now scroll. Before, anything below the bottom of the screen was cut off with no scrollbar.

---

## [2026-09-28 — H&S checks follow opening days]

**Migration 124.**

- New **H&S settings** button on Food safety, Checklists and the H&S Dashboard (owners and admins) with one switch for all venues: **Follow restaurant opening days**.
- When it's on, on a day a venue is closed (from its booking schedule, including closures and special dates):
  - daily checklists aren't needed and move to a greyed "Not needed today (closed)" group (you can still tick them);
  - fridge, hot/cold holding and cooking checks aren't expected, and the pages show a "Closed on this day" banner;
  - the Overview H&S tiles show the day as Closed instead of red.
- Weekly and monthly checklists are still due. An out-of-range reading recorded on a closed day still shows as needing action. A venue with no booking schedule counts as open every day.

---

## [2026-09-28 — Legacy import: Monthly Health & Safety Audit]

- The legacy spreadsheet import now also brings in the **Monthly Audit** sheet (the monthly Health & Safety audit: 31 questions across cleaning, storage and cross-contamination). Create a monthly checklist with the audit's questions first; the import fills in every past month, who completed it, and any notes per question. Questions are matched by their number (1.1.0 to 3.2.6), so the task wording can be tidied up.

---

## [2026-09-28 — Fixes: website saves, Reviews page, Online orders link]

**Migration 123.**

- **Website builder saves now stick.** Online ordering links, Delivery providers, Contact, Gallery, PDF menus, Allergens and a few other location sections saved to the server but the page kept showing the old values, so Save looked like it did nothing. Save bars also show why a save failed.
- **Reviews page** no longer loads blank.
- **Online orders link**: tenants whose sidebar had no "Service" section didn't get the Online orders / Ordering setup links. They are now added next to Customers (or Bookings, or at the end of the menu).

---

## [2026-09-28 — Online ordering for collection]

**Migration 122.**

### Online ordering
- Guests can order food for collection on your website at **/order** (with several venues they pick a location first): browse the menu, choose options, add a note, pick ASAP or a collection time, add a tip, and pay at the counter or online. A live order page shows when the order is accepted and ready, and guests get emails when it is confirmed (with a VAT breakdown), ready or cancelled.
- New **Online orders** page (Service in the sidebar) and **/mobile → Online orders**: a live board of new, in-progress and ready orders with a sound for new orders. Accept with a ready time, mark preparing, ready and collected, push the time back, record cash or card payment at the counter, refund (all or part), reject or cancel (online payments are refunded automatically), and print a ticket. **Sold out** switches a dish off for today or until you turn it back on; **Pause orders** stops new orders with a message.
- **Ordering setup** per venue: menus to order from, ordering hours (lunch and dinner windows), preparation time, collection slots and orders per slot, order ahead, minimum order, tips, default VAT, automatic accept, payment methods and messages for guests.
- **Report** tab: orders, sales, average order, tips, refunds, money taken by payment method and top dishes.
- VAT follows the order type: each dish has takeaway and eat-in rates, and each venue has a default for each. Collection orders use the takeaway rate.
- Platform admins set an online ordering fee (%) per tenant on the Platform page; every order records its fee and the report shows the total.
- Payment methods are pluggable: pay at the counter works now, plus a **test payment** for trying the flow before going live (no money moves). Card payments through Stripe come next.

### Menus
- Each dish has **Can be ordered online** and VAT rates for takeaway and eat in.
- Variant groups say how they are priced (the dish price, or added on top) and how many options a guest picks, so extras like "Add egg +£1" work.

### Fixes
- Error messages now reach the screen across the admin and the booking widget (for example "That time is no longer available"); before, many errors only showed a generic "Unprocessable Entity" or "Not Found".

---

## [2026-09-28 — Menu designer: all website fonts]

### Menus
- The menu designer can use any font from the website builder. **Page setup > Fonts** picks the font for headings and prices, for text, and for the handwritten lines; the usual Inter / Fraunces / Caveat stay the default.
- **Use website fonts** copies the headings and text fonts from Website > Brand & theme.
- Any block can have its own font (block panel, **Look > Font**).
- The print page loads only the fonts the design uses.

---

## [2026-09-28 — Menu print: no more blank sheets]

### Menus
- Printing a menu straight to a printer no longer adds a blank sheet after every page. Many printers keep a few millimetres of margin of their own, and each printed page used to be exactly the paper's height, so its empty bottom edge spilled onto a new sheet. Pages are now sized to the area the printer can actually print, for both designed and automatic layouts, and a designed page still lands in the same place on the paper.

---

## [2026-09-28 — Menu designer: folded sheets]

### Menus
- The menu designer's **Page setup** has a **Folded sheet** option: fold left | right or top / bottom, with a gap at the fold (0 to 30 mm). The page splits into two halves with the gap between them, so nothing lands on the crease. Blocks snap to either side of the gap and new blocks are kept off it; a block can still stretch across both halves.
- **Print a fold line** adds a faint dashed line down the middle of the gap to fold along.

---

## [2026-09-28 — Menu print: variant options side by side]

### Menus
- Printed menus can show a dish's variant options (Chicken, Prawns, Beef...) two or three to a row instead of one per line, which saves vertical space.
- Automatic layout: menu **Settings > Print layout > Variant options per row**.
- Menu designer: **Page setup > Variant options per row** sets the default; a dish block, or a section showing its dishes, can use its own number.

---

## [2026-09-28 — Food safety Deliveries: blank page fixed]

### Food safety
- The Deliveries tab no longer goes blank when you pick a date in a week that has deliveries logged. The API was sending delivery dates in a form the week list couldn't read; it now sends plain dates, and editing a logged delivery keeps its date.

---

## [2026-09-27 — Menu print designer]

### Menus
- New **Design print** button on a menu opens a designer where you lay out the printed menu yourself. Each page is a grid; drag the menu header, section titles, whole sections, single dishes, text, images, lines, footer notes, the allergen key and page numbers onto it, then move and resize them. Everything snaps to the grid.
- Any block can **show on every page** (a header, footer or page number, say), and a page can hide those repeated blocks. Section titles can be placed again on later pages, with text such as "(continued)" after them.
- The design stays linked to the menu: names, prices and allergens always come from the menu, and dishes added later appear in a **Not placed yet** list.
- Once saved, the menu's Print button and the **Open as printable PDF** link on the website use the design. **Use the automatic layout** goes back.
- Page setup: A4 or A3, landscape or portrait, margins, grid size and text size.
- Menu sections and dishes now keep their ids when the menu is saved.

### Database
- Migration `121_menu_print_layout_designer.sql`: `menus.print_layout` (jsonb, empty = automatic layout).

---

## [2026-09-27 — Menu printing: page layout controls]

### Menus
- Menu **Settings** has a new **Print layout** group: font size (80% to 130%), page margins, a header on later pages (none, one line or the full header), repeating the footer (allergen key, notes, footer line) on every page, page numbers, and keeping every section in one piece.
- Each section can **start in a new column** or **on a new page**, and can be **kept in one piece**.
- The print page now shows each printed sheet separately and marks any page that is too long for one sheet in red, with how much too long it is.

### Database
- Migration `120_menu_print_layout.sql`: `menus.print_settings` (jsonb), `menu_sections.print_break_before` and `print_keep_together`.

---

## [2026-09-27 — Tip pot cards fit the space]

### Rota
- Tip pot cards now sit side by side whenever there is room for them (as many per row as fit), based on the width of the tips area rather than the screen. A narrow dashboard widget or a phone still stacks them; a wide one shows three or more across.

---

## [2026-09-27 — Rota dashboard: choose which parts of the Tips widget show]

### Rota
- The Rota dashboard's **Tips** widget has three options in Edit layout: **Hide pots**, **Hide staff shares** and **Hide moves**. Add the widget more than once to put the pots, the staff table and the moves list in separate places on the dashboard.

---

## [2026-09-27 — Tips: quick +/− nudges]

### Rota
- Each person's tip **Total** on the Rota page (and the Rota dashboard tips widget) has **−** and **+** buttons. **−** moves £0.50 of their tips into the week's **Unallocated** pot; **+** gives £0.50 from that pot to them. Money can be left unallocated. **Undo all** puts every nudge back.

### Database
- Migration `119_tip_unallocated.sql`: `rota_week_staff.tip_unallocated`.

---

## [2026-09-27 — Rota: separate pay and tips permissions]

### Access
- The rota's "Rota pay & tips" permission is now two: **Rota pay** (hours and pay, pay overrides, fill Cash Recon wages) and **Rota tips** (tip pots, points, shares, moves and adjustments). Set each to None / View / Manage per role on the Access page, e.g. let operators view tips without seeing wages. Existing roles keep their current access to both.
- Someone with only one of them sees just that section on the Rota page and dashboard; the other half is removed from what the server sends.

### Database
- Migration `118_rota_tips_permission.sql`: `rota_tips` module; each role's `rota_tips` copied from its `rota_pay`.

---

## [2026-09-27 — Mobile Expenses: whole week]

### Mobile
- The mobile **Expenses** page now shows a whole week (Monday to Sunday) instead of one day: week cash, card and VAT totals, then each day's expenses with its own Add button. Arrows move a week back or forward; tap the week to jump to any date. Submitted days are marked and locked; closed days are labelled.

---

## [2026-09-27 — Tip adjustments: add and take out]

### Rota
- Besides moving tips between people, payroll can now **Add** an amount to people (e.g. a £25 bonus) or **Take out** an amount (e.g. £25 for a till shortage), in £ or points, with a reason. Nothing is passed to or taken from anyone else. Each entry is listed with its reason and can be undone on its own; the line under the pots shows the total added and taken out.

### Database
- Migration `117_tip_adjustments.sql`: `rota_tip_moves.action`; `from_staff_id` is now only set for a move.

---

## [2026-09-27 — Tip pots: several stacking fees]

### Rota
- A tip pot can have any number of **fees and surcharges** (e.g. card fees, then tax), each with a name and a percentage. They stack: each is taken from what is left after the ones above it (2% then 20% takes 21.6% in total). Drag to reorder; the pot card on the Rota page lists each fee.

### Database
- Migration `116_tip_pot_surcharges.sql`: `tip_pots.surcharges` (jsonb list); an existing surcharge is copied into it, and `surcharge_name` / `surcharge_pct` are dropped.

---

## [2026-09-27 — Tip pot lines: deductions and percentages]

### Rota
- Tip pot manual lines can be negative, to take money out of a pot (e.g. a breakage deduction).
- A manual line can be a **% of pot** instead of a £ amount (choose when adding the line in Rota setup). It is a percentage of the pot's Cash Recon sources plus its £ lines, and the pot card shows what it comes to in £.
- On the Rota page, a **+ / −** button next to each line switches between adding and deducting. A pot never goes below £0.

### Database
- Migration `115_pot_line_percent.sql`: `tip_pot_lines.kind`; drops the `amount >= 0` check on `rota_week_pot_lines`.

---

## [2026-09-27 — Rota print: hide totals]

### Rota
- New Rota setup checkbox, **Hide totals on printouts and images**: leaves the Working count under each day and each person's Hours column off Print / PDF and Save image. The rota page still shows them.

### Database
- Migration `114_rota_hide_print_totals.sql`: `rota_settings.hide_totals_on_print`.

---

## [2026-09-27 — Wages paid on day; tip moves one to many]

### Cash Reconciliation
- Each cash wage has a **Paid on** day (the day the cash came out of the till). That day's variance adds it back, so each day balances. Set it per person or with **Set all to** on the Wages page; ticking **Paid** on the phone Wages page or the dashboard's Wages paid widget fills in today (or the selected day). Works after the week is submitted.
- The week grid shows cash wages per day under "Paid out of till", and flags any amount with no day. The dashboard's Day balance widget shows wages paid that day.

### Rota
- **Tip moves** are now a list of separate moves. Each takes points or £ from one person and gives it to one or more people, split equally, by amount or by %, with an optional note. Each move can be undone on its own.

### Database
- Migration `112_wage_paid_date.sql`: `cash_wage_entries.paid_date`.
- Migration `113_rota_tip_moves.sql`: `rota_tip_moves`, `rota_tip_move_lines`; drops `rota_week_staff.points_adjustment` and `tip_adjustment`.

## [2026-09-27 — Tip pot surcharge]

### Rota
- A tip pot can have a **surcharge** (e.g. tax or card fees): a name and a percentage, set in the pot's settings in Rota setup. It is taken off the pot's total before sharing. The pot card on the Rota page shows the total before deductions, the surcharge and the amount available to share.

### Database
- Migration `111_tip_pot_surcharge.sql`: `tip_pots.surcharge_name`, `tip_pots.surcharge_pct`.

## [2026-09-27 — Variance includes till payouts]

### Cash Reconciliation
- The variance now accounts for cash paid out of the till before counting: each day adds back its cash expenses, and the week also adds back the cash wages. Counted cash is what goes to the bank.
- The summary ends at a single **Variance** row. Net Cash and Cash to bank are gone from the week grid, the day view, the dashboard balance widgets and the week summary grid widget.
- The week grid's Expenses section is now **Paid out of till** (cash expenses, card expenses for reference, cash wages).
- Mobile Cash Up's week tile shows the week variance only.
- Fixed the week view's per-day income and takings totals, which were multiplied when a day had several income and takings lines.

## [2026-09-27 — Hide closed days on the rota]

### Rota
- Two new switches in **Rota setup**: **Hide closed days on the rota** and **Hide closed days on printouts and images**, set separately.
- Closed days come from the venue's booking schedule (weekly schedule, date overrides, exceptions), the same rule Cash Recon uses. A closed day with someone rostered is always shown and marked Closed. A venue with no weekly schedule never hides days.

### Database
- Migration `110_rota_hide_closed_days.sql`: `rota_settings.hide_closed_on_rota`, `rota_settings.hide_closed_on_print`.

## [2026-09-27 — Move tips by £]

### Rota
- **Move tips** (Rota page, Tips section) can now move a **£ amount** from one person's tips to another's, as well as points. £ moves apply after every pot is shared, keep the total the same, and show in a new **Moved £** column. Separate **Undo point moves** and **Undo £ moves** buttons.

### Database
- Migration `109_rota_tip_money_moves.sql`: `rota_week_staff.tip_adjustment`.

## [2026-09-27 — Tip pots]

### Rota
- **Tip pots** in Rota setup: give each pot a name, tick which Cash Recon service charge / tips sources feed it (listed by venue; a source is in at most one pot), and add manual lines (e.g. a cash tips jar) whose amounts are entered each week.
- Each pot is shared **by points**, **manually** (payroll types each person's amount; Split evenly helps), or **kept by the house**.
- The Rota page's Tips section shows a card per pot (sources, manual line amounts with Save, and what is left to share) and a table with every person's share of each pot plus their total.

### Cash Reconciliation
- Removed the "Distribution" choice from service charge sources. Tip pots replace it; sources that were "Distributed to Staff" were moved into a "Staff tips" pot shared by points.

### Database
- Migration `108_tip_pots.sql`: `tip_pots`, `tip_pot_lines`, `rota_week_pot_lines`, `rota_week_pot_manual`; `cash_sc_sources.tip_pot_id`; drops `cash_sc_sources.distribution` and `rota_weeks`.

## [2026-09-27 — Print rota + tip rounding]

### Rota
- **Print / PDF** and **Save image** buttons on the Rota page and the Rota grid dashboard widget. The week prints on one A4 landscape page (names down the side, days across, each person's shifts or times, hours per person, how many are working each day); choose "Save as PDF" in the print dialog for a PDF. The image is a PNG of the same sheet; on tablets and phones the button is **Share image** and opens the share sheet. Unsaved changes are marked "DRAFT, not saved".
- **Round tip shares** in Rota setup: to the nearest amount you choose (e.g. 50p, £1, £5), rounding nearest, always up or always down. The Tips table shows each exact share under the rounded one and how far the total is over or under the pot.

### Database
- Migration `107_rota_tip_rounding.sql`: `rota_settings.tip_round_to`, `tip_round_mode`.

## [2026-09-27 — Staff & Rota]

### Staff
- New **Staff** section in the sidebar. The staff list moved out of Cash Recon settings to its own **Staff** page (per venue, drag to reorder).
- **Roles** page: company-wide job titles, each with a tip points multiplier (e.g. Manager x1.1, Pot wash x1.0).
- Each person has a role and a pay type: **Hourly** (optional different rate per shift) or **Fixed** per week, per day worked, or per shift (optional amount per shift).

### Rota
- **Rota setup**: choose Day parts (ON/OFF per shift) or Hours (start and end times at 15 / 30 / 60 minute steps), and define day parts / shifts with start, end and tip points (e.g. Lunch 11:30-15:00 0.5 pts, Dinner 18:00-23:00 1 pt).
- **Rota** page: names as rows, days as columns. Day parts mode splits each day into shift columns with an ON/OFF tap; Hours mode opens a day's times, with as many non-overlapping periods as needed. Explicit Save / Discard, copy from one of the last 8 weeks.
- **Hours and pay** per person for the week, with a per-week pay override and **Fill Cash Recon wages**, which writes the pay into that week's wages (Paid ticks kept).
- **Tips by points**: shift points x role multiplier, tip pot from service charge / tips sources distributed to staff (or set by hand), share per person. Payroll can move points between people (zero-sum) and undo all moves.
- **Rota dashboard** with Rota grid, Who's on, Hours and pay, and Tips widgets.

### Access
- New module group "Staff & rota": Staff, Rota, Rota pay (owner/admin only by default), Rota dashboard.

### Database
- Migration `106_staff_rota.sql`: `staff_roles`, `rota_settings`, `rota_shifts`, `staff_shift_rates`, `rota_entries`, `rota_weeks`, `rota_week_staff`; `cash_staff.role_id` + `pay_basis`; `hs_dashboards.kind` gains `rota`; four rota widget types; Staff nav section for existing tenants.

## [2026-09-27 — Days of the week widget: open the day, hide closed days, compact mode]

### Cash Reconciliation
- Cash dashboard, **Days of the week** widget: tapping a day now opens that day's full declaration over the dashboard (back arrow returns). The day is still selected for the Day balance and Petty cash widgets.
- Two new switches on the widget in Edit layout: **Hide closed days** and **Compact** (smaller tiles with the day, a status dot and the variance).

### Admin Portal
- Dashboard widgets can now have their own display options, shown as switches on the widget in Edit layout.
- Rename any widget (H&S and Cash dashboards) or Overview tile in Edit layout / Customise layout: a Name box with Save, and Use default to go back to the built-in name.
- Fixed: the Overview's per-tile "Visible to" button never showed in Customise layout.
- Cash dashboard title bars show a headline figure: **Week summary grid** the week's variance, **Week expenses** the cash total, **Wages paid** the total paid in cash.
- Cash dashboard **Week staff list** widget is more compact: one row per person (name, Fixed/Hourly, hours x rate or amount, total, remove) when the widget is wide enough, wrapping to two lines only on narrower widgets.

### Database
- Migration `105_dashboard_widget_settings.sql`: `hs_dashboard_widgets.settings` (jsonb).

## [2026-09-27 — Staff pay type + week staff list widget]

### Cash Reconciliation
- Staff list (Cash Recon settings, Staff): each person now has a **Fixed** or **Hourly** pay type. The default rate is a weekly amount for fixed staff and an hourly rate for hourly staff, and the list shows it (e.g. "Hourly, £12.50/hr").
- New weeks and newly added staff start with their pay type: fixed staff get their weekly amount, hourly staff get their rate ready for the hours (on the Wages page, mobile Wages and the new widget).
- New **Week staff list** widget for the Cash dashboard: switch each person between Fixed and Hourly, enter hours x rate or an amount, add or remove staff, copy the list from one of the last 8 weeks, and Set as default. Changes are saved with an explicit Save button; Paid ticks are kept.
- Fixed: the up/down buttons in the settings staff list now save the new order (they used to snap back).

### Database
- Migration `104_cash_staff_pay_type.sql`: `cash_staff.pay_type` (backfilled from the default wage list), and the `cash_week_staff` widget type.

## [2026-09-27 — Cash Dashboard: week summary grid widget]

### Cash Reconciliation
- New **Week summary grid** widget for the Cash dashboard: the reconciliation grid's rows (income sources, service charges, payment channels, expenses, variance, Net cash, wages, Cash to bank) with only the week total, no individual days. Read only.

### Database
- Migration `103_cash_week_summary_grid_widget.sql`: adds `cash_week_summary_grid` to the widget type check.

## [2026-09-27 — Cash Dashboard: week expenses widget]

### Cash Reconciliation
- New **Week expenses** widget for the Cash dashboard: every expense logged in the week, grouped by day, with category, VAT and card-paid badges, plus cash, card and VAT totals. Tap a day heading to select that day.

### Database
- Migration `102_cash_week_expenses_widget.sql`: adds `cash_week_expenses` to the widget type check.

## [2026-09-27 — Cash Dashboard + row spanning on dashboards]

### Cash Reconciliation
- New **Cash dashboard** page (sidebar, next to Cash recon). Build your own dashboards from six widgets: days of the week (tap a day to select it), day balance, week balance (down to Cash to bank), the reconciliation grid (editable), wages paid (with Paid tick boxes) and petty cash for the selected day.

### Admin Portal
- H&S Dashboard, Cash Dashboard and the Overview page: widgets can now span several rows as well as columns. A tall widget sits beside a stack of shorter ones instead of leaving a gap. Height is set in rows.

### Database
- Migration `101_cash_dashboard.sql`: `hs_dashboards.kind`, the cash widget types, and the `cash_dashboard` module + nav link.

## [2026-09-27 — H&S Dashboard keeps its column layout on narrow screens]

### Admin Portal
- H&S Dashboard: widgets you placed side by side stay side by side on a narrower screen (e.g. an iPad held upright). The columns shrink to fit instead of the dashboard dropping to fewer columns.

## [2026-09-27 — iPad fixes: menu button, H&S Dashboard layout and full screen]

### Admin Portal
- On tablets and other touch screens, the menu button now sits in a narrow strip down the left edge instead of floating over the page, so it no longer covers page titles such as "Overview". The button is also better aligned with page headers.
- H&S Dashboard: the date selector and dashboard tabs now stay on one row; the dashboard uses the full screen width (no empty strip on the left); and a dashboard with more columns than fit on screen shows fewer columns instead of running off the edge.
- H&S Dashboard: Full screen now works on iPad, including when the app is added to the home screen.

## [2026-09-27 — Petty cash: paid by card]

### Cash Reconciliation
- Petty cash expenses can be marked **Paid by card**. They stay on record (with receipt and VAT) but are no longer counted in Total Expenses, Net Cash or Cash to bank.
- Card-paid spend is listed separately as "Paid by card (not in recon)" on the day summary and the week grid, and card expenses carry a small Card tag.

### Mobile App
- Mobile Expenses has the same Paid by card option; the day total now shows cash only, with card spend on its own line.

### Database
- Migration `100_expense_paid_by_card.sql` adds `cash_expenses.paid_by_card`.

## [2026-09-27 — Delivery checks in Overview H&S status + Action log widget fix]

### Admin Portal
- The Overview page's "H&S checks today" and "Week's H&S status" tiles now include delivery checks. Today's tile shows a "Delivery checks — N logged" line, and a delivery that failed a check with no corrective action turns the day red.
- Fixed: adding an "Action log" widget to an H&S Dashboard always failed. The API now accepts it.

## [2026-09-27 — Sidebar always collapses to a hamburger on tablets]

### Admin Portal
- On any touch device (tablet or phone), the sidebar now always starts collapsed and opens via the floating hamburger button — regardless of screen width. Previously, a landscape tablet at ~1024px wide got the desktop sidebar (a permanent icon rail, or the expanded sidebar reserving layout width) instead.

---

## [2026-09-26 — H&S Dashboard tabs moved next to date selector]

### Admin Portal
- H&S Dashboard's named-dashboard tabs (Daily Checks / Weekly Checklist / etc) now sit in the same row as the date navigator instead of on their own row below it.

## [2026-09-26 — Mobile Wages "Paid" checkbox + submitted-report fixes]

### Mobile App
- Mobile Wages' "Paid" field is now a checkbox instead of a second amount field — ticking it counts the staff member's full "To be paid" amount toward cash reconciliation, unticking counts nothing.
- The "Paid" checkbox now works correctly even after a week's wage report has been submitted, fixing a bug where ticking it (or editing any other wages field) on a submitted report silently failed to save ("Save failed", no explanation).
- "To be paid" editing and adding/removing staff are now disabled while a report is submitted, with a note explaining why, instead of silently failing to save.

### API
- New `PATCH /venues/:id/cash-recon/wages/:week_start/entries/:entryId/paid` endpoint marks a single wage entry paid or unpaid, independent of the report's submitted status.

## [2026-09-26 — Mobile Cash Up day header + Mobile Wages row layout]

### Mobile App
- Cash Up's day view header now shows the day and date as "Mon, 21 Sep" instead of just "21 Sep".
- Removed the status badge from the day header — the Submit/Unsubmit button already shows that.
- Mobile Wages now shows each staff entry as a single compact row (name + to-be-paid + paid + delete) instead of a taller card with the amount fields on their own line — column labels moved to a header row shown once above the list.

---

## [2026-09-26 — Mobile Cash Up's day view is now a single header]

### Mobile App
- Fixed the Cash Up mobile module showing two stacked headers when you opened a day's declaration. It's now one header: back arrow, a short date (e.g. "21 Sep"), the day's status and save indicator, a Submit/Unsubmit button, and sign out.

---

## [2026-09-25 — Mobile Cash Up, Wages and Expenses now always show the venue picker]

### Mobile App
- Fixed the Cash Up, Wages and Expenses mobile pages hiding their venue picker for single-venue restaurants, which didn't match the desktop Cash Reconciliation page (which always shows it). All three now show the venue picker whenever there's at least one venue.

---

## [2026-09-25 — Fixed: the menu button could be completely hidden on a phone]

### Admin Portal
- Fixed a bug where the menu (hamburger) button was hidden underneath the page's own header on Cash Reconciliation at phone width, making it impossible to open the sidebar or navigate anywhere else. The menu button now always stays on top and reachable, on every page.

---

## [2026-09-25 — Sidebar header now shows your restaurant name]

### Admin Portal
- Fixed the sidebar header's logo and title not lining up cleanly when the sidebar is open.
- The sidebar header now shows your current restaurant's name instead of the "Macaroonie" logo text. If your account has access to more than one restaurant, a small arrow appears next to the name — tap the name or arrow to switch restaurants.

---

## [2026-09-25 — Cash Up and Wages added to the mobile app]

### Mobile App
- New **Cash Up** mobile module: this week's days listed with status, income and variance at a glance, tap a day to open the full declaration, with a week-total tile below the list.
- New **Wages** mobile module: this week's staff list narrowed to just names, what's owed, and what's been paid in cash — everything else stays exactly as set on desktop.

---

## [2026-09-25 — Overview page made phone-friendly + a persistent mobile/standard switch button]

### Admin Portal
- The Overview (home) page's tile layout now reflows properly on a phone-sized screen instead of squeezing into a fixed 4-column grid — tiles stack full-width or half-width as the screen narrows.
- Fixed a bug where the Overview page's title sat directly underneath the menu button on narrower screens.
- Added a small floating **Mobile view** / **Standard view** button, bottom-left, that appears any time you're on a phone-sized screen — tap it to switch between the regular admin portal and the phone-optimised `/mobile` view, in either direction, as often as you like.

---

## [2026-09-25 — Desktop now offers to switch to the mobile view on a phone]

### Mobile App
- Opening the regular admin portal on a phone held upright now shows a pop-up offering to switch to the phone-optimised `/mobile` view instead. Dismiss it either way and it won't ask again on that device.

---

## [2026-09-25 — Order Sheets now available on /mobile]

### Order Sheets
- Order Sheets is now a tile on the `/mobile` hub — browse orders, filter by status or venue, tap in to fill quantities and mark an order Ready or Placed, right from your phone. Same screen and data as the desktop page.

---

## [2026-09-25 — Login: smarter tenant selection, no more dropdown]

### Login & tenant switching
- If you only work in one restaurant, you're now dropped straight in — no picker screen, not even a flash of one.
- If you work in more than one, you're signed back into whichever one you used last, same as before, but if you've never picked one on this device (or your access changed), you now get a clean pop-up to choose instead of a full-page list.
- The tenant switcher in the sidebar is now a proper button that opens the same pop-up, replacing the old dropdown menu — easier to tap accurately on a tablet.

---

## [2026-09-25 — Mobile H&S Dashboard: fixed overlapping temp table headers]

### Health & safety
- The Fridge/Freezer and Holds temperature tables on the `/mobile` H&S Dashboard had a layout bug where the header row's text could overlap on a phone screen (the Equipment/Station column bled through onto the Range column). Fixed, and the Range (guideline) column is now hidden on phone width — it wasn't needed there — freeing up room so the temperature entry column fits on screen without scrolling. Equipment/station names now wrap onto a second line on mobile instead of forcing the column too wide.

---

## [2026-09-25 — Week grid: visible "Open day" link]

### Cash Reconciliation
- The day columns in the week grid always could be clicked to open that day's declaration — now each one shows a small "Open ›" line so it's obvious without having to discover it by hovering.

---

## [2026-09-25 — Expense VAT amount] *(migration 099)*

### Cash Reconciliation
- Petty cash expenses can now record a VAT amount alongside the gross amount — just for the record, it's never added to or deducted from any total (the gross figure already covers VAT everywhere in reconciliation). Available on desktop and in the `/mobile` Expenses page.

---

## [2026-09-25 — Per-venue brand & theme overrides, Identity page removed] *(migration 098)*

### Website — Brand & theme
- A multi-venue tenant can now give one venue its own complete Brand & theme (identity, colours, fonts, layout) instead of every venue sharing the exact same look. Open Brand & theme and click **+ Add site override**, pick a venue, and it gets its own tab — starting as a copy of today's tenant defaults, editable independently from then on. **Remove override** switches that venue back to the shared default. Single-venue restaurants see no selector at all — just the one Brand & theme, as before.
- The separate per-venue "Identity" page (site name/tagline/logo/favicon) has been removed — it's fully replaced by the above, and covered strictly less (no colours/fonts/layout). It also turned out its site name/tagline fields had no effect on the published site at all — logo and favicon were the only parts that ever worked, and those are now part of the full override instead.
- Boxed-inset theme steps can now have a separate value for mobile portrait screens, applying everywhere that step is used (the site default and any block that's picked it) — see the 2026-09-24 entry below for the initial (theme-default-only) version; this is the same feature extended to per-block overrides too.

---

## [2026-09-24 — Reconciliation variance fixed, Net Cash cash-only, website background image] *(migration 097)*

### Cash Reconciliation
- **Fixed inverted variance sign.** Variance now reads Takings (actual) − Income (expected): a positive number means you took in more than declared (surplus), a negative number means you took in less (shortfall). Previously it was calculated the other way round, which read backwards from what most people expect.
- **"Net Cash" and the renamed "Cash to bank" row now only count channels flagged as actual cash.** Card, voucher and online-link takings never become physical cash in the till, so they no longer inflate these two figures. Mark a channel "Counts toward Net Cash" (on by default only for the "Cash" type) in Cash Recon settings → Payment channels; non-cash channels show a small "Non-cash" tag wherever they're listed in Takings.
- "Net Position" (the week view's final wage-adjusted row) is now labelled "Cash to bank".

### Website theme
- Boxed-inset step values can now have a separate value for mobile portrait screens (≤600px) — e.g. step 1 = 16px on desktop, 8px on mobile — tick "Mobile" under any step in Brand & theme → Layout.
- New "Background image" option under Brand & theme → Colours — an optional image behind the background colour, shown fixed and covering the viewport on every page.
- Renamed the venue "Hero" section in the Pages nav to "Identity" — it's always configured site identity fields (site name, tagline, logo, favicon), never hero image/overlay settings, which already live in the Hero block itself and the theme's Hero settings.

---

## [2026-09-24 — Service charges can now deduct, not just add] *(migration 096)*

### Cash Reconciliation
- Each service charge/tips source now has two independent settings — "Effect on Takings" and "Effect on Income" — each set to No effect, Add, or Deduct. Previously a source could only ever add to Takings or subtract from Income; now either side can go either way, for cases like a charge that needs deducting from the till count.
- Existing sources keep computing exactly the same numbers as before — nothing changes unless you go in and pick a new setting.

---

## [2026-09-24 — H&S dashboard breakdown + reopen, Cash Recon theming fix, mobile expenses]

### Overview — H&S today tile shows every check individually
- The "H&S checks today" tile now lists each checklist by name (done/not done) plus a line each for fridge/freezer checks, hold checks and cooking checks, instead of just an overall status badge.

### Checklists can now be reopened from the H&S Dashboard
- Previously only the Checklists page itself let you reopen a completed checklist. The H&S Dashboard's checklist widget (desktop and mobile) can now do the same — tap the "Complete" badge, then confirm.

### Cash Reconciliation — visual fixes
- The coloured accent band on each section is now header-only; the totals footer is back to plain, per feedback that two accent bars per card was too heavy.
- Fixed a layout bug where stacked sections on the daily-declaration page had no visible gap between them.
- Fixed "Add expense" silently failing to save on every attempt — it's worked from the start of this release, but the bug behind it went unnoticed until now.
- H&S Dashboard widget headers now use the same brand accent colour as Cash Reconciliation.

### Mobile: record expenses
- New "Expenses" module on the `/mobile` app — log a petty cash expense and snap a receipt photo with your phone's camera, without opening the full Cash Reconciliation page.

---

## [2026-09-24 — Menu calories + section category icons] *(migrations 094 + 095)*

### Menus
- Dishes can now carry an optional calorie count (kcal), shown next to the price on your website's menu, the printed menu, and the page-builder preview.
- Menu sections (Starters, Curries, …) can now have a small category icon/image next to the section title — it always displays small, no bigger than the heading text next to it, whatever size image you upload (64×64 or 96×96 works well).
- First-ever Help and Docs pages for the Menus feature.

---

## [2026-09-24 — Cooking check delete, dashboard widget height fix]

### Food safety — delete a cooking check
- Tapping a logged cooking temperature to correct it now also offers a "Delete this reading" option (double-confirm) for entries logged in error.

### Dashboards — set height is now enforced
- Both the H&S Dashboard and Overview's customisable widgets now hold the height you set even when the widget's content is shorter — previously a short widget would shrink below the size you picked.

---

## [2026-09-24 — Mobile PWA: /mobile section + H&S Dashboard]

### /mobile — a phone-optimised area of the same app
- New `/mobile/*` route tree, sharing the existing login, API and deploy pipeline — no new server, domain, or Auth0 app required.
- Installs to a phone home screen as its own app, "Macaroonie Ops", with its own icon and colour — separate from the main "Macaroonie" install, even though it's the same site.
- `/mobile` opens to a hub of tiles, one per available mobile-optimised page — built so more mobile pages can be added over time without reworking this shell.

### Mobile H&S Dashboard
- First mobile module: a phone-portrait version of the H&S Dashboard with full functionality — multiple named dashboards, add/remove/reorder widgets, tick checklists, log temperature/hold/delivery/cooking checks, the action log — all reading and writing the exact same data as the desktop page.
- Laid out as a single scrolling column sized for one hand, rather than the desktop's resizable multi-column grid.

---

## [2026-09-24 — Website margin steps, admin brand theming, food safety keypad + edit-on-tap]

### Website theme: tenant-customisable boxed-inset margin steps
- The 5 boxed-inset margin steps used across every website block can now be redefined per tenant instead of a fixed 16/24/40/64/96px scale — mix pixels and percentages freely (e.g. a fixed 20px on mobile portrait, 5% everywhere else). New "step values" editor on Website → Brand & theme → Layout.

### Admin portal: brand-accent section styling
- Cash Recon's Income / Service Charges & Tips / Takings / Wages / Expenses cards now show a coloured header and footer bar using your website's own brand accent colour, replacing the previous flat grey dividers.

### Menu inline block — canvas/live parity fix
- The page builder's live preview for the Menu (inline) block now correctly hides zero-priced and unpriced variant options exactly as configured, matching what was already correct on the published site.

### Food safety — quicker, more reliable temperature entry
- Fridge/freezer and hot/cold-hold readings now start pre-filled at the low end of the normal range instead of a blank field.
- On touch tablets where the on-screen keyboard doesn't reliably appear, tapping a temperature field now opens a built-in numeric keypad instead.
- Cooking checks: tap any entry in "Today's checks" to reopen and correct that reading.

### Wages bug fix
- Fixed: a week that had never been saved before didn't auto-populate from the venue's default staff list.

---

## [2026-09-24 — Wages UX overhaul + cash-only net balance] *(migration 093)*

### Wages page redesign
- Each staff wage entry rebuilt from 4 stacked blocks into a single compact grid row: Staff / Type / Hours / Rate / Total / Cash paid / Notes / Remove.
- New "Set as default" action saves the current week's staff list (who's included, and their Fixed/Hourly setting) as the venue's default — future weeks with no saved entries auto-populate from that list instead of the full active-staff roster.
- Removed the "Load template" button and its confirmation popup (violated the app's no-native-popups rule) — replaced by the non-destructive "Set as default".

### Cash-only net balance
- Cash recon's net-position calculation now subtracts only the cash-paid portion of wages (`cash_amount`), not the full wage cost — a wage paid partly or fully by bank transfer no longer drags down the cash net position.
- A flag now appears wherever wages are shown in the recon view whenever a week's total wages don't match the cash-paid amount.

---

## [2026-09-24 — Navigation designer, quick-access launcher, H&S Action Log, Overview tiles, food-safety polish] *(migrations 091 + 092 + 093)*

### Navigation designer + quick-access launcher *(migration 091)*
- Replaces the previously-hardcoded sidebar (`NAV_SECTIONS` in `AppShell.jsx`) with an admin-configurable, arbitrary-depth nav tree per tenant (`nav_items`, self-referencing `parent_id`), with per-role visibility on top of the existing module-permission gating.
- New `/nav-designer` admin page (owner-only by default): outline editor (move up/down, indent, outdent — not free-form drag-and-drop reparenting) for the tree, add section/link with route picked from a static catalog so items can only ever point at real pages, per-item module gate + per-role hide + "show as quick-access tile" toggle, typed-confirmation reset to defaults.
- New tenant-wide `tenants.nav_style` toggle (`sidebar` / `launcher`). In Launcher mode the whole sidebar is replaced by a tile grid at `/launcher`, built from links flagged "show as a quick-access tile"; a single "Quick access" link stays in the sidebar as a safety net.
- New `/launcher` page: drag-reorder and hide/show tiles for yourself (persisted to `localStorage`, never a DB table — same pattern as other per-viewer prefs), "reset to admin defaults". A "Back to full menu" control in the page header is always visible whenever the tenant is in Launcher mode (regardless of how many tiles are configured), so nobody gets stranded without a sidebar.
- `GET /api/me` now returns `nav_tree` (pruned for the caller's effective role) and `launcher_tiles`.

### H&S Action Log *(migration 092)*
- New general facilities/compliance to-do list per venue — repairs, records, training, cleaning tasks with due dates and priority — migrated field-for-field from the legacy spreadsheet's "ActionLog" tab.
- Categories (Repairs / Records / Training / Cleaning by default) are a tenant-managed, reorderable list rather than a fixed enum — add/rename/reorder/retire your own.
- Not date-scoped like the other food-safety checks: an item stays open across days until ticked complete, recording who and when.
- Photo attachments via the existing Media library (no new upload path).
- New `/hs-action-log` admin page, and also available as an `action_log` widget on the H&S Dashboard.

### Dashboard renamed "Overview" + tile system *(migration 093)*
- The home page is renamed "Overview" and rebuilt as a tile layout — the four sections that used to be fixed (Quick access shortcuts, today's stats, upcoming bookings, venues status) are now tiles, in their original order, so nobody's home page changes shape on deploy.
- An owner/admin clicks "Customise layout" to add, remove, reorder, and resize tiles, and to set which roles can see each one.
- Two new tile types: **H&S checks today** (combined Checklists + Food safety completion status for today, across all venues, red/amber/green/grey) and **Week's H&S status** (the same, as a Monday–Sunday 7-day strip).
- No new module — gated by the existing Overview (formerly "Dashboard") module.

### Food safety / H&S Dashboard polish
- Drag-to-reorder added to the Equipment and Hold-stations management lists in Food safety.
- H&S Dashboard checklist widget's "Complete" action moved into the widget's own card header (was a full-width button at the bottom of the checklist).
- Deliveries tab redesigned: inline entry form + current-week list side by side, click any item in the list to load it back into the form for editing.
- H&S Dashboard container widened to 90% of panel width (was a fixed `max-w-6xl` cap).
- Cooking checks' category tabs and dish buttons restyled like till/POS buttons (fixed height, tighter width, distinct background fill so tiles read as tappable tiles instead of blending into the page).
- H&S Dashboard date navigator made touch-friendly: fixed-width date label (no more toolbar reflow switching between "Today" and a full date string), bigger outlined prev/next arrows, confirmed the native date-picker overlay still opens the OS calendar.

### Dashboard quick-access shortcuts
- Added Food safety, Checklists, and H&S Dashboard to the Dashboard page's own Quick access shortcut picker — a separate, older feature from the Navigation designer above, which had never been updated since those three modules shipped.

---

## [2026-06-04 — Reviews, dev tools, widget hold fixes, curly-quote crash fix] *(migrations 053 + 054 + 056 + 057)*

### Reviews system *(migration 056)*
- New `reviews` table with RLS. Three ingestion paths: Apify Google scraper, manual entry, CSV import.
- `POST /api/reviews/scrape` enqueues a BullMQ job (`reviewScrapeWorker.js`) that calls the Apify API via `apifySvc.js`.
- Moderation: `is_approved` + `is_featured` flags. Bulk-approve endpoint.
- Admin page at `/reviews` (sidebar nav) with filter/sort and stats card.
- `google_place_id` column added to venues. Requires `APIFY_API_TOKEN` env var.

### Dev tools *(migration 057)*
- **Backlog** (`/backlog`, platform-admin only) — 5-column Kanban with @dnd-kit drag between columns. Types: epic/story/task/bug/spike. Priority + story points.
- **Issue log** (`/issues`, tenant-facing) — ITIL-style tickets. Impact × urgency auto-derives P1–P4 priority. Platform admin can update status, resolve, and promote to backlog.
- **Feature requests** (`/feature-requests`, tenant-facing) — upvote toggle (cross-tenant `feature_request_upvotes` table). Platform admin sets lifecycle status and can promote to backlog.
- **Changelog** (`/changelog`, all users) — timeline list. Platform admin publish/unpublish. Tenants see published entries only.
- Three new modules: `issue_log` + `feature_requests` (group: support), `changelog` (core: true).

### Widget booking hold fixes *(migrations 053 + 054)*
- Migration 053: `booking_holds.table_id` made nullable — public widget holds are venue-level (no per-table selection) and were failing the NOT NULL constraint on every attempt.
- Migration 054: `confirm_hold()` rewritten — status check now excludes `no_show` + `checked_out`; for combination holds all member tables are verified, not just the first.

### Widget confirmation page
- Configurable heading text, rich-body HTML, and up to N CTA buttons (label + URL) per widget embed.
- Stored as `confirmHeading` / `confirmBodyHtml` / `cta_buttons[]` on block/tenant-defaults data shape.
- Editable via TipTap WYSIWYG in the block editor and Reservations Widget settings page.

### Bug fixes
- **Curly-quote crash in `reservations_widget.eta`** — 153 U+2018/U+2019 typographic quote characters introduced by the Edit tool during confirmation-page development caused recurring "Bad template syntax — Invalid or unexpected token" 500 errors. Four characters were inside the server-side `<% %>` block (lines 105, 106, 115, 116), breaking Eta/V8 on every widget render. Fixed via Python byte-level global replacement.

---

## [2026-05-16 — SEO/AI discoverability, widget displacement, timeline manual mode] *(migration 055)*

### SEO & AI discoverability
- **Schema.org JSON-LD** injected on every tenant site page: `Restaurant` entity with address, geo, phone, email, opening hours, menu link, `servesCuisine`, `priceRange`; `BreadcrumbList` on location pages. Output uses `<%~ %>` raw interpolation to avoid HTML-escaping JSON.
- **Open Graph + Twitter Card** meta tags on all pages. `og:url` and `canonical` are computed per-page (home vs location).
- **`llms.txt`** served at `/llms.txt` on every tenant subdomain/custom domain by `siteRenderer.js` — lists site name, venue locations with addresses, booking links, custom pages, and links to `sitemap.xml` and the public JSON API. `robots.txt` references it via a comment.
- **`robots.txt`** updated in both `siteRenderer.js` and `publicSite.js` to reference `llms.txt`.
- **Cuisine type + price range** fields added to `website_config` (migration 055). Exposed in the Website builder SEO section as "Restaurant details for search". Wired into the JSON-LD `servesCuisine` and `priceRange` fields. Price range is a `$`/`$$`/`$$$`/`$$$$` dropdown.

### Widget availability (public booking widget)
- **Combo-to-combo displacement** in `tryDisplaceCombo`: when a conflict has no free individual table, the system now also tries free existing combinations as displacement destinations.
- **SQL slot-availability subquery** extended to match — slots are shown as available only when every conflict on the target combo can be moved (to a free individual table OR a free combo).
- Both changes are in `widgetApi.js`; the JS displacement logic and the SQL availability check are kept in sync.

### Admin timeline cascade displacement
- **Chain-displacement (second cascade level)** added to `PATCH /bookings/:id/relocate`. When a conflict can't find a free single table or a fully-free combination, the system now tries combinations whose occupants can each be moved to a free individual table, all in the same atomic transaction. Covers scenarios like: 4-person on T3A+T3B wants T8+T9 but T8 has a 2-person who can move to T11.
- **Pre-configured combos bypass the non-adjacent rule** in step 3b. The adjacency rule exists to prevent auto-expansion from skipping over tables, but it shouldn't block combinations the operator explicitly created. Cross-section and disallowed-pairs rules still apply. Fixes 422 errors when table names like T3A/T3B create a sort-order gap.

### Timeline manual mode
- **Manual Mode toggle** (amber `Hand` button in the timeline sidebar). When enabled, drag-to-table calls `/relocate` with `manual_mode: true`: the allocation logic still runs (picks the right table/combo), but conflict detection and cascade displacement are skipped — the booking is placed directly, temporarily overlapping others if needed. Useful for resolving complex table puzzles by hand.
- State persisted to `maca_timeline_prefs` localStorage.
- Overlap stop-sign badges and red ring still show in manual mode so conflicts are visible.

### Timeline long-press for stacked bookings
- Pressing and holding a booking tile for **5 seconds** (without moving) opens the booking drawer for the tile stacked beneath it. Moving more than 8 px during the hold cancels it (drag takes over). Works on touch and mouse.
- `overlapPeerMap` computed alongside `overlappingIds`; `overlapPeerMapRef` used as a ref bridge to avoid Temporal Dead Zone crash (memo declared ~600 lines below the callback).

### Bug fixes
- TDZ crash fix: `overlapPeerMap` referenced in `handleLongPress` before its `useMemo` declaration — fixed with a `useRef` bridge synced in render.

---

## [2026-05-12 — Reservations widget rebuild + CMS polish] *(migrations 050 + 051 + 052)*

A from-scratch rewrite of the public booking widget and a broad cleanup of
the page builder. Built across the week of 2026-05-05 → 2026-05-12.

**Reservations widget (front-end + admin):**
- Routes renamed `/widget/:id` → `/reservations/:id` (and tenant equivalent).
  The old `widget.eta` + `booking_widget` block are gone; migration 052
  rewrites existing live data to `reservations_widget`.
- New `views/site/reservations_widget.eta` — clean state machine, fixed slot
  filter (was reading the non-existent `s.available_seats`), month-view
  calendar with prev/next + jump-to-date, closed-day hatching from a new
  `GET /widget-api/venues/:id/schedule-summary` endpoint.
- Three independent typography tracks: Body / Calendar date numbers / Time
  slot buttons, each with FontPicker + px-size slider. Single deduped
  Google Fonts URL covering all picked fonts with per-font weight specs.
- Calendar day colour controls (Open day + Closed day, each bg/fg/border).
- Per-block anchor ID (`<section id="<anchor>">`) so any link can target
  the widget.
- Live debug overlay (tri-state on block, boolean on tenant defaults;
  also accepts `?debug=1` URL override).

**Admin: Reservations widget settings page** (`/reservations-widget`,
sidebar nav "Reservations widget", replaces `/widget-settings`):
- Live preview iframe with per-venue switcher
- Share & embed card showing both Direct URL (copyable, clickable) and
  Iframe embed code per venue
- Same control surface as the page-builder block (header/button/borders/
  typography 3-track/day colours/messages/debug)

**Theme-only colour pickers:**
- New `ThemeColourPicker` component shows the 7 theme roles as swatches
  rendered with their actual brand hex. Stores role name (not hex).
- Replaced all hex `<input type="color">` widgets across the booking widget
  settings, block editor, scrolling-text, with role-only pickers.

**Block changes:**
- Dropped legacy `ticker` block (migration 051 → `scrolling_text`).
- Dropped legacy `two_column` block (migration 051 → `story_with_stamp`).
- Dropped legacy `booking_widget` block (migration 052 → `reservations_widget`).
- `scrolling_text`: clean rebuild, loads own Google Font with `!important`,
  no theme cascade, default Caveat. Size as multiplier of `--fs-base`.
- `gallery`: now sources from the per-tenant Media library (was disconnected
  per-venue `website_gallery_images`). By-category or pick-specific source
  modes. Three layouts (Grid/Masonry/Horizontal-scroll). Optional lightbox.
- `menu_inline`: section filter + dish filter + hide-prices + column count
  (1-4 with Auto) + flow direction (Snake CSS-multi-column vs Wrap CSS-grid)
  + section header toggle + subheader override.
- `columns`: 1-4 columns (was 2-4).

**Mobile responsive partials:**
- `menu_inline`, `dish_list`, `reviews_band`, `story_with_stamp` now use
  scoped `_blockId` classes + `@media` collapse rules so the grids don't
  stay multi-column on phones.
- `header` block has 5 mobile-visibility flags + breakpoint.
- `head.eta` body has `overflow-x: hidden` defensive guard.

**Schema (migration 050):**
- `tenant_site.widget_settings jsonb DEFAULT '{}'` — single JSONB column
  for all booking widget defaults.

**Migrations:**
- 050: `tenant_site.widget_settings` jsonb column.
- 051: rewrite `ticker` → `scrolling_text` and `two_column` →
  `story_with_stamp` in tenant_site.home_blocks + website_config.page_blocks.
  Idempotent.
- 052: rewrite `booking_widget` → `reservations_widget` same way.

**Bug fixes (notable, each documented as a CLAUDE.md gotcha):**
- `el()` helper was passing `disabled: false` through to
  `setAttribute('disabled', false)` which **still disables** the button —
  every calendar cell + slot was wrongly dead-clicked for days.
- Eta's `autoEscape: true` was HTML-escaping the `"` in CSS font-family
  strings to `&quot;`, breaking every font picker silently — fixed by
  switching font-family CSS to `<%~` raw output.
- Eta auto-declares a function called `layout` at the top of every compiled
  template; `const layout = ...` in `gallery.eta` collided and 500'd the
  whole page. Renamed to `layoutMode`.
- `slot_result.slot_time` is `timestamptz` (since migration 020), not
  `time` — `widgetApi` `.slice(0,5)` was throwing because it's a Date
  object. Now `Intl.DateTimeFormat` in venue timezone.
- Slot filter on the widget was `s.available_seats >= state.covers`; the
  PG function returns `s.available` (bool) and `s.available_covers` (int).
  Field name was wrong, every slot was rejected.
- HoldBody Zod requires `guest_name` — widget was sending only
  `{ starts_at, covers }` and the hold POST failed 422 silently. Widget
  now sends guest details in the hold body.
- Google Fonts v2 returns 400 for the entire stylesheet if any single
  requested weight is missing on any font. Added `FONT_WEIGHTS` maps to
  `head.eta`, `FontPicker.jsx`, and the widget partial — each font only
  requests its actual supported weights.
- Nginx default `client_max_body_size: 1m` was silently 413'ing every PNG
  upload. `setup.sh` now sets `30M` to match the API ceiling; live servers
  need manual nginx config update (one line).

**Files added/deleted:**
- Added: `api/src/views/site/reservations_widget.eta`, `api/src/views/site/blocks/reservations_widget.eta`, `admin/src/pages/ReservationsWidget.jsx` (renamed from WidgetSettings.jsx), `admin/src/components/website-builder/ThemeColourPicker.jsx`, `migrations/050_tenant_widget_settings.sql`, `migrations/051_drop_legacy_blocks.sql`, `migrations/052_drop_booking_widget_block.sql`
- Deleted: `api/src/views/site/widget.eta`, `api/src/views/site/blocks/{ticker,two_column,booking_widget}.eta`, `admin/src/components/website-builder/editors/TwoColumnEditor.jsx`

---

## [2026-05-09 — Structured menu manager] *(migrations 048 + 049)*

End-to-end menu management. Replaces the previous PDF-only `website_menu_documents`
flow with a proper structured model.

**Schema (migration 048):**
- `menus` (per tenant or per venue) — name, slug, tagline, service_times,
  intro_line, is_published, print_columns
- `menu_sections` — title, subtitle, highlight (cream-bg "house favourites" sections)
- `menu_items` — name, native_name (e.g. ผัดไทย), description, price_pence,
  notes ("Min 2", "pp"), is_featured
- `menu_item_variants` — Chicken £12.50 / Pork £12.50 / Prawns £13.40 / Beef £13.00
- `menu_dietary_tags` (per tenant) — code (gf, v, n, spicy), label, glyph, colour
- `menu_item_dietary` — M:N item ↔ tag
- `menu_callouts` — Allergies & Diet, Go Large, Make It Thai Hot, Order & Book
- All RLS-scoped via the existing `app.tenant_id` pattern

**Module registration (migration 049):** seeds `tenant_modules` row for `menus` on
every existing tenant + adds `menus: 'manage' | 'view'` defaults to all built-in roles.

**API** — `/api/menus` mounted in app.js:
- `GET    /` — list all menus for tenant (optional `?venue_id=` filter)
- `GET    /:id` — full structure (sections + items + variants + dietary)
- `POST   /` — create menu metadata
- `PATCH  /:id` — single bulk-upsert that rewrites the whole tree
  (server delete-and-reinserts under the `menu_id`; admin form holds the
  full menu in React state and posts on Save)
- `DELETE /:id`
- `POST   /seed/:slug` — seed a sample menu (`onethai-dinner` / `onethai-lunch`)
  with full content from the One Thai screenshots
- `GET    /dietary/all`, `POST/PATCH/DELETE /dietary` — tenant dietary tag CRUD
- `GET    /public/:menuId` — unauthenticated read for the website (gates on
  tenant_site.is_published)
- `GET    /:id/print` — public printable A4-landscape HTML; the browser handles
  "Save as PDF" via its print dialog (no server-side PDF dependency)

**Sample data** ([api/src/services/menuSeeds.js](api/src/services/menuSeeds.js)) —
the full One Thai Dinner + Lunch menus from the supplied screenshots, with
sections, dishes, variants, dietary tags, and footer callouts. Reusable as a
template for any tenant via `POST /menus/seed/onethai-{dinner|lunch}`.

**Admin** — new `/menus` page in main nav (Chef-hat icon, between Website and Media):
- List view: shows all menus per tenant with status, scope, tagline, Print + Edit + Delete
- "Sample menus" panel: one-click seed buttons for One Thai Dinner / Lunch
- "New menu" modal: name + slug + tagline + scope (tenant or venue)
- Edit view: nested forms for menu meta + sections + items + variants + dietary
  tag toggles + callouts. Single Save that PATCHes the whole tree.
- Sticky top + bottom save bars; visible Save error banner on failure

**Website CMS — new `menu_inline` block:**
- Picks an existing menu by id, renders sections + items + variants + dietary
  badges inline on the page (alternative to the existing PDF link block)
- SSR data hydration: `siteDataSvc.loadTenantBundle()` + `loadLocationBundle()`
  scan `home_blocks` / `page_blocks` for any `menu_inline` references and
  batch-load the menus once; the partial renders from the pre-hydrated map
  without an N+1 query at render time
- Admin editor pulls the tenant's menu list via `useQuery(['menus'])` and shows
  a dropdown picker

**Print route:** `/api/menus/:id/print` — A4-landscape HTML with the brand
colour, multi-column layout, dietary badges, callout grid, and a "Save as
PDF / Print" button (hidden in print). Operators print via the browser's
own dialog.

---

## [2026-05-08 — Block-first website CMS] *(migration 047)*

The CMS is now a single block model end-to-end. Header / footer / Onethai
showpiece — all the chrome that used to be hardcoded Eta partials — are now
first-class block types that operators edit in the page builder.

**Six new block types** ([blockRegistry.js](admin/src/components/website-builder/blockRegistry.js)):
- `header` — sticky nav with logo, brand text, link list, booking CTA. Replaces
  the per-template `partials/header.eta`. Editable via the inspector
  (add/remove/reorder links, override brand text, customise CTA).
- `footer` — multi-column footer with brand block, custom columns, auto legal
  links (Terms/Privacy/Cookies), copyright override, powered-by toggle.
- `ticker` — scrolling text strip (the Onethai food-name ticker), editable
  items list, choice of script vs sans font, scroll speed, background colour.
- `story_with_stamp` — two-column story section with optional dashed-pill
  "X years" badge.
- `dish_list` — multi-column menu sample with name + native script + heat dots
  + price + description per dish.
- `reviews_band` — coloured band with N customer reviews (stars + quote +
  attribution).

**Templates as starter blocks:** picking the Onethai page-template now seeds
the canvas with `[header, hero, ticker, story_with_stamp, dish_list,
reviews_band, find_us, contact, booking_widget, footer]` pre-filled with
Thai-restaurant content — every section is editable. Picking a template ALSO
auto-applies matching theme defaults (deep-merged over operator overrides) so
colours and fonts come along.

**Eta cleanup:**
- `index.eta` / `location.eta` now render blocks-only, auto-prepending a
  default header block + auto-appending a default footer if the array doesn't
  contain them.
- `fallback_home.eta` and `fallback_location.eta` deleted (Onethai-specific
  showpieces that became dead weight).
- `partials/header.eta` and `partials/footer.eta` now exist as 4-line shims
  that delegate to the block renderer — keeps supporting pages
  (`locations.eta`, `menu.eta`, `menu_hub.eta`, `page.eta`) working without
  touching them.
- `shared/head.eta` conditionally includes `templates/onethai/partials/styles`
  when `template_key = onethai`.

**Admin cleanup:**
- "Header & footer" form-based section dropped (nav links, footer columns,
  CTA fields, copyright override). All of it is now in the block editor.
- In-canvas SiteChrome (HeaderPreview / FooterPreview) and OnethaiShowpiece
  preview components deleted — the canvas now shows real React mirrors of
  the block partials.
- Migration 047 drops `tenant_site.header_cta`, `nav_extra_links`,
  `footer_columns`, `footer_copyright`. Zod schema updated.

---

## [2026-05-08]

### CMS architecture flip: one site per TENANT *(migration 043)*

The website CMS now serves **one site per tenant** (master franchisee)
instead of one site per venue. Each venue becomes a `/locations/{slug}`
page under the single tenant URL.

**Schema (migration 043):**
- `tenant_brand_defaults` renamed to `tenant_site` and absorbed: `subdomain_slug`,
  `custom_domain`, `custom_domain_verified`, `site_name`, `tagline`,
  `meta_title`, `meta_description`, `home_blocks` (jsonb), `is_published`,
  `default_widget_venue_id`, plus locations-index settings
  (`hide_locations_index`, `locations_heading`, `locations_intro`).
- `website_config` (per-venue) lost `subdomain_slug`, `custom_domain[_verified]`,
  `is_published`, `meta_title`, `meta_description`. Its `home_blocks`
  column was renamed to `page_blocks` (drives the location page layout).
- `website_pages.website_config_id` was replaced with a nullable
  `venue_id` (NULL = tenant-level page, non-NULL = venue-level page).
  Two partial unique indexes enforce slug uniqueness per scope.

**Routes (siteRenderer.js):**
- `/` → tenant home (renders `tenant_site.home_blocks`, falls back to
  `fallback_home.eta` with hero + locations grid).
- `/locations` → venues index (404 when `hide_locations_index = true`).
- `/locations/:venueSlug` → location page (renders
  `website_config.page_blocks`, falls back to `fallback_location.eta`).
- `/locations/:venueSlug/menu[/{id}]` → location menus.
- `/menu` → tenant menu hub (lists every venue with menus).
- `/p/:slug` → tenant-level custom page;
  `/locations/:venueSlug/p/:slug` → venue-level custom page.

**Booking widget:**
- `/widget/:venueId` (existing) — venue-direct deep link.
- `/widget/tenant/:tenantId[?venue=<id>]` (new) — tenant mode, step 0 is
  a location picker which is skipped when `?venue=` is provided.
- `booking_widget` block now resolves through 4 levels:
  block-level `venue_id` → current `it.venue.id` → tenant
  `default_widget_venue_id` → tenant widget URL with picker.

**Admin (`/website` page):**
- Top-level Tenant site mode (subdomain, brand, home page, locations
  index, SEO, analytics, banner) and a Location switcher for the
  per-venue page editor.
- `PageBuilder` now accepts `blocksField` / `saveEndpoint` /
  `invalidateKey` props so it can target either tenant `home_blocks`
  via `/website/tenant-site` or venue `page_blocks` via
  `/website/config?venue_id=X`.
- New endpoints: `/website/tenant-site` (GET/PATCH),
  `/website/tenant-site/slug-available`,
  `/website/tenant-site/verify-domain`. The legacy `/brand-defaults`
  endpoints remain as aliases for the tenant-site row during the cutover.

**Templates (classic + modern):**
- `index.eta` is the tenant home; new `locations.eta`, `location.eta`,
  `menu_hub.eta`, `fallback_home.eta`, `fallback_location.eta` cover
  the new routes. Header + footer partials are now context-aware:
  same template renders for tenant pages (Locations link, locations
  list in footer) and location pages (venue crumb, address + contact).

---

## [2026-05-03]

### Embeddable booking widget
- New public booking API at `/widget-api/*` — no auth, CORS-allow-all,
  scoped per `venueId`. Routes: `GET /venues/:id` (venue + booking rules +
  theme), `GET /venues/:id/slots`, `POST/DELETE /venues/:id/holds[/:holdId]`,
  `POST /venues/:id/holds/:holdId/confirm`. Mirrors the auth'd `/api/bookings`
  flow but resolves `tenant_id` from the venue lookup.
- New iframe-friendly page at `/widget/:venueId` rendered via a single
  `views/site/widget.eta` template — vanilla JS + CSS variables, ~400 lines.
  5-step flow: Covers → Date → Slot → Details → Confirmed. Theme via URL
  params (`?theme=light|dark&accent=hex`). Posts a `macaroonie:booking-confirmed`
  message to the parent window so embedders can run analytics / redirects.
- `X-Frame-Options: ALLOWALL` + CSP `frame-ancestors *` headers so any
  tenant site can embed it from any origin.
- New `<EmbedSnippet>` panel in the Website builder's Booking widget
  section: copy-paste the direct URL or the iframe HTML for use on third-party
  sites. The booking_widget block in the page builder also auto-embeds the
  iframe at the chosen scope/accent.
- Free booking flow only for v1 — Stripe deposit flow is a follow-up
  (deposit-required venues are rejected with a 422).

### Block-based page builder (Gutenberg-style)  *(migration 042)*
- New `home_blocks` JSONB column on `website_config` (and matching `blocks`
  on `website_pages` for a future round). Stores an ordered array of
  `{ id, type, data }` block records. When set, the SSR renderer iterates
  blocks via a dispatch partial; when null/empty, falls back to the legacy
  flat layout for backwards compat.
- **14 block types** registered: `hero`, `text`, `image`, `two_column`,
  `cta_strip`, `gallery`, `opening_hours`, `find_us`, `contact`,
  `booking_widget`, `menu_pdfs`, `allergens`, `faq`, `divider`. Content
  blocks store their data on the block itself; data blocks (gallery, hours,
  contact, etc.) read from the existing config + related tables at render
  time and just expose a heading + display options.
- **Page builder UI** at `/website` → "Page builder" tab (top of the venue
  sidebar). Block list with drag-to-reorder, expand-to-edit-inline,
  duplicate, remove, "add block below". Bottom add-block button. Block
  picker modal grouped by category (Hero / Content / Layout / Live data).
  Save/Reset buttons with dirty indicator.
- **3 starting templates**: Restaurant Classic, Modern Bistro, Minimal Café —
  plus "From scratch" empty option. Each template is an array of blocks
  that gets cloned on apply.
- **New per-block Eta partials** under `views/site/blocks/` — one per type
  plus a dispatcher (`renderer.eta`) that switches on block.type.
- **Templates wire up via single `home_blocks` check** at the top of
  `index.eta` — both `classic` and `modern` use the same block partials.

### Website CMS round-2 improvements *(migration 041)*
- **All image uploads land in the Media library.** `/website/upload` now mirrors
  every `kind=images` upload as a `media_items` row (filename + scope + hash) so
  the asset is browseable + reusable elsewhere. PDFs (kind=`menus|docs`) are
  unaffected — they're tracked via `website_menu_documents`.
- **About → rich text editor.** New `RichTextEditor` component (TipTap with
  Bold/Italic/Underline, H1/H2, lists, alignment, links, images via media library
  picker). Stored in new column `about_html`. Legacy `about_text` stays for
  backwards compat — templates render `about_html` when set, fall back otherwise.
- **Theme presets + live preview.** New `ThemePreview` block at the top of the
  Theme section showing a sample hero + body card with current theme variables
  applied as inline CSS — updates instantly. Six built-in presets (Classic
  burgundy, Modern mono, Warm terracotta, Fresh greens, Midnight bistro,
  Coastal blue) — one click loads + deep-merges onto the working theme.
- **Gallery layouts.** New columns `gallery_style` (grid | pinterest | horizontal)
  and `gallery_size` (small | medium | large). Templates render the gallery
  band based on these values: pinterest = CSS column-based masonry, horizontal =
  scroll-snap strip, grid = responsive auto-fill. Thumbnail size adjusts the
  `minmax()` width and fixed height per item.
- **Opening hours from venue schedule.** New column `opening_hours_source`
  (manual | venue). When `venue`, `siteDataSvc.loadSiteBundle` derives weekly
  hours from `venue_schedule_templates` + `venue_sittings` (earliest opens_at,
  latest closes_at per day-of-week, `is_closed` when template not open or no
  sittings). Hours admin shows a source toggle + read-only preview when in
  venue mode, falls through to the existing manual editor otherwise.

### Media library *(migration 040)*
- Per-tenant image library with categories, scope filters, picker + manager
  modes. Spec: see "Epic: Media Library" in project notes.
- New tables: `media_categories` (flat tenant tags) and `media_items`
  (uploaded images with category, scope, hash, dimensions). Both RLS-enforced.
- API at `/api/media`: CRUD for categories and items, multipart upload,
  duplicate pre-check (filename + SHA-256 hash within scope), bulk actions
  (delete / move-category / move-scope), distinct scopes endpoint.
- `sharp` added as **optionalDependency** for image dimension extraction —
  lazy-loaded so a broken native build doesn't crash the API.
- New reusable component `admin/src/components/media/MediaLibrary.jsx`.
  Two modes: `picker` (callback returns URL, "Insert selected" footer)
  and `manager` (organise without inserting).
- Features delivered in v1: grid + list views, search, category sidebar
  (create/rename/delete), scope filter dropdown, upload via button + drag-drop,
  duplicate detection with replace/keep-both/cancel dialog, progress chips,
  single + multi select, single detail panel with preview/rename/change
  category/change scope/delete, bulk move + delete, resizable detail panel,
  ESC + X close, fullscreen toggle.
- **Image editor** (crop / rotate / flip) shipped via `react-easy-crop` +
  canvas-based rotate/flip on export. Aspect-ratio presets: Free, 1:1, 4:3,
  3:2, 16:9, 9:16. Save modes: **Save as new** creates a fresh media item;
  **Replace original** swaps the file behind the existing item via new
  `POST /api/media/items/:id/replace` (id preserved so any references stay
  valid; old file deleted best-effort).
- Deferred to follow-up: brightness/contrast filters, advanced selection
  (shift-range), keyboard navigation between items.
- New `/media` route (standalone manager) + sidebar nav entry under the
  `website` module group.
- `ImageField` in Website.jsx now offers a "Choose from library" button on
  every image upload spot (logo, favicon, hero, about, OG, brand defaults,
  etc.) — falls through to the existing inline upload as the alternative.

---

## [2026-05-02]

### Wildcard SSL cert via Lightsail DNS hooks
- Wildcard `*.macaroonie.com` cert issued via Let's Encrypt DNS-01 with custom
  AWS CLI hook scripts that talk directly to the Lightsail DNS API (no Cloudflare
  / Route53 dependency).
- IAM user with `lightsail:GetDomain/CreateDomainEntry/DeleteDomainEntry` permissions
  + access keys configured in `/root/.aws/`.
- Hook scripts at `/etc/letsencrypt/lightsail-{auth,cleanup}.sh` add/remove the
  `_acme-challenge` TXT record automatically. Renewal via `certbot.timer` is fully
  automated; deploy hook reloads Nginx after each successful renewal.
- Nginx wildcard server block at `/etc/nginx/sites-available/macaroonie-wildcard.conf`
  proxies all subdomains to Fastify on :3000.
- Wildcard `* A <Lightsail-IP>` DNS record added — specific records take precedence
  so existing subdomains (`cogs`, etc.) keep pointing where they were.

### Email infrastructure: Postmark + Mailgun region + monitoring + send-test
- **Postmark** added as 5th email provider (`emailSvc.sendViaPostmark`). Uses
  Server Token via `X-Postmark-Server-Token` header. Branded click tracking is
  shared (`click.pstmrk.it`) — Postmark doesn't support per-customer custom
  tracking domains, by design.
- **Mailgun region picker (US/EU)** — EU accounts silently 401 against the US
  endpoint. Region is now stored on `venue_email_settings.provider_region`.
- **Email monitoring page** at `/email-monitoring` — combines SendGrid Stats +
  Suppression APIs with local `email_log` for a "what went out / what's in"
  view. New service `src/services/sendgridSvc.js`. New routes at
  `/api/email-monitoring/*`.
- **Stand-alone test email sender** in Widget Test page — `POST /api/email-templates/send-test`.
- **Migration 039**: extends `venue_email_settings.email_provider` CHECK
  constraint to include `'postmark'`.
- **POST upsert fix**: `/api/email-templates/settings/:venueId` POST used to
  drop every body field except `email_provider` on first save. Now both POST
  and PATCH route through the same upsert helper that persists every supplied field.

### Configurable RBAC — tenant module switches + custom roles  *(migration 038)*
- **Modules.** New `tenant_modules` table — per-tenant on/off switch per module.
  Disabled modules are hidden from the sidebar nav AND rejected at the API via the new
  `requirePermission()` guard. Owner-only toggles.
- **Module groups.** Tightly-coupled modules toggle together under one master switch:
  `bookings` group bundles bookings/venues/tables/schedule/rules/customers/widget_test;
  `email_templates`, `website`, `cash_recon` are their own groups; core modules (dashboard,
  team, settings, documentation) are always-on. The Modules tab in `/access` shows ONE
  switch per group — `PATCH /access/module-groups/:key` upserts every member in a
  transaction. The per-module endpoint stays as an internal-use API.
- **Roles.** New `tenant_roles` table with a `permissions` JSONB mapping
  `module_key → 'manage' | 'view' | 'none'`. Four built-in roles seeded per tenant
  (owner/admin/operator/viewer) — built-in permissions can be edited but their key
  and the row itself are protected. Custom roles fully editable; can't be deleted
  while users reference them.
- **`users.custom_role_id`** (nullable FK to `tenant_roles`) takes precedence over
  the legacy `users.role` enum when set. The migration backfills it for existing
  users so behavior is unchanged on day one.
- **New module registry** at `api/src/config/modules.js` — single source of truth
  for the 14 modules, descriptions, and per-built-in defaults. To add a new module
  in future, just add it here and the migration/API/UI all pick it up.
- **New API**: `GET /api/access/modules`, `PATCH /api/access/modules/:key`,
  `GET /api/access/roles`, `POST/PATCH/DELETE /api/access/roles[/:id]`.
- **New middleware**: `requirePermission('module', 'view'|'manage')` checks both
  tenant module enablement AND the user's role permission level. Platform admins
  always pass.
- **`/api/me` extended** with `enabled_modules: string[]`, `permissions: { [module]: level }`,
  and `effective_role` so the frontend can gate nav and per-page UI without extra calls.
- **AppShell**: nav entries are now filtered by `me.permissions[module]`. Modules
  whose level is `none` (because module is disabled at tenant level OR role doesn't
  grant access) are hidden completely.
- **New admin page `/access`** — two tabs (Modules + Roles). Permission matrix has
  three-state toggle pills per module. Owner-only mutations.

---

## [2026-05-01 — even later]

### Auto-provision Auth0 organisations on tenant creation
- **Platform → New Tenant** now creates the Auth0 organisation automatically. New
  helpers in `auth0MgmtSvc.js`: `createOrganization`, `getConnectionByName`,
  `enableOrgConnection`, `provisionTenantOrg` (a wrapper that creates the org and
  attaches Username-Password + Google connections with `assign_membership_on_login: true`).
- **`POST /api/platform/tenants`** accepts `auto_provision` (default true). When set
  AND no `auth0_org_id` is supplied AND M2M creds are configured, the API creates the
  org first, then inserts the tenant DB row with the resulting `org_…` id. The response
  includes an `auth0_provisioning` summary so the UI can surface partial failures.
- **Required new M2M scopes**: `create:organizations`, `read:connections`,
  `create:organization_connections`. Existing tenants don't need re-authorisation
  because the M2M app config carries over — but to use auto-provision you must add
  these scopes in the Auth0 dashboard (Applications → APIs → Auth0 Management API →
  Machine to Machine Applications → your M2M app → Edit Permissions).
- **Auth middleware hardening**: user-row reconciliation now races against a 3-second
  timeout, so a stuck DB query can never produce ERR_EMPTY_RESPONSE upstream. The
  `last_login_at` bump is fire-and-forget. Added a fallback in `GET /api/platform/tenants`
  that returns the tenant list without joins if the COUNT join query throws.

---

## [2026-05-01 — later]

### Auth0 Management API for full in-app team lifecycle  *(migration 037 seeds initial platform admin)*
- **No more Auth0 dashboard for tenant operators.** Inviting, role changes, deactivation, and
  password resets all flow through the Team page; only platform admins ever touch Auth0.
- **New service `api/src/services/auth0MgmtSvc.js`**: M2M client-credentials token fetch with
  in-memory cache (5min refresh buffer), `inviteUserToOrg`, `removeUserFromOrg`,
  `updateUserAppMetadata`, `sendPasswordResetEmail`. `isConfigured()` / `canInvite()` feature
  checks let callers degrade gracefully when env vars are missing.
- **`POST /api/team/invite`**: now sends an Auth0 organization invitation email. If Auth0
  returns non-2xx the local users row is rolled back before responding 502. Falls back to
  local-only insert with a warning when `AUTH0_MGMT_*` env vars are unset (dev mode).
- **`PATCH /api/team/:userId`**: when the role changes and the user has an Auth0 link,
  calls `updateUserAppMetadata({ role })` so the next JWT carries the new role. Best-effort
  — Auth0 failure logs but doesn't roll back; the local DB is source of truth.
- **`DELETE /api/team/:userId`**: soft-deactivates locally AND removes the user from the
  Auth0 org (so they can no longer obtain a JWT for this tenant). The Auth0 user account
  itself is preserved.
- **`POST /api/team/:userId/reset-password`**: owner-only. Triggers the Auth0
  `/dbconnections/change_password` endpoint so the user gets a one-time reset link by email.
- **`GET /api/team/auth0-status`**: feature flags consumed by the Team page so the UI
  shows an amber banner when Auth0 is unconfigured, and hides the password-reset button
  when `AUTH0_INVITE_CLIENT_ID` is missing.
- **Auth middleware reconciliation**: `requireAuth` now links `auth0_user_id` ↔ local user
  on every request. Three cases — already linked / first login after invite (link by email)
  / `is_active=false` (rejected with 403). The local DB is now the source of truth for
  `req.user.role` (not the JWT) so role changes take effect without an Auth0 token refresh.
- **Migration 037**: idempotent seed of the initial platform admin (Michal Wegrzyn) so
  `/platform` is reachable on first deploy without manual DB access.
- **New env vars** (all optional): `AUTH0_MGMT_CLIENT_ID`, `AUTH0_MGMT_CLIENT_SECRET`,
  `AUTH0_INVITE_CLIENT_ID`. See `api/.env.example` for the M2M scopes required.
- **Team page UI**: "Invite pending" badge for unlinked rows, password-reset key icon
  (with loading + success states), warning banner when Auth0 mgmt is not configured.

---

## [2026-05-01 session]

### Platform admin + tenant/user management  *(migration 036)*
- **Platform admins** (`platform_admins` table, no RLS): users who manage all tenants.
  Auth middleware detects by `auth0_user_id`, bypasses all role gates.
- **`GET /api/me`**: current user profile + list of available tenants with `auth0_org_id`.
  Powers the org switcher and platform admin detection on the frontend.
- **Platform admin routes**: `GET/POST/PATCH /api/platform/tenants` + `/stats` endpoint.
  Create tenants, edit name/slug/plan/active status, view venue/user/booking counts.
- **Team management routes**: `GET/POST/PATCH/DELETE /api/team`. Invite users, change roles,
  deactivate. Owner-only mutations. Self-protection (can't demote/deactivate yourself).
- **Org switcher**: dropdown in AppShell sidebar when user has multiple tenants. Triggers
  `loginWithRedirect()` with the target Auth0 org_id for a full re-authentication.
- **`VITE_AUTH0_ORG_ID` now optional**: omitting lets Auth0 prompt for org selection.
- **Team page** (`/team`): invite card, role dropdown per member, deactivate/reactivate,
  RBAC reference table. Owner-only mutations.
- **Platform page** (`/platform`): stats overview (4 cards), tenant list with venue/user
  counts, create/edit tenant cards. Platform admin only.

### Visual email editor (TipTap)
- Replaced raw HTML textarea with TipTap WYSIWYG editor.
- Toolbar: bold, italic, underline, headings, lists, alignment, link, image, divider,
  text colour picker, CTA button insertion.
- Visual / HTML mode toggle — content syncs both ways.
- `<a class="btn">` preserved via extended Link extension with `class` attribute round-trip.
- URL sanitisation: `isSafeUrl()` rejects `javascript:`/`data:`/`vbscript:` URIs.
- `escapeAttr()` prevents attribute breakout in button insertion.

---

## [2026-04-30 session]

### Booking email system  *(migration 035)*
- **Pluggable email service** (`emailSvc.js`): 4 providers (SendGrid, Mailgun, AWS SES, SMTP)
  selectable per venue. SendGrid is the default, falls back to `SENDGRID_API_KEY` env var.
  Per-venue credentials supported for all providers.
- **Default HTML templates**: confirmation, reminder, modification, cancellation. Clean,
  mobile-responsive, professional. 16 merge fields (`{{guest_name}}`, `{{booking_date}}`,
  `{{manage_link}}`, etc). Work out of the box with no admin setup.
- **Guest manage page** at `/manage/{token}` (SSR via Eta): view booking details, modify
  (date/time/covers), cancel (double-confirm). Themed per-venue. No login — UUID token
  IS the auth. `manage_token` column added to bookings (backfilled).
- **Email worker** (BullMQ): loads booking+venue+template, renders fields, sends, logs to
  `email_log` table. Reminder scheduling via delayed jobs (configurable hours-before).
- **Triggers**: confirmation on booking create, cancellation on status change, reminder
  auto-scheduled on confirm.
- **Admin page** at `/email-templates` with 3 tabs:
    * Templates: per-type editor, merge field pills, live preview iframe, reset-to-default
    * Settings: provider picker, credentials, sender identity, reminder toggle + hours,
      guest self-service permissions (allow modify/cancel, cancel cutoff hours)
    * Sent emails: audit log with status badges
- **Migration 035**: `email_templates`, `email_log`, `venue_email_settings` tables +
  `manage_token`/`reminder_sent_at` on bookings.

### Cash recon — SC included in income  *(migrations 033 + 034)*
- Renamed `included_in_sales` to `included_in_income` (migration 034, idempotent rename).
- XOR variance adjustment: the two SC flags work independently so operators can model
  4 scenarios (SC retained as revenue + in till, SC in income but not till, SC in till
  but not income, SC tracked only).
- Admin: "Included in Income" toggle + emerald badges + signed "SC adjustment" line
  in the daily summary.

### Auto-deploy migrations
- New `api/scripts/migrate.js` runner with `schema_migrations` tracking table.
- GitHub Actions workflow runs migrations between `npm install` and `pm2 restart`.
- Auto-baseline: `AUTO_BASELINE_UP_TO=024` env detects servers built by hand and
  baselines on first run. Manual baseline workflow available in Actions UI.
- `deploy.sh` updated with same hook. `deploy.yml` switched from `git pull` to
  `git fetch + reset --hard` to handle dirty server working trees.

### CLAUDE.md session protocols
- SOS Checklist, EOS Protocol, Standard Design Rules (11 rules), Doc maintenance
  section adopted from the COGS template.
- Table of Contents added. Gotchas section marked append-only.

---

## [Unreleased / Current]

### Tenant Website Builder / CMS  *(migrations 025 + 026)*

A multi-section website builder. Each tenant gets a public website
hosted at `{slug}.macaroonie.com` (and optionally a custom domain like
`book.wingstop.co.uk`). Fully configurable via a new admin page.

**Database** *(migrations 025_website_cms.sql, 026_website_custom_domain_templates.sql)*
- `website_config` — singleton per tenant; 60+ columns covering identity,
  branding, hero, about, find-us, contact, social, ordering, delivery,
  booking widget, SEO, analytics, feature toggles.
- `website_opening_hours`, `website_gallery_images`, `website_pages`,
  `website_menu_documents`, `website_allergen_info` — ordered
  collections with their own RLS policies.
- Migration 026 adds `custom_domain` (UNIQUE lower index),
  `custom_domain_verified`, `template_key` (`classic` | `modern`),
  and `theme` (JSONB) for per-tenant theming independent of template.

**API** *(new routes)*
- `POST/GET/PATCH /api/website/config` — singleton config
- `POST /api/website/verify-domain` — DNS A + CNAME verification for
  custom domains (checks resolv against PUBLIC_ROOT_DOMAIN / APP_PUBLIC_IPS)
- `GET /api/website/slug-available` — global uniqueness check
- Gallery, pages, menus, opening-hours, allergens CRUD
- `POST /api/website/upload` — multipart image / PDF upload via
  pluggable storage service
- `GET /api/site/:slug` — public JSON bundle
- `GET /api/site/:slug/sitemap.xml` + `robots.txt`

**Pluggable storage** *(api/src/services/storageSvc.js)*
- `STORAGE_DRIVER=local` → writes to `UPLOAD_DIR`, served by
  `@fastify/static` at `/uploads/*`
- `STORAGE_DRIVER=s3` → AWS S3, DO Spaces (`S3_ENDPOINT`), Cloudflare R2
  via optional `@aws-sdk/client-s3` peer dep (lazy-loaded)

**SSR renderer** *(api/src/routes/siteRenderer.js)*
- Detects `{slug}.{PUBLIC_ROOT_DOMAIN}` OR verified `custom_domain` on
  the Host header; reserved subdomains (api, www, …) bypass.
- Templates live in `api/src/views/site/templates/{classic|modern}/`
  — `index.eta`, `menu.eta`, `page.eta`, `partials/{header,footer}.eta`
- Shared `views/site/shared/head.eta` converts the `theme` JSONB into
  CSS custom properties (`--c-*`, `--f-*`, `--r-*`, etc.) and loads
  Google Fonts automatically for known families.
- Both templates consume the same CSS variables so a theme change
  applies regardless of which template the tenant picks.
- Emits Restaurant JSON-LD, OG/Twitter meta, GA4 + Meta Pixel snippets,
  sitemap.xml, robots.txt.

**Admin portal** *(admin/src/pages/Website.jsx, new route `/website`)*
- Left-rail navigation with 18 sections:
  Setup & domain · Template · Theme · Branding · Hero · About · Gallery ·
  Menus · Allergens · Opening hours · Find us · Contact · Online ordering ·
  Delivery · Booking widget · Custom pages · SEO · Analytics.
- **Theme manager**: 7 colour pickers, heading + body font dropdowns
  (Google Fonts), sliders for base size, heading scale, weights, line
  height, container width, section padding, grid gap, 3 radius sliders,
  logo height, 4 button sliders, hero overlay opacity + min-height.
- **Gallery**: drag-to-reorder grid via `@dnd-kit/sortable` (new dep),
  inline captions, bulk save.
- **Allergens**: two-mode (PDF upload | dish-by-dish table) with
  pill-selectable allergens (14 common UK/EU allergens).
- **Opening hours**: 7-day grid with multiple sessions per day
  (e.g. "Lunch" / "Dinner"), closed toggle, native time pickers.
- **Custom pages**: in-place CRUD; URL slug live-sanitised; appears
  at `/p/{slug}` on the public site.
- All image/PDF uploads go through a shared `FileUpload` / `ImageField`
  component calling `api.upload()` (new method on `useApi()`).
- First-time visit shows an onboarding card that POSTs a subdomain slug
  to create the `website_config` row.

**Deployment follow-ups** *(not yet applied to the server)*
- Nginx: wildcard server block for `*.macaroonie.com` proxying to the
  Fastify API; wildcard SSL via Certbot DNS challenge.
- DNS: wildcard A record for `*.macaroonie.com`.
- Custom domains: per-domain SSL provisioning (e.g. Caddy on-demand TLS
  or per-domain certbot); the app just resolves the Host header — it
  doesn't provision certs.
- Migrations now run automatically via `api/scripts/migrate.js`, invoked
  from both the GitHub Actions workflow and `deploy.sh`. On first deploy
  after this change, SSH in and baseline the tracker once:
  `cd /home/ubuntu/app/api && set -a; source .env; set +a; node scripts/migrate.js --baseline-up-to 024`
  Subsequent pushes will auto-apply 025, 026, and future migrations.

---

### Slot availability — last-order-time start rule  *(migration 020)*
- **Changed:** `get_available_slots()` now generates a slot as long as it **starts** at or before
  `closes_at` (last order time), even if the booking duration would run past that time.
  Previously, only slots that *completed* before `closes_at` were shown, which caused the last
  several slots of a sitting to be hidden unnecessarily.
- `slot_result` composite type extended with two new nullable fields:
  - `sitting_closes_at time` — the sitting's last order time
  - `sitting_doors_close time` — the sitting's doors close time
- `GET /slots` API now returns both new fields per slot.
- **Frontend warning in New Booking modal:** when a slot is selected and
  `slot_start + slot_duration > sitting_doors_close`, a red warning banner is shown.
  When it exceeds `sitting_closes_at` only, an amber warning is shown.
  Both are informational — the booking can still be created.
- **Migration:** `020_slot_start_filter.sql`

### Booking drawer — end-time editor
- Added **End time** button in the Date & time section of the booking drawer alongside the
  existing Reschedule button.
- Tapping "End time" reveals a native `<input type="time">` (OS picker on tablet/mobile)
  pre-filled with the booking's current end time.
- Save button appears in the drawer header as "Save end time".
- Calls the existing `PATCH /bookings/:id/duration` API endpoint.
- Midnight crossover handled: if the chosen end time is before the start time, the end date
  is bumped to the following day.

---

## [Session — UI polish + settings]

### Settings page  *(new page `/settings`)*
- New **Settings** page in the sidebar (icon: SlidersHorizontal).
- **Appearance section:** native `<input type="color">` + hex text field + 6 preset brand
  swatches. Changes apply live (instant preview).
- **Timeline defaults section:** toggles for Panel mode, Section dividers, and Hide inactive —
  persisted to `localStorage` under key `maca_timeline_prefs`.
- Default theme colour changed from blue to **`#630812`** (dark maroon/red).
- Theme applied via CSS custom properties (`--primary`, `--primary-foreground`) at runtime.
- New `SettingsContext` (`src/contexts/SettingsContext.jsx`) stores `themeHex` and applies
  it to the document root on mount. Persisted to `localStorage` under key `maca_settings`.

### Timeline toolbar → sidebar
The following controls were removed from the Timeline toolbar and moved to the **AppShell
sidebar**, above the logout button. They appear when the current route is `/timeline`.

- Venue selector (shown only when the tenant has >1 venue)
- **Inactive** toggle (formerly labelled "Cancelled & no-show hide toggle")
- Section dividers toggle
- Panel/drawer mode toggle (Columns icon)
- Refresh button
- Fullscreen button

In collapsed-sidebar (icon-only) mode the same buttons are shown as icon-only rows.

### Timeline toolbar
After the above move, the Timeline toolbar contains only date navigation:
← arrow · date input · → arrow · Today button.

### New booking — FAB
The **+ New booking** button is now a round floating action button (FAB) positioned at the
bottom-right of the timeline canvas (`absolute bottom-6 right-6 z-30`).
Previously it was in the toolbar.
On touch devices the FAB is 56×56 px (w-14 h-14).

### Booking tile shape
Removed the CSS `clip-path` polygon that gave booking tiles a pointy right-arrow shape.
Tiles are now plain rounded rectangles (`border-radius: 3px`).

### checked_out tile colour
Changed from light green (`#d1fae5 / #34d399`) to grey:
- Background: `#e5e7eb`
- Left border: `3px solid #9ca3af`

### Mobile customer search in New Booking modal
- On screens narrower than the `sm` breakpoint the customer suggestions panel
  (previously a side-panel to the right of the modal) now appears **inline below the
  phone field**.
- An **× dismiss** button closes the inline panel without clearing the search field.
- Desktop behaviour (`sm:` and above) unchanged — side panel to the right.
- Uses pure CSS responsive prefixes (`sm:hidden` / `hidden sm:flex`) — no JS resize listener.

### TimelineSettingsContext — panelMode persistence
`panelMode` state added to `TimelineSettingsContext` (previously managed locally in
`Timeline.jsx`). All three toggles (`hideInactive`, `groupBySections`, `panelMode`) are
persisted together to `localStorage` key `maca_timeline_prefs` on change.

---

## [Customers & GDPR]  *(migration 018 + 019)*

### Customer database  *(migration 018)*
- New `customers` table with RLS. Columns: `tenant_id`, `name`, `email`, `phone`, `notes`,
  `visit_count`, `last_visit_at`, `is_anonymised`, `anonymised_at`, `created_at`.
- `customer_id` FK added to `bookings`.
- `upsertCustomer()` helper in `customers.js` — called fire-and-forget after every booking
  confirm (free path, Stripe webhook, and admin-override).
- Walk-in and TBC emails are skipped in the upsert.

### Visit count  *(migration 019)*
- `visit_count` and `last_visit_at` columns added to `customers`.

### Customer API  (`/api/customers`)
- `GET /customers?q=` — search by name/email/phone; returns 20 most-recent if query < 2 chars.
- `GET /customers/:id` — detail + full booking history.
- `PATCH /customers/:id` — update name, phone, notes.
- `POST /customers/:id/anonymise` — GDPR erasure: replaces all PII with placeholders,
  anonymises linked bookings, sets `is_anonymised = true`. Never deletes the row.
- `GET /customers/:id/export` — GDPR data export as JSON download.

### Customers page  (`/customers`)
- Searchable customer list.
- Resizable detail panel (click a row to open).
- GDPR anonymise with double-confirmation.
- GDPR export download via `api.download()`.

### Customer search in New Booking modal
- Debounced search while typing in name/email/phone fields during booking creation.
- Matching customer records shown in a suggestions panel; clicking pre-fills all three fields.
- iOS autoFocus suppressed (`autoFocus={!IS_TOUCH}`) to prevent keyboard popup on modal open.

---

## [New booking statuses]  *(migration 017)*

- **`arrived`** (cyan) — guest has arrived; sits between confirmed and seated.
- **`seated`** — renamed from `completed`; guest is at the table.
- **`checked_out`** (grey) — new status after seated; guest has left.
- `checked_out` excluded from capacity calculations (same as `cancelled` / `no_show`).
- All affected status queries, timeline colours, and BookingDrawer selectors updated.

---

## [Bookings page redesign]

- **Guestplan-style time-grouped list** — bookings grouped by slot time with a header showing
  the time and cover count for that group.
- **Stats bar** — reservations / tables / guests counts for active bookings only.
- **Inline status dropdown** — change status without opening the drawer.
- **Phone number visible** in the list row.
- **Permanent resizable right panel** (280–700 px) showing BookingDrawer in `inlineMode`.

---

## [Walk In bookings]

- **Walk In** button added to guest step of New Booking modal.
- Skips all guest-detail fields; books immediately as "Walk In" with email `walkin@walkin.com`.
- No confirmation email sent for walk-ins.

---

## [Timeline — canvas click to ManualAllocModal]

- Clicking an empty cell on the Timeline canvas now opens **ManualAllocModal** directly
  (previously opened the slot-selection step of the standard modal).
- The clicked time and table are pre-populated in the manual allocation panel.
- Props `openManual` and `initialTableIds` added to `NewBookingModal`.

---

## [Timeline — current-time indicator]

- Red vertical line across all table rows showing current time.
- Dot and time label in the header bar at the top of the line.
- Today only — hidden when viewing past or future dates.
- Updates every 30 seconds.

---

## [Schedule exceptions]  *(migration 014 + 015)*

### Migration 014
- New tables: `schedule_exceptions`, `exception_day_templates`, `exception_sittings`,
  `exception_sitting_slot_caps`.
- `doors_close_time` column added to `exception_sittings`.

### Migration 015
- Fixed PG 55000 "record not assigned yet" error in `get_available_slots()`.
- `v_exc_template` RECORD replaced with scalar `v_exc_template_id uuid := NULL`.

### API
- Full CRUD for exceptions: `GET|POST /venues/:id/schedule/exceptions`, plus nested endpoints
  for day templates, sittings, and slot caps.

### Admin portal
- `ExceptionsSection`, `ExceptionCard`, `ExceptionDayCard` components in `Schedule.jsx`.

---

## [Doors close time per sitting]  *(migration 013)*

- `doors_close_time` column moved from `venue_schedule_templates` down to `venue_sittings`
  and `override_sittings` (per-sitting control instead of per-day).
- Template-level column kept for backwards compatibility but no longer used.

---

## [Booking rules — reconfirmed status]  *(migration 012)*

- `enable_reconfirmed_status` column on `booking_rules`.
- When enabled, a "Re-confirmed" status option appears in the booking drawer dropdown.
- Toggle added to Rules page.

---

## [Booking rules — unconfirmed status]  *(migration 012 — second file)*

- `enable_unconfirmed_flow` column on `booking_rules`.
- When enabled, new bookings default to `unconfirmed` status (operator must call to confirm).
- Toggle added to Rules page.

---

## [Doors close time]  *(migration 011)*

- `doors_close_time` column added to `venue_schedule_templates` (later superseded by
  per-sitting column in migration 013).
- `allow_widget_bookings_after_doors_close` added to `booking_rules`.
- Widget filters out slots at or after `doors_close_time` unless the rule is enabled.
- Admin bookings always bypass this filter.
- **Rules page:** "Opening hours enforcement" section with the allow-past-doors toggle.

---

## [Smart allocation — disallowed pairs + adjacency rules]  *(migration 010)*

- `disallowed_table_pairs` table — specific table pairs the engine must never combine.
- `allow_cross_section_combo` and `allow_non_adjacent_combo` flags on `booking_rules`.
- All three enforced in `PATCH /bookings/:id/relocate`.
- **Tables page:** "Disallowed pairs" section with add/remove UI.
- **Rules page:** smart allocation toggle section.

---

## [Unallocated row]  *(migration 009)*

- System-managed `is_unallocated` pseudo-table (one per venue, auto-created on first use).
- `sort_order = −999`, `max_covers = 9999`, excluded from widget and slot queries.
- Timeline renders it as an orange row at the very top when it contains bookings.
- Bookings dragged to a table that conflicts and cannot be re-placed are cascaded here.

---

## [Table combinations]  *(migration 008)*

- `table_combinations` and `table_combination_members` tables.
- Slot resolver returns `combination_id` per slot.
- `PATCH /bookings/:id/relocate` — cross-table drag with smart allocation and cascade displacement.
- `PATCH /venues/:id/tables/reorder` — drag-to-reorder on Tables page (always-visible grip handles).

---

## [Core features]  *(migrations 001–007)*

### Migration 001 — Tenants, users, auth0_org_id
- `tenants`, `users` tables. `auth0_org_id` column for Auth0 Organisations multitenancy.

### Migration 002 — Venues
- `venues`, `venue_sections` tables with RLS.

### Migration 003 — Schedules
- `venue_schedule_templates`, `venue_sittings`, `schedule_date_overrides`,
  `override_sittings`, `sitting_slot_caps`, `override_slot_caps`.

### Migration 004 — Booking rules
- `booking_rules`, `deposit_rules` tables.

### Migration 005 — Bookings
- `booking_holds`, `bookings` tables. `UNIQUE (table_id, starts_at)` on holds.
- `confirm_hold()` PG function with `FOR UPDATE NOWAIT`.
- Booking status enum: `unconfirmed | confirmed | pending_payment | cancelled | no_show`.

### Migration 006 — Functions
- `sweep_expired_holds()` — pg_cron job every minute.
- `get_available_slots(venue_id, date, covers)` — slot resolver PG function.
  Returns `SETOF slot_result`; handles priority chain, slot caps, holds, and zero_cap_display.
- `slot_result` composite type.

### Migration 007 — Seed data
- Example tenant, venue, tables, and schedule for development testing.

### API routes
- `/api/bookings` — holds, free-booking confirm, admin-override, list, status, move,
  relocate, duration, guest, tables, notes, delete.
- `/api/slots` — public slot availability with widget filtering.
- `/api/venues` — venue CRUD, tables, combinations, rules, deposit rules, disallowed pairs, reorder.
- `/api/venues/:id/schedule` — template days, sittings, slot caps, date overrides, copy-day, exceptions.
- `/api/payments` — Stripe PI creation, webhook handler, refund.
- `/api/customers` — search, detail, update, anonymise, export.

### Admin portal — initial pages
- **Timeline** — Gantt view, @dnd-kit drag (mouse + touch sensors), grey column overlay,
  pixel-accurate booking card positioning, combination tile spanning.
- **Bookings** — redesigned (see Bookings page redesign section above).
- **Customers** — see Customers section above.
- **Venues** — venue CRUD.
- **Tables** — table list, sections, combinations, sort order, disallowed pairs.
- **Schedule** — weekly template, sittings, slot caps, date overrides, exceptions.
- **Rules** — booking rules, smart allocation toggles, deposit config, status flow toggles.
- **Widget test** — full guest booking flow embedded in the portal.
- **Documentation** — this system documentation page (`/docs`).
- **Help** — operator user guide (`/help`).

### Auth flow
- Auth0 organisation-scoped login; `tenant_id` and `role` injected into JWT via Login Action.
- API middleware validates JWT via JWKS, resolves `auth0_org_id → tenants.id`.
- `req.tenantId` and `req.user.role` attached to every request.

### Deployment
- GitHub Actions CI/CD — push to main triggers automated build and deploy.
- Ubuntu 24.04 Lightsail; Nginx reverse proxy; PM2 process manager.
- `setup.sh` — one-shot provisioning. `deploy.sh` — subsequent deploys (used by Actions).

---

## Common mistakes & gotchas  *(reference)*

- Never query tenant tables without `withTenant()` — RLS silently returns 0 rows.
- `slot_duration_mins` ≠ `slot_interval_mins` — duration is booking length; interval is slot frequency.
- `max_covers = 0` on a slot cap ≠ fully booked — it means intentionally blocked.
- `slot_time` from PG is `HH:MM:SS` — always `.slice(0, 5)` before using as a key or sending to the API.
- `combination_id` must be copied from hold to booking on all confirm paths.
- `table_combination_members` has no `tenant_id` — never pass it to INSERT on that table.
- `notificationQueue.add()` must never be awaited in request path — always fire-and-forget.
- Customer anonymise never deletes the row — GDPR erasure by overwrite only.
- `api.download()` in the admin frontend — use for auth-protected binary responses (JSON exports).
- `admin-override starts_at` is server-local time — future work: send IANA timezone and convert.
- `get_available_slots()` v_exc_template_id must be a scalar uuid (not a RECORD field) — PG 55000.
- Migration 020 changed slot_result type — must DROP FUNCTION then DROP TYPE before recreating.
