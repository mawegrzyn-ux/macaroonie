# Outstanding: menus

What is not built, known limits and follow-ups in this area (`docs/claude/areas/menus.md`). Item numbers are the old CLAUDE.md numbering, kept so earlier references still work; a new item takes the next number after the highest in any file of this folder. Check the live code before calling anything here pending.

**19. Deliveroo menu file — follow-ups** *(shipped with migration 157)*
- Deliveroo's allergen and dietary codes come from their help pages and Menu API guide (the docs host couldn't be reached from the build environment); not yet checked by uploading a file to a live Deliveroo Hub. First real use: upload a small change, check the Hub shows the allergens, VAT and prices as expected.
- Only the item-level file. Modifier groups and options (Deliveroo's other bulk files), categories, item photos and availability aren't filled.
- One price per item: a dish sold with options is sent at its cheapest option's price; Deliveroo modifiers for the dearer options are still set in the Hub.
- The file lives in the browser tab only; nothing records which file was last downloaded or uploaded.
- No connection to Deliveroo's API (menu push, orders into the till or Cash Recon).

**21. Menu publishing — follow-ups** *(shipped with migration 165)*
- Option groups (Variant groups library), tags, the allergen notice, print designs and the online-ordering sold-out list are tenant-wide and change straight away, not on publish. A dish's own option prices are in the release, but the till's nested option groups (`groups` in `tillConfig()`) come from the live library.
- Promotions point at dish / section ids; a promotion on a dish that is only in the draft does nothing until the menu is published (and one on a dish removed from the draft keeps working while the dish is live).
- Releases are never deleted (one row per publish with the whole menu as jsonb); add a clean-up of old past releases if menus are published very often.
- A scheduled publish freezes the draft as it was when scheduled; later saves aren't included unless published again (the card says so). There is no "publish the draft as it is at that time" option.
- Menu screens listen to `menus.live` on the `menus:<tenantId>` room (migration 166).
- Allergen-only publishing (7 Nov 2026) always covers every menu (no "only this menu" choice), has no Pepper tool, and isn't scheduled (it goes live at once; a scheduled publish gets the new tags instead). A dish whose live copy is a different dish id (deleted and re-made in the draft) keeps its live tags: only the same dish id is matched.

**25. Combos — follow-ups** *(shipped with migration 171; `docs/POS.md` 8.2)*
- VAT on a combo is the combo's own Tax setting; a combo mixing standard and zero-rated items (hot food with a cold takeaway drink) isn't split per part.
- Automatic combos are found greedily (biggest saving first); with overlapping combos a different grouping can occasionally be cheaper.
- No combo inside a combo, and no step price that depends on another step's pick.
- The AI menu tools describe combos and warn when a change removes a choice, but don't edit steps (or a choice's options in the deal; `get_menu` only says they are changed).
- A deal's options change the picked dish's own option groups only: an option's nested group (Steak → Cooking) follows the library inside the deal too, and the deal can't add a group the dish doesn't have except by Another group. A swapped group's own min / max apply unless the deal sets How many.
- The Deliveroo file sends a combo as one item at its own price; its choices are Deliveroo modifiers set in the Hub. GloriaFood orders aren't matched to combos.
- Not tried on a real tablet (till steps, the guest wizard on a phone) or with a real bump bar on a combo ticket.

**40. Menu entry descriptions and the designers' own entries — follow-ups** *(shipped with migration 241)*
- The nine new entries use the permission modules of the pages they came out of (`pos_setup`, `screens`, `menus`, `website`): there is no access per designer, so a role that can set up kiosks can open the Kiosk designer. Hiding one from a role is done in the Navigation designer (it hides the link, not the page).
- Still inside other pages (offered to the user as a next step): the Website page's sections (Header & footer, Locations, Site, each location's details), the Emails tabs, the Loyalty tabs, the theme maker (a window in four designers), the allergen notice builder (a card on Allergens & dietary), dashboards' Edit layout, Cash Recon settings. Menu print designer sits under Menus with its sibling pages, so the sidebar shows it once Menus is opened (the search finds it either way).
- Descriptions are English only and one per entry (not per role or venue). The standard ones live in code (`NAV_DESCRIPTIONS`): a group's own description doesn't follow later changes to the standard words, and Reset to defaults clears them. They show in the menu search, as a link's or section's tooltip and in the Navigation designer; not on Launcher tiles, the Overview's shortcuts or the phone hub. Pepper reads them (menu search, `open_page`) but can't write them.
- The search matches the start of whole words plus simple plurals ("desig" and "designers" find designer, "signer" doesn't), with no spelling tolerance and no synonyms beyond each page's search words and description ("poster" finds nothing); "news" also finds New venue (new is its singular); a section's description is never searched through its links.
- Migration 241 put each link after its anchor page in a group's menu (or the fallback anchor); a group that had taken both out got no link (add it in the Navigation designer), and a group that already had the page kept its menu as it was.
- Old addresses redirect inside the app (bookmarks to `/pos/kiosks/designs/:id`, `/pos/printing/designs/:id`, `/menus/:id/design`, `/screens?tab=`, `/website?section=` still open). `/reservations-widget` only ever opened from a link inside the app (nginx sends a load of it to the API) and still does only that.
- Tried in Chromium with a mouse at 1280, 1015 and 390 px against a stand-in login; not on a real tablet or phone, and the Pepper side only against a stand-in Claude.

**48. Menus as catalogues: food, retail goods and services (plan, the user, 22 Nov 2026; parked the same day)**
- The ask: a flag for which menus (catalogues) or categories are food, retail goods or services, so non-food doesn't carry allergen information and a menu can be called a catalogue; research best practice first. Recommendation: `docs/CATALOGUE.md` (an `item_type` set on the menu, section or item and inherited like tax; what each type switches; SKU and barcode; words that follow the type). Nothing is built; decisions D1 to D4 there wait for the user.
