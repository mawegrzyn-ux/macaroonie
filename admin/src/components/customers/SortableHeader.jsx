// Sortable table header
import { ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Sortable column header ────────────────────────────────────
export function SortableHeader({ col, label, align = 'left', sort, onSort }) {
  const active = sort.col === col
  const Icon   = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ArrowUpDown
  return (
    <th
      onClick={() => onSort(col)}
      className={cn(
        'px-4 py-2.5 font-medium text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none touch-manipulation whitespace-nowrap',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {label}
        <Icon className={cn('w-3 h-3 shrink-0', active ? 'text-primary' : 'opacity-30')} />
      </span>
    </th>
  )
}
