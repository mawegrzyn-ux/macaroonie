// src/components/website-builder/blockRegistry.js
//
// Single source of truth for all available block types in the website
// page builder. Each entry has:
//
//   key:           unique block-type identifier (matches Eta partial name)
//   label:         what's shown in the picker
//   description:   one-line tooltip in the picker
//   icon:          lucide-react component
//   category:      grouping in the block picker ('hero' | 'content' | 'data' | 'layout')
//   defaultData:   shape created when the user adds this block
//   editor:        React component rendered when the user expands the block
//                  to edit it. Receives { data, onChange, scope }.
//   pullsFromConfig: true if the block reads from website_config / related
//                  tables at render time rather than its own `data` payload.
//                  Such blocks have an editor that lets the user choose
//                  display options (label, layout, etc.) but not content.
//
// To add a new block type:
//   1. Add an entry to BLOCKS below
//   2. Add a matching Eta partial under views/site/templates/<key>.eta
//      that knows how to render the block with merged config + data
//   3. Add the partial dispatch line to block-renderer.eta

import {
  Image as ImageIcon, Type, Columns2, Sparkles, MapPin, Phone,
  Calendar, Clock, BookOpen, AlignLeft, Minus, FileText, AlertTriangle,
  Layout, Columns, PanelTop, PanelBottom, Megaphone, Quote, ChefHat, BookText,
  ShoppingBag,
} from 'lucide-react'

import { HeroEditor }          from './editors/HeroEditor'
import { TextEditor }          from './editors/TextEditor'
import { ImageBlockEditor }    from './editors/ImageBlockEditor'
import { TwoColumnEditor }     from './editors/TwoColumnEditor'
import { CtaStripEditor }      from './editors/CtaStripEditor'
import { DataBlockEditor }     from './editors/DataBlockEditor'
import { DividerEditor }       from './editors/DividerEditor'
import { FaqEditor }           from './editors/FaqEditor'
import { ColumnsEditor }       from './editors/ColumnsEditor'
import {
  HeaderBlockEditor, FooterBlockEditor, TickerBlockEditor,
  StoryWithStampEditor, DishListEditor, ReviewsBandEditor,
  OrderOptionsEditor,
} from './editors/SiteBlockEditors'

// Sectional blocks (everything except divider + columns) get a shared
// `container` field controlling whether the block is boxed (within the
// site's max-width) or full-bleed. New blocks should set this in their
// defaultData; rendering reads `data.container` and switches the wrapper.
export const CONTAINER_OPTIONS = [
  { value: 'boxed', label: 'Boxed',     hint: 'Stays within the site\u2019s container width.' },
  { value: 'wide',  label: 'Wide',      hint: 'A bit wider than boxed.' },
  { value: 'full',  label: 'Full bleed', hint: 'Edge-to-edge of the viewport.' },
]
export const DEFAULT_CONTAINER = 'boxed'

// Blocks that should NOT show the container width control in the inspector
// (because they're either intrinsically full-bleed, or just visual filler).
// Columns IS included in the toggle — its `container` controls the outer
// row's max-width before the columns split.
export const NO_CONTAINER_BLOCKS = new Set(['divider', 'header', 'footer', 'ticker'])

// Blocks that pin to the start (header) or end (footer) of the page when
// added — keeps the page-builder UX matching what the live site renders.
export const PIN_TO_TOP    = new Set(['header'])
export const PIN_TO_BOTTOM = new Set(['footer'])

export const BLOCKS = [
  // ── Site shell — header / footer ─────────────────────────
  {
    key:         'header',
    label:       'Header',
    description: 'Sticky site header — logo, nav links, booking CTA. Lives at the top of every page.',
    icon:        PanelTop,
    category:    'shell',
    defaultData: {
      brand_text: '',         // override site_name
      brand_subtitle: '',     // override tagline
      show_logo: true,
      sticky:    true,
      links: [
        { label: 'Locations', url: '/locations' },
        { label: 'Menu',      url: '/menu' },
      ],
      cta: { show: true, text: 'Book a Table', url: '/locations' },
    },
    editor: HeaderBlockEditor,
  },
  {
    key:         'footer',
    label:       'Footer',
    description: 'Site footer — brand block, custom columns, legal links, copyright.',
    icon:        PanelBottom,
    category:    'shell',
    defaultData: {
      show_brand_block: true,
      show_legal_links: true,
      show_powered_by:  true,
      columns:          [],
      copyright_text:   '',
    },
    editor: FooterBlockEditor,
  },

  // ── Themed content blocks ────────────────────────────────
  {
    key:         'ticker',
    label:       'Ticker',
    description: 'Scrolling strip of words — dish names, taglines, etc. Edit the items list, font and size.',
    icon:        Megaphone,
    category:    'content',
    defaultData: {
      items:       ['Pad Thai', 'Massaman', 'Tom Yum', 'Pad Krapow', 'Green Curry', 'Som Tam', 'Spare Ribs', 'Khao Soi'],
      bg_style:    'primary',    // primary | accent | dark
      font_family: 'Caveat',     // any Google font in FONT_OPTIONS
      font_size:   28,           // px
      speed:       'medium',     // slow | medium | fast
    },
    editor: TickerBlockEditor,
  },
  {
    key:         'story_with_stamp',
    label:       'Story with stamp',
    description: 'Two-column story section with optional dashed-pill "X years" stamp.',
    icon:        BookText,
    category:    'content',
    defaultData: {
      heading:      'Cooking for our neighbours.',
      body_html:    '<p>Tell your story — what makes your kitchen yours. Keep it short, keep it warm.</p>',
      stamp_show:   true,
      stamp_number: '10',
      stamp_label:  'years',
      image_url:    null,
      image_side:   'right',     // left | right | none
      container:    'boxed',
    },
    editor: StoryWithStampEditor,
  },
  {
    key:         'dish_list',
    label:       'Dish menu',
    description: 'Multi-column dish menu with name, native script, heat dots, price, and description.',
    icon:        ChefHat,
    category:    'content',
    defaultData: {
      heading:    'A Taste of the Menu',
      subheading: '',
      columns: [
        {
          title: 'The Classics',
          dishes: [
            { name: 'Pad Thai', thai: '', heat: '', price: '£11.50', desc: 'Wok-tossed rice noodles, tamarind, peanuts, lime.' },
          ],
        },
      ],
      container: 'boxed',
    },
    editor: DishListEditor,
  },
  {
    key:         'order_options',
    label:       'Order options',
    description: 'Takeaway / delivery card grid — eyebrow, heading with script accent, intro text, and 1-N cards (tag, optional badge, title, description, button).',
    icon:        ShoppingBag,
    category:    'content',
    defaultData: {
      eyebrow_text:  'Takeaway & Delivery',
      heading:       'Eating in tonight?',
      accent_text:   'We have got you.',
      body_text:     'Order direct for the best price, or use a delivery partner if that is easier.',
      bg_style:      'dark',          // dark | primary | surface | accent
      cards: [
        {
          tag:         'Direct Collection',
          badge:       '15% OFF',
          title:       'Order with us',
          description: 'Best prices, no middleman, ready when you walk in.',
          cta_text:    'Order now',
          cta_url:     '/',
        },
        {
          tag:         'Delivery',
          badge:       '',
          title:       'Deliveroo',
          description: 'To your door, usually within the hour.',
          cta_text:    'Open Deliveroo',
          cta_url:     'https://deliveroo.co.uk/',
        },
        {
          tag:         'Delivery',
          badge:       '',
          title:       'Just Eat',
          description: 'Same menu, different driver.',
          cta_text:    'Open Just Eat',
          cta_url:     'https://just-eat.co.uk/',
        },
      ],
      container: 'boxed',
    },
    editor: OrderOptionsEditor,
  },
  {
    key:         'reviews_band',
    label:       'Reviews band',
    description: 'A coloured strip with 1–4 customer testimonials and stars.',
    icon:        Quote,
    category:    'content',
    defaultData: {
      heading:  '',
      bg_style: 'primary',         // primary | accent | dark | surface
      items: [
        { stars: 5, text: 'A short, warm review goes here.', attr: 'Customer name, location' },
      ],
      container: 'boxed',
    },
    editor: ReviewsBandEditor,
  },

  {
    key:         'hero',
    label:       'Hero',
    description: 'Composable hero — eyebrow, centered logo with optional flourishes, rich heading (with inline script accents), subheading, multiple CTAs.',
    icon:        Sparkles,
    category:    'hero',
    defaultData: {
      // Background
      bg_style: 'image',          // image | gradient | transparent | surface
      image_url: null,
      overlay_opacity: 0.4,
      // Pre-header
      eyebrow_text: '',           // small uppercase line above the logo
      show_dotted_divider: false, // dotted-line + dot ornament under the eyebrow
      // Centered logo (optional)
      logo_url: null,
      logo_size: 'medium',        // small | medium | large
      // Decorative flourishes flanking the logo (URLs or null)
      flourish_left_url:  null,
      flourish_right_url: null,
      // Heading — html allows inline <em>script accent</em> styling
      heading: 'Welcome',
      heading_html: '',           // when set, takes precedence over heading
      subheading: '',
      // Call-to-actions — array of { text, link, style }
      ctas: [
        { text: 'Book a table', link: '#booking', style: 'primary' },
      ],
      // Layout
      height: 'medium',           // small | medium | large | full
      align: 'center',            // left | center
      container: 'boxed',         // boxed | wide | full
    },
    editor: HeroEditor,
  },
  {
    key:         'text',
    label:       'Rich text',
    description: 'A block of formatted text — headings, lists, links, inline images.',
    icon:        Type,
    category:    'content',
    defaultData: {
      html: '<p>Add your content here…</p>',
      max_width: 'normal',        // narrow | normal | wide
      align: 'left',              // left | center
      background: 'default',      // default | surface | accent
      container: 'boxed',
    },
    editor: TextEditor,
  },
  {
    key:         'image',
    label:       'Image',
    description: 'A single image with optional caption.',
    icon:        ImageIcon,
    category:    'content',
    defaultData: {
      url: null, alt: '', caption: '',
      max_width: 'normal',        // narrow | normal | wide | full
      align: 'center',            // left | center | right
      container: 'boxed',
    },
    editor: ImageBlockEditor,
  },
  {
    key:         'two_column',
    label:       'Two columns',
    description: 'Image + text side-by-side. Swap which side is which.',
    icon:        Columns2,
    category:    'layout',
    defaultData: {
      image_url: null, image_alt: '',
      heading: '', body_html: '<p>Tell your story.</p>',
      cta_text: '', cta_link: '',
      image_side: 'left',         // left | right
      gap: 'normal',              // tight | normal | wide
      background: 'default',
      container: 'boxed',
    },
    editor: TwoColumnEditor,
  },
  {
    key:         'cta_strip',
    label:       'CTA strip',
    description: 'Coloured band with a single button. Drives bookings or signups.',
    icon:        AlignLeft,
    category:    'content',
    defaultData: {
      heading: 'Hungry?', subheading: '',
      cta_text: 'Book a table', cta_link: '#booking',
      bg_style: 'primary',        // primary | accent | dark | light
      container: 'boxed',
    },
    editor: CtaStripEditor,
  },
  {
    key:         'gallery',
    label:       'Gallery',
    description: 'Pulls from your gallery images. Style + size controlled in the Gallery section.',
    icon:        Layout,
    category:    'data',
    defaultData: { heading: 'Gallery', container: 'boxed' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'opening_hours',
    label:       'Opening hours',
    description: 'Weekly schedule. Pulled from manual entries or venue schedule.',
    icon:        Clock,
    category:    'data',
    defaultData: { heading: 'Opening hours', container: 'boxed' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'find_us',
    label:       'Find us',
    description: 'Address + map. Pulled from your contact details.',
    icon:        MapPin,
    category:    'data',
    defaultData: { heading: 'Find us', container: 'boxed' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'contact',
    label:       'Contact',
    description: 'Phone, email, social links.',
    icon:        Phone,
    category:    'data',
    defaultData: { heading: 'Get in touch', container: 'boxed' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'booking_widget',
    label:       'Booking widget',
    description: 'Embeds the live reservation widget for the chosen venue.',
    icon:        Calendar,
    category:    'data',
    defaultData: { heading: 'Reserve a table', container: 'boxed' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'menu_pdfs',
    label:       'Menus',
    description: 'Lists your uploaded PDF menus with a download link.',
    icon:        BookOpen,
    category:    'data',
    defaultData: { heading: 'Our menu', container: 'boxed' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'allergens',
    label:       'Allergens',
    description: 'Allergen info, either as a PDF download or a structured table.',
    icon:        AlertTriangle,
    category:    'data',
    defaultData: { heading: 'Allergen information', container: 'boxed' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'faq',
    label:       'FAQ',
    description: 'Q & A list — for parking, dietary, accessibility, etc.',
    icon:        FileText,
    category:    'content',
    defaultData: {
      heading: 'Frequently asked',
      items:   [{ q: 'Do you take walk-ins?', a: 'Yes — subject to availability.' }],
      container: 'boxed',
    },
    editor: FaqEditor,
  },
  {
    key:         'divider',
    label:       'Divider',
    description: 'A visual break — line, space, or shape.',
    icon:        Minus,
    category:    'layout',
    defaultData: { style: 'line', size: 'medium', color: 'auto' },
    editor:      DividerEditor,
  },
  {
    key:         'columns',
    label:       'Columns',
    description: 'A row of 2–4 columns, each holding any other blocks.',
    icon:        Columns,
    category:    'layout',
    isContainer: true,
    defaultData: {
      columns: [
        { id: null, blocks: [] },
        { id: null, blocks: [] },
      ],
      gap:        'normal',  // tight | normal | wide
      align:      'top',     // top | center | bottom
      stackOn:    'mobile',  // mobile | tablet | never
      background: 'default', // default | surface | accent
      container:  'boxed',
    },
    editor: ColumnsEditor,
  },
]

export const BLOCK_BY_KEY = Object.fromEntries(BLOCKS.map(b => [b.key, b]))

export function newBlock(key) {
  const def = BLOCK_BY_KEY[key]
  if (!def) throw new Error(`Unknown block type: ${key}`)
  const data = structuredClone(def.defaultData)
  // Container blocks need their child columns to get fresh ids too.
  if (def.isContainer && Array.isArray(data.columns)) {
    data.columns = data.columns.map(c => ({ ...c, id: crypto.randomUUID() }))
  }
  return {
    id:   crypto.randomUUID(),
    type: key,
    data,
  }
}

export const BLOCK_CATEGORIES = [
  { key: 'shell',   label: 'Site shell (header / footer)' },
  { key: 'hero',    label: 'Hero' },
  { key: 'content', label: 'Content' },
  { key: 'layout',  label: 'Layout' },
  { key: 'data',    label: 'Live data' },
]

// ── Starting templates ──────────────────────────────────────
//
// Each preset is an array of block definitions (without ids — those
// are generated on apply). Keep these short — the user can always
// add more after loading.

// Page templates bundle:
//   - blocks:     starter set of page-builder blocks (home_blocks / page_blocks)
//   - style_pack: which CSS shell wraps the rendered page (== template_key on
//                 tenant_site / website_config). Drives header / footer / fonts
//                 / decorative chrome on the live site.
//
// Picking a template is one step that applies both — no separate "site
// template" picker. `style_pack: null` means "leave as-is" (used for empty
// scaffolds where the operator has likely already chosen a style).
export const PAGE_TEMPLATES = [
  {
    key:         'restaurant-classic',
    label:       'Restaurant — Classic',
    description: 'Warm, traditional layout. Hero, story, gallery, menu PDFs, opening hours, contact.',
    style_pack:  'classic',
    blocks: [
      { type: 'hero',          data: { heading: 'Welcome', subheading: 'Seasonal food, served all day.', cta_text: 'Book a table', cta_link: '#booking', height: 'large' } },
      { type: 'text',          data: { html: '<h2>Our story</h2><p>Tell your guests what makes you different. Keep it warm, keep it short.</p>', max_width: 'narrow' } },
      { type: 'gallery',       data: { heading: 'Gallery' } },
      { type: 'menu_pdfs',     data: { heading: 'Menus' } },
      { type: 'opening_hours', data: { heading: 'Opening hours' } },
      { type: 'contact',       data: { heading: 'Get in touch' } },
    ],
  },
  {
    key:         'modern-bistro',
    label:       'Modern Bistro',
    description: 'Editorial, full-bleed hero, transparent header. Two-column about, CTA strip, booking widget.',
    style_pack:  'modern',
    blocks: [
      { type: 'hero',           data: { heading: 'Tonight, well-fed.', subheading: 'Modern bistro in the heart of town.', cta_text: 'Reserve →', cta_link: '#booking', height: 'medium', align: 'left' } },
      { type: 'two_column',     data: { heading: 'A small kitchen, big ambitions.', body_html: '<p>Family-run since the 90s, serving honest food in a modern setting.</p>', cta_text: 'Read our story', cta_link: '/p/about', image_side: 'right' } },
      { type: 'cta_strip',      data: { heading: 'Bring the team.', subheading: 'Group bookings up to 30 — book online or call us.', cta_text: 'Make a reservation', cta_link: '#booking', bg_style: 'primary' } },
      { type: 'gallery',        data: { heading: 'In the kitchen' } },
      { type: 'booking_widget', data: { heading: 'Book a table' } },
      { type: 'find_us',        data: { heading: 'Find us' } },
    ],
  },
  {
    key:         'minimal-cafe',
    label:       'Minimal Café',
    description: 'Clean and quick. Classic shell, minimal blocks: hero, hours, single image, contact.',
    style_pack:  'classic',
    blocks: [
      { type: 'hero',          data: { heading: 'Coffee. Cake. Quiet.', subheading: '', cta_text: '', cta_link: '', height: 'small' } },
      { type: 'opening_hours', data: { heading: 'When we\'re open' } },
      { type: 'image',         data: { url: null, alt: '', caption: '', max_width: 'wide', align: 'center' } },
      { type: 'contact',       data: { heading: 'Drop us a line' } },
    ],
  },
  {
    // Thai-restaurant aesthetic — burgundy + cream, Fraunces serif, Caveat
    // script accents. Seeds the full block list the operator can edit:
    // header → hero → ticker → story → dish menu → reviews → find us →
    // contact → booking → footer. Picking this template also auto-applies
    // matching theme defaults (see Website.jsx TemplateSection).
    key:         'onethai',
    label:       'Onethai — Thai Restaurant',
    description: 'Full block layout in the burgundy/cream Fraunces+Caveat aesthetic — header, hero, scrolling ticker, story, dish menu, reviews, visit, contact, booking, footer. Edit each block to customise.',
    style_pack:  'onethai',
    template_key: 'onethai',
    theme_defaults: {
      colors: {
        primary:    '#630812',
        accent:     '#c9302c',
        background: '#faf6ef',
        surface:    '#f3ead8',
        text:       '#2a1c1a',
        muted:      '#7a6b62',
        border:     '#e5e7eb',
      },
      typography: {
        heading_font: 'Fraunces',
        body_font:    'Inter',
      },
    },
    blocks: [
      { type: 'header',           data: {
        brand_text: '', brand_subtitle: '', show_logo: true, sticky: true,
        links: [
          { label: 'Locations', url: '/locations' },
          { label: 'Menu',      url: '/menu' },
          { label: 'Visit',     url: '#find-us' },
        ],
        cta: { show: true, text: 'Book a Table', url: '#booking' },
      }},
      { type: 'hero',             data: {
        bg_style: 'transparent',
        eyebrow_text: '— Your Local Thai —',
        show_dotted_divider: true,
        logo_url: '/template-assets/onethai/logo.png',
        logo_size: 'large',
        flourish_left_url:  '/template-assets/onethai/icons/icon-chilli.png',
        flourish_right_url: '/template-assets/onethai/icons/icon-chilli.png',
        heading_html: 'A small Thai cafe<br />with <em>very loyal</em> regulars.',
        subheading: 'Tucked away in our neighbourhood, cooking the dishes we grew up on for years.',
        ctas: [
          { text: 'Book a table',  link: '#booking', style: 'primary' },
          { text: 'See the menu',  link: '#menu',    style: 'secondary' },
        ],
        height: 'large', align: 'center', container: 'boxed',
      }},
      { type: 'ticker',           data: {
        items: ['Pad Thai', 'Massaman', 'Tom Yum', 'Pad Krapow', 'Green Curry', 'Som Tam', 'Spare Ribs', 'Khao Soi'],
        bg_style: 'primary', font_family: 'Caveat', font_size: 28, speed: 'medium',
      }},
      { type: 'story_with_stamp', data: {
        heading: 'Cooking for our neighbours.',
        body_html: '<p>One Thai opened on a quiet stretch of West Street years ago, with a short menu, a few tables, and the kind of nervous optimism you only have when you\'re cooking your grandmother\'s recipes for strangers.</p><p>The menu has grown — a little classic, a little modern, always honest — but the room is still small, the kitchen is still ours.</p>',
        stamp_show: true, stamp_number: '10', stamp_label: 'years in the area',
        image_url: null, image_side: 'right', container: 'boxed',
      }},
      { type: 'dish_list',        data: {
        heading: 'A Taste of the Menu', subheading: 'Classics, and a few quiet experiments.',
        columns: [
          {
            title: 'The Classics',
            dishes: [
              { name: 'Pad Thai',         thai: 'ผัดไทย',     heat: '',    price: '£11.50', desc: 'Wok-tossed rice noodles, tamarind, peanuts, lime. The benchmark.' },
              { name: 'Massaman Beef',    thai: 'มัสมั่น',     heat: '●●○', price: '£13.80', desc: 'Slow-cooked beef, potato, peanuts, cinnamon, star anise.' },
              { name: 'Tom Yum Goong',    thai: 'ต้มยำกุ้ง',   heat: '●●●', price: '£8.50',  desc: 'King prawns, lemongrass, lime leaf, galangal.' },
              { name: 'Green Curry',      thai: 'แกงเขียวหวาน', heat: '●●○', price: '£12.50', desc: 'House-made curry paste, Thai basil, bamboo shoots.' },
            ],
          },
          {
            title: 'House Favourites',
            dishes: [
              { name: 'Spare Ribs',     thai: 'ซี่โครงอบ', heat: '',    price: '£9.80',  desc: 'Slow-marinated, twice-cooked.' },
              { name: 'Pad Krapow Moo', thai: 'ผัดกะเพรา', heat: '●●●', price: '£11.80', desc: 'Minced pork, holy basil, chilli, fried egg.' },
              { name: 'Khao Soi',       thai: 'ข้าวซอย',  heat: '●●○', price: '£13.20', desc: 'Northern egg noodles, coconut curry, pickled mustard.' },
              { name: 'Som Tam',        thai: 'ส้มตำ',    heat: '●●●', price: '£8.20',  desc: 'Green papaya salad, lime, palm sugar, peanuts.' },
            ],
          },
        ],
        container: 'boxed',
      }},
      { type: 'reviews_band',     data: {
        heading: '', bg_style: 'primary',
        items: [
          { stars: 5, text: 'Probably the best Thai food this side of Bangkok — and I drive past three other places to get here.', attr: 'Mark, regular since 2018' },
          { stars: 5, text: 'Tiny place, huge flavours. The spare ribs are dangerously good and the staff actually remember you.', attr: 'Sarah, Hertford' },
          { stars: 5, text: 'A proper neighbourhood gem. We have been coming here for years and it never disappoints.', attr: 'James & Priya' },
        ],
        container: 'boxed',
      }},
      { type: 'find_us',          data: { heading: 'Find us', container: 'boxed' } },
      { type: 'contact',          data: { heading: 'Get in touch', container: 'boxed' } },
      { type: 'order_options',    data: {
        eyebrow_text: 'Takeaway & Delivery',
        heading:      'Eating in tonight?',
        accent_text:  'We have got you.',
        body_text:    "Order direct for the best price, or use Deliveroo or Just Eat if that is easier. We don't mind.",
        bg_style:     'dark',
        cards: [
          { tag: 'Direct Collection', badge: '15% OFF', title: 'Order with us',  description: 'Best prices, no middleman, ready when you walk in.', cta_text: 'Order now',     cta_url: '/' },
          { tag: 'Delivery',          badge: '',         title: 'Deliveroo',     description: 'To your door, usually within the hour.',              cta_text: 'Open Deliveroo', cta_url: 'https://deliveroo.co.uk/' },
          { tag: 'Delivery',          badge: '',         title: 'Just Eat',      description: 'Same menu, different driver.',                         cta_text: 'Open Just Eat',  cta_url: 'https://just-eat.co.uk/' },
        ],
        container: 'boxed',
      }},
      { type: 'booking_widget',   data: { heading: 'Reserve your table', container: 'boxed' } },
      { type: 'footer',           data: {
        show_brand_block: true, show_legal_links: true, show_powered_by: true,
        columns: [], copyright_text: '',
      }},
    ],
  },
  {
    key:         'from-scratch',
    label:       'From scratch',
    description: 'Empty page. Pick blocks one by one. Keeps your current style.',
    style_pack:  null,
    blocks: [],
  },
]
