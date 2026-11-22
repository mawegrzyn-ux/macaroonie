// src/pages/Docs.jsx
// Technical system documentation — architecture, DB schema, API reference, data flows.
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

// Each section is a file in docs/ exporting { id, label, order, Section }; the
// contents list and the page are drawn from them, by order, then id. A new
// section is a new file there (orders are spaced by 10, so it can slot in
// between two without renumbering).
const SECTIONS = Object.entries(import.meta.glob('./docs/*.jsx', { eager: true }))
  .filter(([file]) => !file.endsWith('/parts.jsx'))
  .map(([, m]) => m)
  .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

export default function Docs() {
  const [activeId, setActiveId] = useState('overview')

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting)
        if (visible.length) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-10% 0px -75% 0px' },
    )
    document.querySelectorAll('section[data-doc]').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* TOC */}
      <aside className="w-52 shrink-0 border-r overflow-y-auto py-6 px-3 hidden md:block">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-3">
          Contents
        </p>
        <nav className="space-y-0.5">
          {SECTIONS.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn(
                'block px-2 py-1.5 rounded text-sm transition-colors',
                activeId === s.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-16">
          <div>
            <h1 className="text-2xl font-bold">System Documentation</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Technical reference for developers and system administrators.
            </p>
          </div>

          {SECTIONS.map(({ id, Section }) => <Section key={id} />)}

        </div>
      </main>
    </div>
  )
}
