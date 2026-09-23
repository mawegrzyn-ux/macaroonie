// src/components/RichTextEditor.jsx
//
// Lightweight TipTap editor used by the website CMS About section, the
// Menus intro line, and anywhere else that needs rich HTML input. Image
// insertion goes through the media library picker so all uploads land in
// media_items.
//
// `compact` trims the toolbar to just Style (heading choice) / Bold /
// Italic / Underline / Size (+ Font, when enabled) — for short
// single-line-ish fields (e.g. a menu's intro line) where lists,
// alignment, links and images don't make sense.
//
// `showFontFamily` is opt-in (default off) because a font choice is only
// useful if whatever renders this HTML on the public site actually loads
// that Google Font — font-size and headings are plain CSS/semantic HTML
// and always render fine, but an unloaded font silently falls back to
// the browser default. Pass it only from a call site whose render path
// has been wired to self-load the font(s) actually used (see the Menus
// intro_line + menu_inline.eta / siteDataSvc.js loadInlineMenus pairing).

import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit  from '@tiptap/starter-kit'
import Underline   from '@tiptap/extension-underline'
import Link        from '@tiptap/extension-link'
import Image       from '@tiptap/extension-image'
import TextAlign   from '@tiptap/extension-text-align'
import TextStyle   from '@tiptap/extension-text-style'
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Quote, Link as LinkIcon, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight, Undo, Redo,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'

// Same 22 fonts head.eta knows how to load on the public site (each with
// its own known-good weight set — Google Fonts v2 rejects the whole
// stylesheet if any one font is asked for a weight it doesn't have).
export const DEFAULT_FONTS = [
  'Inter', 'Fraunces', 'Caveat', 'Playfair Display', 'Poppins', 'Lora',
  'Montserrat', 'Roboto', 'Open Sans', 'Source Sans Pro', 'Raleway',
  'Merriweather', 'Work Sans', 'Karla', 'DM Sans', 'DM Serif Display',
  'Space Grotesk', 'Manrope', 'Cormorant Garamond', 'Libre Baskerville',
  'Nunito', 'Rubik',
]

const FONT_SIZES = [
  { label: 'Small',    value: '14px' },
  { label: 'Normal',   value: '' },
  { label: 'Large',    value: '20px' },
  { label: 'X-Large',  value: '24px' },
  { label: 'XX-Large', value: '32px' },
]

// Custom marks — TipTap ships no official font-size extension, and the
// official font-family one is a separate package we don't otherwise need.
// Both just add an attribute to the existing `textStyle` mark (the same
// mechanism @tiptap/extension-color uses), rendered as an inline style.
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] } },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: element => element.style.fontSize || null,
          renderHTML: attributes => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontSize: fontSize => ({ chain }) => chain().setMark('textStyle', { fontSize }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).run(),
    }
  },
})

const FontFamily = Extension.create({
  name: 'fontFamily',
  addOptions() { return { types: ['textStyle'] } },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontFamily: {
          default: null,
          parseHTML: element => (element.style.fontFamily || '').replace(/["']/g, '').split(',')[0].trim() || null,
          renderHTML: attributes => attributes.fontFamily ? { style: `font-family: "${attributes.fontFamily}"` } : {},
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontFamily: fontFamily => ({ chain }) => chain().setMark('textStyle', { fontFamily }).run(),
      unsetFontFamily: () => ({ chain }) => chain().setMark('textStyle', { fontFamily: null }).run(),
    }
  },
})

function isSafeUrl(u) {
  if (!u) return false
  try {
    const parsed = new URL(u, window.location.origin)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' || parsed.protocol === 'tel:'
  } catch { return false }
}

export function RichTextEditor({
  value, onChange, scope = 'shared', placeholder = '',
  compact = false, fonts = DEFAULT_FONTS, minHeight = 200, showFontFamily = false,
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [linkOpen,   setLinkOpen]   = useState(false)
  const [linkUrl,    setLinkUrl]    = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ HTMLAttributes: { style: 'max-width:100%; height:auto; border-radius:6px;' } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      FontSize,
      FontFamily,
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  })

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  if (!editor) return null

  const headingValue = editor.isActive('heading', { level: 1 }) ? 'h1'
    : editor.isActive('heading', { level: 2 }) ? 'h2'
    : editor.isActive('heading', { level: 3 }) ? 'h3'
    : 'p'
  const fontSizeValue   = editor.getAttributes('textStyle').fontSize   || ''
  const fontFamilyValue = editor.getAttributes('textStyle').fontFamily || ''

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5 bg-muted/30">
        <select
          value={headingValue}
          onChange={e => {
            const v = e.target.value
            if (v === 'p') editor.chain().focus().setParagraph().run()
            else editor.chain().focus().setHeading({ level: Number(v.slice(1)) }).run()
          }}
          title="Text style"
          className="text-xs border rounded px-1.5 h-7 bg-background">
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <Sep />
        <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><UnderlineIcon className="w-3.5 h-3.5" /></ToolBtn>
        <Sep />
        <select
          value={fontSizeValue}
          onChange={e => {
            const v = e.target.value
            if (!v) editor.chain().focus().unsetFontSize().run()
            else editor.chain().focus().setFontSize(v).run()
          }}
          title="Font size"
          className="text-xs border rounded px-1.5 h-7 bg-background">
          {FONT_SIZES.map(s => <option key={s.label} value={s.value}>{s.label}</option>)}
        </select>
        {showFontFamily && (
          <select
            value={fontFamilyValue}
            onChange={e => {
              const v = e.target.value
              if (!v) editor.chain().focus().unsetFontFamily().run()
              else editor.chain().focus().setFontFamily(v).run()
            }}
            title="Font"
            className="text-xs border rounded px-1.5 h-7 bg-background max-w-[140px]">
            <option value="">Default font</option>
            {fonts.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        )}

        {!compact && (
          <>
            <Sep />
            <ToolBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"><Quote className="w-3.5 h-3.5" /></ToolBtn>
            <Sep />
            <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"><List className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></ToolBtn>
            <Sep />
            <ToolBtn active={editor.isActive({ textAlign: 'left' })}   onClick={() => editor.chain().focus().setTextAlign('left').run()}   title="Align left"><AlignLeft className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align center"><AlignCenter className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn active={editor.isActive({ textAlign: 'right' })}  onClick={() => editor.chain().focus().setTextAlign('right').run()}  title="Align right"><AlignRight className="w-3.5 h-3.5" /></ToolBtn>
            <Sep />
            <ToolBtn active={editor.isActive('link')} onClick={() => {
              const prev = editor.getAttributes('link').href || ''
              setLinkUrl(prev)
              setLinkOpen(true)
            }} title="Link"><LinkIcon className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn onClick={() => setPickerOpen(true)} title="Image (from media library)"><ImageIcon className="w-3.5 h-3.5" /></ToolBtn>
            <Sep />
            <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo className="w-3.5 h-3.5" /></ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo className="w-3.5 h-3.5" /></ToolBtn>
          </>
        )}
      </div>
      <EditorContent editor={editor}
        style={{ '--rte-min-h': `${minHeight}px` }}
        className="prose prose-sm max-w-none px-3 py-2 focus:outline-none [&>div]:outline-none [&>div]:min-h-[var(--rte-min-h)]" />
      {placeholder && !editor.getText() && (
        <p className="text-muted-foreground text-sm italic px-3 pointer-events-none select-none"
          style={{ marginTop: `-${minHeight}px` }}>{placeholder}</p>
      )}

      {!compact && (
        <MediaLibraryModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          mode="picker"
          scope={scope}
          onPick={(url) => {
            if (isSafeUrl(url)) editor.chain().focus().setImage({ src: url }).run()
          }}
        />
      )}

      {linkOpen && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setLinkOpen(false)}>
          <div className="bg-background rounded-lg shadow-2xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium mb-2">Link URL</p>
            <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} autoFocus
              placeholder="https://example.com"
              onKeyDown={(e) => { if (e.key === 'Enter') applyLink() }}
              className="w-full text-sm border rounded-md px-2 py-1.5 mb-3" />
            <div className="flex justify-end gap-2 text-sm">
              <button onClick={() => { editor.chain().focus().unsetLink().run(); setLinkOpen(false) }}
                className="px-3 py-1 text-muted-foreground">Remove</button>
              <button onClick={() => setLinkOpen(false)} className="px-3 py-1">Cancel</button>
              <button onClick={applyLink} className="px-3 py-1 bg-primary text-primary-foreground rounded-md">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  function applyLink() {
    const u = linkUrl.trim()
    if (!u) { editor.chain().focus().unsetLink().run() }
    else if (isSafeUrl(u)) editor.chain().focus().extendMarkRange('link').setLink({ href: u }).run()
    setLinkOpen(false)
  }
}

function ToolBtn({ active, onClick, title, children }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={cn('p-1.5 rounded text-foreground/70 hover:text-foreground hover:bg-accent',
        active && 'bg-primary/15 text-foreground')}>
      {children}
    </button>
  )
}
function Sep() { return <span className="w-px self-stretch bg-border mx-0.5" /> }
