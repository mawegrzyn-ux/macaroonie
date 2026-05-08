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
  Layout, Columns,
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
export const NO_CONTAINER_BLOCKS = new Set(['divider'])

export const BLOCKS = [
  {
    key:         'hero',
    label:       'Hero',
    description: 'Big banner with image, heading, and call-to-action.',
    icon:        Sparkles,
    category:    'hero',
    defaultData: {
      image_url: null, heading: 'Welcome', subheading: '',
      cta_text: 'Book a table', cta_link: '#booking',
      height: 'medium',           // small | medium | large | full
      overlay_opacity: 0.4,
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
    // script accents, decorative herb/spice icons, scrolling-dish ticker, vine
    // dividers. Picking this template applies both the Onethai CSS shell AND
    // a starter block layout.
    key:         'onethai',
    label:       'Onethai — Thai Restaurant',
    description: 'Burgundy + cream Thai aesthetic with Fraunces + Caveat fonts, herb-icon decoration, scrolling ticker. Hero, story, gallery, menus, hours, contact, booking.',
    style_pack:  'onethai',
    blocks: [
      { type: 'hero',          data: { heading: 'A small Thai cafe with very loyal regulars.', subheading: 'Tucked away in our neighbourhood, cooking the dishes we grew up on for years.', cta_text: 'Book a table', cta_link: '#booking', height: 'large', align: 'center' } },
      { type: 'two_column',    data: { heading: 'Cooking for our neighbours.', body_html: '<p>One Thai opened on a quiet stretch of West Street years ago, with a short menu, a few tables, and the kind of nervous optimism you only have when you\'re cooking your grandmother\'s recipes for strangers.</p><p>The menu has grown — a little classic, a little modern, always honest — but the room is still small, the kitchen is still ours.</p>', cta_text: 'See the menu', cta_link: '#menu', image_side: 'right' } },
      { type: 'gallery',       data: { heading: 'In the kitchen' } },
      { type: 'menu_pdfs',     data: { heading: 'Our menus' } },
      { type: 'opening_hours', data: { heading: 'Opening hours' } },
      { type: 'find_us',       data: { heading: 'Find us' } },
      { type: 'contact',       data: { heading: 'Get in touch' } },
      { type: 'booking_widget', data: { heading: 'Reserve your table' } },
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
