// canvas/InlineRichText.jsx
//
// TipTap-powered rich text editor that renders inline in the canvas
// using public-site styles. A slim formatting toolbar floats above the
// editor when focused.

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

function isSafeUrl(u) {
  if (!u) return false
  try {
    const parsed = new URL(u, window.location.origin)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)
  } catch { return false }
}

export function InlineRichText({
  value, onChange, placeholder, className, style,
  allowHeadings = true,
  onFocus, onBlur,
}) {
  const [focused, setFocused] = useState(false)

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
      {focused && <FormatBar editor={editor} allowHeadings={allowHeadings} />}
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

function FormatBar({ editor, allowHeadings }) {
  function setLink() {
    const prev = editor.getAttributes('link').href || ''
    const next = window.prompt('Link URL', prev)
    if (next === null) return
    if (!next) { editor.chain().focus().unsetLink().run(); return }
    if (isSafeUrl(next)) editor.chain().focus().extendMarkRange('link').setLink({ href: next }).run()
  }

  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      style={{
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
      }}
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
      <Btn active={editor.isActive('link')} onClick={setLink} title="Link"><LinkIcon size={14}/></Btn>
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
