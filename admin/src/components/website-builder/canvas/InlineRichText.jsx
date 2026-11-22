// canvas/InlineRichText.jsx
//
// TipTap-powered rich text editor that renders inline in the canvas
// using public-site styles. A slim formatting toolbar floats above the
// editor when focused. The link button turns the toolbar into a link box
// (typed links go through typedLink() in shared/links.js: example.com gets
// https://, /menu, mailto: and tel: are kept); the toolbar stays while the
// box is open, though the editor has lost the focus to it.

import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline  from '@tiptap/extension-underline'
import LinkExt    from '@tiptap/extension-link'
import TextAlign  from '@tiptap/extension-text-align'
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Heading2, Heading3, Quote, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react'
import { typedLink } from '@shared/links.js'

export function InlineRichText({
  value, onChange, placeholder, className, style,
  allowHeadings = true,
  onFocus, onBlur,
}) {
  const [focused, setFocused] = useState(false)
  // The link being typed (null: none).
  const [link, setLink] = useState(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: allowHeadings ? { levels: [2, 3] } : false }),
      Underline,
      LinkExt.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    onFocus: () => { setFocused(true); onFocus?.() },
    onBlur:  () => { setFocused(false); onBlur?.() },
    editorProps: {
      attributes: { class: 'prose' },
    },
  })

  useEffect(() => {
    if (!editor) return
    if (value !== editor.getHTML()) editor.commands.setContent(value || '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  if (!editor) return null

  return (
    <div className={className} style={{ position: 'relative', ...(style || {}) }}>
      {link !== null
        ? <LinkBar editor={editor} value={link} setValue={setLink} onDone={() => setLink(null)} />
        : focused && <FormatBar editor={editor} allowHeadings={allowHeadings} onLink={() => setLink(editor.getAttributes('link').href || '')} />}
      <EditorContent editor={editor} />
      {placeholder && editor.isEmpty && !focused && (
        <p style={{
          position: 'absolute', top: 0, left: 0, margin: 0,
          color: 'var(--c-muted)', opacity: 0.6, pointerEvents: 'none',
        }}>{placeholder}</p>
      )}
    </div>
  )
}

const BAR = {
  position: 'absolute',
  top: -44, left: 0,
  display: 'flex', alignItems: 'center', gap: 2,
  background: '#1f2937', color: '#fff',
  padding: '4px 6px',
  borderRadius: 6,
  boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
  zIndex: 30,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 13,
}

/**
 * The link box in place of the toolbar: the address, then Add (or Change),
 * Remove when the words are a link already, and Cancel. Enter adds, Escape
 * cancels; an empty box takes the link off.
 */
function LinkBar({ editor, value, setValue, onDone }) {
  const [bad, setBad] = useState(false)
  const had = editor.isActive('link')
  const close = () => { onDone(); editor.commands.focus() }
  const apply = () => {
    if (!value.trim()) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onDone(); return }
    const href = typedLink(value)
    if (!href) { setBad(true); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    onDone()
  }
  const word = { padding: '0 10px', minHeight: 32, borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }
  return (
    <div style={{ ...BAR, top: bad ? -66 : -44, flexWrap: 'wrap', maxWidth: 'min(520px, 92vw)', gap: 4 }} data-testid="rt-link-bar">
      <input autoFocus value={value} placeholder="example.com, /menu or mailto:" aria-label="Link address"
        onChange={e => { setValue(e.target.value); setBad(false) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply() } else if (e.key === 'Escape') { e.preventDefault(); close() } }}
        style={{ flex: '1 1 200px', minWidth: 0, minHeight: 32, padding: '0 8px', borderRadius: 4, border: 'none', color: '#111827', fontSize: 13 }}
        data-testid="rt-link-input" />
      <button type="button" onClick={apply} style={{ ...word, background: '#2563eb', color: '#fff' }} data-testid="rt-link-apply">{had ? 'Change' : 'Add link'}</button>
      {had && <button type="button" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onDone() }} style={{ ...word, background: '#374151', color: '#fff' }}>Remove</button>}
      <button type="button" onClick={close} style={{ ...word, background: 'transparent', color: '#fff' }}>Cancel</button>
      {bad && <span style={{ flexBasis: '100%', color: '#fca5a5', fontSize: 12 }} data-testid="rt-link-bad">Type a web address (example.com), a page of the site (/menu), mailto: or tel:.</span>}
    </div>
  )
}

function FormatBar({ editor, allowHeadings, onLink }) {
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      style={BAR}
    >
      <Btn active={editor.isActive('bold')}      onClick={() => editor.chain().focus().toggleBold().run()}      title="Bold"><Bold size={14}/></Btn>
      <Btn active={editor.isActive('italic')}    onClick={() => editor.chain().focus().toggleItalic().run()}    title="Italic"><Italic size={14}/></Btn>
      <Btn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><UnderlineIcon size={14}/></Btn>
      <Sep />
      {allowHeadings && (
        <>
          <Btn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2"><Heading2 size={14}/></Btn>
          <Btn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3"><Heading3 size={14}/></Btn>
          <Sep />
        </>
      )}
      <Btn active={editor.isActive('bulletList')}  onClick={() => editor.chain().focus().toggleBulletList().run()}  title="Bullet list"><List size={14}/></Btn>
      <Btn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered size={14}/></Btn>
      <Btn active={editor.isActive('blockquote')}  onClick={() => editor.chain().focus().toggleBlockquote().run()}  title="Quote"><Quote size={14}/></Btn>
      <Sep />
      <Btn active={editor.isActive({ textAlign: 'left' })}   onClick={() => editor.chain().focus().setTextAlign('left').run()}   title="Align left"><AlignLeft size={14}/></Btn>
      <Btn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align center"><AlignCenter size={14}/></Btn>
      <Btn active={editor.isActive({ textAlign: 'right' })}  onClick={() => editor.chain().focus().setTextAlign('right').run()}  title="Align right"><AlignRight size={14}/></Btn>
      <Sep />
      <Btn active={editor.isActive('link')} onClick={onLink} title="Link"><LinkIcon size={14}/></Btn>
    </div>
  )
}

function Btn({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        padding: '5px 6px',
        background: active ? '#374151' : 'transparent',
        color: '#fff',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center',
      }}
    >{children}</button>
  )
}

function Sep() {
  return <span style={{ width: 1, alignSelf: 'stretch', background: '#374151', margin: '0 2px' }} />
}
