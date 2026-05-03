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
  Layout,
} from 'lucide-react'

import { HeroEditor }          from './editors/HeroEditor'
import { TextEditor }          from './editors/TextEditor'
import { ImageBlockEditor }    from './editors/ImageBlockEditor'
import { TwoColumnEditor }     from './editors/TwoColumnEditor'
import { CtaStripEditor }      from './editors/CtaStripEditor'
import { DataBlockEditor }     from './editors/DataBlockEditor'
import { DividerEditor }       from './editors/DividerEditor'
import { FaqEditor }           from './editors/FaqEditor'

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
    },
    editor: CtaStripEditor,
  },
  {
    key:         'gallery',
    label:       'Gallery',
    description: 'Pulls from your gallery images. Style + size controlled in the Gallery section.',
    icon:        Layout,
    category:    'data',
    defaultData: { heading: 'Gallery' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'opening_hours',
    label:       'Opening hours',
    description: 'Weekly schedule. Pulled from manual entries or venue schedule.',
    icon:        Clock,
    category:    'data',
    defaultData: { heading: 'Opening hours' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'find_us',
    label:       'Find us',
    description: 'Address + map. Pulled from your contact details.',
    icon:        MapPin,
    category:    'data',
    defaultData: { heading: 'Find us' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'contact',
    label:       'Contact',
    description: 'Phone, email, social links.',
    icon:        Phone,
    category:    'data',
    defaultData: { heading: 'Get in touch' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'booking_widget',
    label:       'Booking widget',
    description: 'Embeds the live reservation widget for the chosen venue.',
    icon:        Calendar,
    category:    'data',
    defaultData: { heading: 'Reserve a table' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'menu_pdfs',
    label:       'Menus',
    description: 'Lists your uploaded PDF menus with a download link.',
    icon:        BookOpen,
    category:    'data',
    defaultData: { heading: 'Our menu' },
    editor:      DataBlockEditor,
    pullsFromConfig: true,
  },
  {
    key:         'allergens',
    label:       'Allergens',
    description: 'Allergen info, either as a PDF download or a structured table.',
    icon:        AlertTriangle,
    category:    'data',
    defaultData: { heading: 'Allergen information' },
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
]

export const BLOCK_BY_KEY = Object.fromEntries(BLOCKS.map(b => [b.key, b]))

export function newBlock(key) {
  const def = BLOCK_BY_KEY[key]
  if (!def) throw new Error(`Unknown block type: ${key}`)
  return {
    id:   crypto.randomUUID(),
    type: key,
    data: structuredClone(def.defaultData),
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

export const PAGE_TEMPLATES = [
  {
    key:         'restaurant-classic',
    label:       'Restaurant — Classic',
    description: 'Hero, story, gallery, menu PDFs, opening hours, contact.',
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
    description: 'Hero, two-column about, CTA strip, gallery, booking widget.',
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
    description: 'Hero, opening hours, single image, contact. Clean and quick.',
    blocks: [
      { type: 'hero',          data: { heading: 'Coffee. Cake. Quiet.', subheading: '', cta_text: '', cta_link: '', height: 'small' } },
      { type: 'opening_hours', data: { heading: 'When we\'re open' } },
      { type: 'image',         data: { url: null, alt: '', caption: '', max_width: 'wide', align: 'center' } },
      { type: 'contact',       data: { heading: 'Drop us a line' } },
    ],
  },
  {
    key:         'from-scratch',
    label:       'From scratch',
    description: 'Empty page — pick blocks one by one.',
    blocks: [],
  },
]
