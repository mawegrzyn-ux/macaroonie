// src/components/RichTextEditor.jsx
//
// Lightweight TipTap editor used by the website CMS About section + anywhere
// else that needs rich HTML input. Image insertion goes through the media
// library picker so all uploads land in media_items.

import { useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit  from '@tiptap/starter-kit'
import Underline   from '@tiptap/extension-underline'
import Link        from '@tiptap/extension-link'
import Image       from '@tiptap/extension-image'
import TextAlign   from '@tiptap/extension-text-align'
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Heading1, Heading2, Quote, Link as LinkIcon, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight, Undo, Redo,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MediaLibraryModal } from '@/components/media/MediaLibrary'

function isSafeUrl(u) {
  if (!u) return false
  try {
    const parsed = new URL(u, window.location.origin)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' || parsed.protocol === 'tel:'
  } catch { return false }
}

export function RichTextEditor({ value, onChange, scope = 'shared', placeholder = '' }) {
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
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  })

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  if (!editor) return null

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5 bg-muted/30">
        <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><UnderlineIcon className="w-3.5 h-3.5" /></ToolBtn>
        <Sep />
        <ToolBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1"><Heading1 className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2"><Heading2 className="w-3.5 h-3.5" /></ToolBtn>
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
      </div>
      <EditorContent editor={editor} className="prose prose-sm max-w-none px-3 py-2 min-h-[200px] focus:outline-none [&>div]:outline-none [&>div]:min-h-[180px]" />
      {placeholder && !editor.getText() && (
        <p className="text-muted-foreground text-sm italic px-3 -mt-[180px] pointer-events-none select-none">{placeholder}</p>
      )}

      <MediaLibraryModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mode="picker"
        scope={scope}
        onPick={(url) => {
          if (isSafeUrl(url)) editor.chain().focus().setImage({ src: url }).run()
        }}
      />

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
