# One Thai Cafe — Website

A clean, minimalist website for One Thai Cafe in Ware, Hertfordshire. Two pages, no build step, no dependencies beyond Google Fonts.

## Files

```
onethai-site/
├── index.html              # Home page
├── menu.html               # Full menu page (Lunch + Dinner tabs)
├── print-dinner.html       # Printable A4 landscape — dinner menu
├── print-lunch.html        # Printable A4 landscape — lunch menu
├── README.md               # You are here
└── assets/
    ├── logo.png            # 400×400 transparent PNG (used in site)
    ├── logo-large.png      # 600×600 transparent PNG (higher-res version)
    ├── divider-vine.png    # decorative horizontal vine for between sections
    ├── herbs-cluster.png   # large cluster of herb illustrations (decorative)
    └── icons/              # 20 individual herb/spice illustrations
        ├── icon-thai-basil.png
        ├── icon-chilli.png
        ├── icon-coriander.png
        ├── icon-star-anise.png
        ├── icon-lemongrass-bunch.png
        ├── icon-kaffir-leaf.png
        ├── icon-sakura-bloom.png
        ├── icon-frangipani.png
        ├── icon-ginger.png
        ├── icon-garlic.png
        ├── icon-coconut.png
        ├── icon-lemon.png
        ├── icon-lime-wedge.png
        ├── icon-spoon.png
        ├── icon-chopsticks.png
        ├── icon-basil-cluster.png
        ├── icon-sakura-branch.png
        ├── icon-lemongrass-cross.png
        ├── icon-chilli-small.png
        └── icon-swirl-ornament.png
```

All images are transparent PNGs in the brand burgundy `#630812`.

## Brand

- **Primary colour:** `#630812` (deep burgundy)
- **Accents:** `#c9302c` (chilli red), `#6b8e4e` (herb green)
- **Background:** `#faf6ef` (warm paper cream), `#f3ead8` (warmer cream for menu section)
- **Fonts (via Google Fonts):**
  - Display: **Fraunces** (serif, for headlines)
  - Script: **Caveat** (handwritten accents)
  - Body: **Inter** (sans-serif)

## Sections

### Home (index.html)
1. **Nav** — sticky top bar with logo + tagline
2. **Hero** — logo, headline, sub-copy, CTAs, and three "pills"
3. **Ticker** — scrolling burgundy strip of dish names
4. **Story** — "Our Story" + 10-year stamp
5. **Menu** — sample dishes split into "Classics" and "House Favourites"
6. **Reviews** — three customer testimonials on burgundy background
7. **Visit** — address, phone, email, hours, closure notice
8. **Order** — three takeaway/delivery cards on dark background
9. **Footer** — logo, links, decorative icon strip

### Menu (menu.html)
- **Tab switcher** at top to toggle between Lunch and Dinner menus on a single page
- Sticky jump-nav adapts per menu (different sections each)
- Allergen / dietary key (shared)
- **Dinner menu** (default view, served 6pm – 10pm): Starters, Soups, Stir-Fries, Thai Specials, Noodles, Curries, Rice, Sides, Drinks
- **Lunch menu** (served 11:30am – 2pm): Curry & Rice, Stir-Fry & Rice, Stir-Fried Rice, Stir-Fried Noodles
- House favourites highlighted with cream background
- "Go large" / "Make it Thai Hot" callouts
- Allergen notice
- CTA strip linking to booking + order pages
- Direct links: `menu.html#lunch` opens lunch menu, `menu.html#dinner` opens dinner
- Each pane links to its print-friendly version

### Print menus (print-dinner.html, print-lunch.html)
- Designed for **A4 landscape** PDF export
- Dinner: 4-column dense layout fitting all sections on one page
- Lunch: 3-column more spacious layout
- Banner at top with "Save as PDF / Print" button (hidden on actual print)
- Cream paper background, decorative vine divider, full brand styling
- Use any browser's Print dialog → "Save as PDF" → Landscape orientation
- Tested in Chrome, Firefox, and Safari

## How to run

Just open `index.html` in any browser. No server needed.

For local dev with auto-reload, you can use any static server:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .
```

## Things to update before going live

- Replace placeholder reviews on home page with real ones (or pull from Google Reviews)
- **Verify all menu prices** — transcribed from the marked-up paper menu, please double-check before publishing
- Update the closure notice (`<div class="notice">` in the Visit section) when the lunch closure ends
- Add real meta description, Open Graph tags, and favicon
- Wire up the "Book a Table" links to your guestplan.io URL (already pre-filled but verify)
- Wire up Order links to the real Foodbooking / Deliveroo / Just Eat URLs
- Consider adding a separate Lunch menu page (currently the main menu covers dinner)

## Notes for editing

- The site is a single self-contained HTML file with embedded CSS — no build tooling
- Decorative icons are referenced as `<img>` tags from `assets/icons/` — easy to swap or remove
- The logo appears in the nav, hero, and footer — all reference `assets/logo.png`
- Responsive breakpoints are at 600px, 768px, and 900px

## Credits

Logo and herb illustrations: provided by the cafe (originally generated via Grok and processed for transparency).
