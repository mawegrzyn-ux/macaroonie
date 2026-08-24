// canvas/BlockInspector.jsx

import { useEffect } from 'react'
import { X } from 'lucide-react'
import {
  BLOCK_BY_KEY, CONTAINER_OPTIONS, NO_CONTAINER_BLOCKS, DEFAULT_CONTAINER,
  sanitizeAnchorId, ANCHOR_FALLBACK,
} from '../blockRegistry'
import { BOXED_STEPS } from '../boxedLayout'
import { FormRow } from '../shared'

export function BlockInspector({ block, onChange, onClose, onJumpTo }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!block) return null
  const def = BLOCK_BY_KEY[block.type]
  const Editor = def?.editor
  const Icon = def?.icon
  const showContainer = !NO_CONTAINER_BLOCKS.has(block.type)
  const containerValue = block.data?.container || DEFAULT_CONTAINER
  const boxedStep = block.data?.boxed_step || ''

  function setContainer(v) {
    onChange({ ...block, data: { ...block.data, container: v } })
  }

  function setBoxedStep(v) {
    onChange({ ...block, data: { ...block.data, boxed_step: v } })
  }

  function setAnchor(raw) {
    onChange({ ...block, data: { ...block.data, anchor_id: sanitizeAnchorId(raw) } })
  }

  const fallbackAnchor = ANCHOR_FALLBACK[block.type] || ''
  const showInset = showContainer && containerValue !== 'full'

  return (
    <aside className="border-l bg-background flex flex-col w-[340px] shrink-0 max-h-[calc(100vh-180px)] sticky top-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        {Icon && <Icon className="w-4 h-4 text-primary" />}
        <p className="text-sm font-semibold flex-1 truncate">{def?.label || block.type}</p>
        <button type="button" onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {showContainer && (
          <section>
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">Layout</p>
            <FormRow label="Container width" hint="Boxed stays within the site container; full bleed is edge-to-edge.">
              <div className="grid grid-cols-3 gap-1.5">
                {CONTAINER_OPTIONS.map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => setContainer(opt.value)}
                    title={opt.hint}
                    className={`text-sm border rounded-md py-2 min-h-[36px]
                      ${containerValue === opt.value
                        ? 'bg-primary/10 border-primary text-primary font-medium'
                        : 'hover:bg-accent'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </FormRow>
            {showInset && (
              <FormRow label="Boxed inset" hint="Blank uses the theme default (Brand & theme).">
                <div className="grid grid-cols-6 gap-1">
                  <button type="button" onClick={() => setBoxedStep('')}
                    className={`text-xs border rounded-md py-2 min-h-[36px] ${
                      !boxedStep ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent'}`}>
                    Theme
                  </button>
                  {BOXED_STEPS.map(s => (
                    <button key={s.value} type="button" title={s.hint}
                      onClick={() => setBoxedStep(s.value)}
                      className={`text-xs border rounded-md py-2 min-h-[36px] ${
                        Number(boxedStep) === s.value ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </FormRow>
            )}
          </section>
        )}

        <section>
          {!showContainer && (
            <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">Layout</p>
          )}
          <FormRow label="Anchor ID"
            hint={fallbackAnchor
              ? `Link here with #${fallbackAnchor} (default) or a custom id. Header buttons use this.`
              : 'Link to this block with e.g. #menu. Used by header nav, hero buttons, and in-page links.'}>
            <input
              value={block.data?.anchor_id || ''}
              onChange={e => setAnchor(e.target.value)}
              placeholder={fallbackAnchor || 'e.g. menu'}
              className="w-full text-sm border rounded-md px-2 py-1.5 font-mono min-h-[36px]"
            />
          </FormRow>
        </section>

        {Editor ? (
          <section>
            {showContainer && (
              <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">Block</p>
            )}
            <Editor
              data={block.data}
              onChange={(data) => onChange({ ...block, data })}
              blockType={block.type}
              onJumpTo={onJumpTo}
            />
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">No options for this block.</p>
        )}
      </div>
    </aside>
  )
}
