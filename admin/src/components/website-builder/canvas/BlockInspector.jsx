// canvas/BlockInspector.jsx
//
// Right-side panel that shows per-block options when a block is selected.
// Reuses the existing per-type editors from `../editors/` so we don't
// duplicate form code. Content fields (heading, body) appear both here
// AND inline on the canvas — they share state via onChange.
//
// Closes on ESC or by clicking the X.

import { useEffect } from 'react'
import { X } from 'lucide-react'
import {
  BLOCK_BY_KEY, CONTAINER_OPTIONS, NO_CONTAINER_BLOCKS, DEFAULT_CONTAINER,
} from '../blockRegistry'
import { FormRow } from '../shared'

export function BlockInspector({ block, onChange, onClose }) {
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

  function setContainer(v) {
    onChange({ ...block, data: { ...block.data, container: v } })
  }

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
            <FormRow label="Container width" hint="Boxed stays within the site\u2019s container; full bleed is edge-to-edge.">
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
          </section>
        )}

        {Editor ? (
          <section>
            {showContainer && (
              <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-2">Block</p>
            )}
            <Editor
              data={block.data}
              onChange={(data) => onChange({ ...block, data })}
              blockType={block.type}
            />
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">No options for this block.</p>
        )}
      </div>
    </aside>
  )
}
