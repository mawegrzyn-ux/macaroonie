// src/components/ai/ReviewSlot.jsx
//
// Home's For review slot (Pepper-first step 5c): how many things wait for
// the person (GET /api/ai/review?count=1: their own unanswered cards,
// supplier orders to approve, invoices to book in), with a link to /review
// (pages/Review.jsx, loaded on demand). Its own small file so Home doesn't
// pull the page into the main bundle.

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Home's For review slot: how many things wait, with a link (GET /api/ai/review?count=1). */
export default function ReviewSlot() {
  const api = useApi()
  const q = useQuery({ queryKey: ['ai-review-count'], queryFn: () => api.get('/ai/review?count=1'), refetchInterval: 120_000, staleTime: 30_000 })
  const n = q.data?.count
  if (n == null) return null
  return (
    <Link to="/review" data-testid="home-review"
      className="flex items-center gap-3 rounded-lg border bg-background px-4 min-h-[56px] touch-manipulation hover:bg-accent">
      <Inbox className="w-5 h-5 text-primary shrink-0" />
      <span className="flex-1 text-sm font-medium">For review</span>
      <span className={cn('text-sm rounded-full px-2.5 py-0.5', n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')} data-testid="home-review-count">
        {n ? n + ' waiting' : 'Nothing waiting'}
      </span>
    </Link>
  )
}
