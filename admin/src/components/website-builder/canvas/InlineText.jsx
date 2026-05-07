// canvas/InlineText.jsx
//
// Plain-text inline editor for headings, subheadings, button labels.
// Renders as the underlying tag (h1/h2/p/span/...) so styles flow
// through naturally from the public-site CSS variables.
//
// Single-line by default. Pass `multiline` for fields like a hero
// subheading where wrapping is expected. Single-line mode strips
// pasted newlines and blocks Enter.

import { useEffect, useRef } from 'react'

export function InlineText({
  as: Tag = 'span',
  value,
  onChange,
  placeholder,
  multiline = false,
  className,
  style,
  onFocus,
  onBlur,
}) {
  const ref = useRef(null)

  // Sync external `value` into the DOM only when it actually differs from
  // what's already there — otherwise typing causes the caret to jump back
  // to the start because we'd be replacing the node's text on every keystroke.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (document.activeElement === el) return
    if (el.textContent !== (value || '')) el.textContent = value || ''
  }, [value])

  return (
    <Tag
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-pcf-placeholder={!value ? (placeholder || '') : null}
      className={className}
      style={style}
      onFocus={onFocus}
      onBlur={(e) => {
        onChange?.(e.currentTarget.textContent || '')
        onBlur?.()
      }}
      onInput={(e) => onChange?.(e.currentTarget.textContent || '')}
      onPaste={(e) => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        const cleaned = multiline ? text : text.replace(/\r?\n/g, ' ')
        document.execCommand('insertText', false, cleaned)
      }}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') e.preventDefault()
      }}
    />
  )
}
