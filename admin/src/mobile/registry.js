// src/mobile/registry.js
//
// Single source of truth for what shows up on the /mobile hub. Add an
// entry here + a route with shell 'mobile' in its area's admin/src/routes/<area>.jsx
// to ship a new mobile-optimised module — same "one registry drives nav + a
// picker" pattern as modules.js elsewhere in this app. `areas` are the Today feed's task
// areas (api/src/services/opsToday.js) a tile's badge counts; Today counts
// every task. `module` hides the tile from someone whose role has none of it.
// `hub: false` keeps the page (its route, the header's title, links to it)
// with no tile: Wages (reached from Today's wages task), Pepper (the ask bar
// at the bottom of the hub), Notices and This device (the header's menu).
// `Badge`, a component, draws a tile's own count (today's bookings) when
// the Today feed gives it none.

import { ListTodo, LayoutGrid, Receipt, ShoppingCart, Wallet, Users, ShoppingBag, Wheat, Sparkles, BarChart3, Bell, Tablet, CalendarRange, GanttChart, ClipboardList, Boxes, Trash2 } from 'lucide-react'
import { ASSISTANT_NAME } from '@shared/assistant.js'
import { TodayBookingsBadge } from '@/components/bookings/PhoneBadge'

export const MOBILE_MODULES = [
  {
    key: 'today',
    label: 'Today',
    description: 'What needs doing now: checks, deliveries, orders, the cash-up',
    icon: ListTodo,
    path: '/mobile/today',
    areas: 'all',
  },
  {
    key: 'hs-dashboard',
    label: 'H&S Dashboard',
    description: 'Checklists, temperature checks, deliveries, holds and the action log',
    icon: LayoutGrid,
    path: '/mobile/hs-dashboard',
    areas: ['food_safety', 'checklists', 'hs_actions'],
  },
  {
    key: 'expenses',
    label: 'Expenses',
    description: 'The week\'s petty cash expenses; add one and snap the receipt',
    icon: Receipt,
    path: '/mobile/expenses',
  },
  {
    key: 'purchasing',
    label: 'Purchasing',
    description: 'Order from your lists, send orders and book deliveries in',
    icon: ShoppingCart,
    path: '/mobile/purchasing',
    areas: ['purchasing'],
  },
  {
    key: 'stock-count',
    label: 'Stock count',
    description: 'Count stock area by area in the walk-in, with the scanner; submit it for approval',
    icon: Boxes,
    path: '/mobile/stock-count',
    areas: ['stock'],
    module: 'stock',
  },
  {
    key: 'stock-waste',
    label: 'Waste',
    description: 'Log what was thrown away and why, with a photo; undo it the same day',
    icon: Trash2,
    path: '/mobile/stock-waste',
    module: 'stock',
  },
  {
    key: 'cash-up',
    label: 'Cash Up',
    description: 'This week\'s days at a glance - status, income and variance',
    icon: Wallet,
    path: '/mobile/cash-up',
    areas: ['cash'],
  },
  {
    key: 'rota',
    label: 'Rota',
    description: 'Who\'s on this week, by day or by person, and your own shifts',
    icon: CalendarRange,
    path: '/mobile/rota',
    module: 'rota',
  },
  {
    key: 'timeline',
    label: 'Timeline',
    description: 'The day\'s bookings table by table; tap one to mark it arrived or seated',
    icon: GanttChart,
    path: '/mobile/timeline',
    module: 'bookings',
  },
  {
    key: 'guest-list',
    label: 'Guest list',
    description: 'Today\'s guests by time: search, notes and allergies, arrived and seated',
    icon: ClipboardList,
    path: '/mobile/guest-list',
    module: 'bookings',
    Badge: TodayBookingsBadge,
  },
  {
    key: 'wages',
    label: 'Wages',
    description: 'Staff wages for the week - what\'s owed and what\'s been paid',
    icon: Users,
    path: '/mobile/wages',
    areas: ['wages'],
    hub: false,
  },
  {
    key: 'orders',
    label: 'Online orders',
    description: 'Today\'s web orders: accept, mark ready, collected; pause and sold out',
    icon: ShoppingBag,
    path: '/mobile/orders',
    areas: ['online_orders'],
  },
  {
    key: 'allergens',
    label: 'Allergens',
    description: 'Look up a dish\'s allergens, or find dishes free from one',
    icon: Wheat,
    path: '/mobile/allergens',
    module: 'allergens',
  },
  {
    key: 'reports',
    label: 'Reports',
    description: 'Your reports and the starters: sales, bookings, labour and more',
    icon: BarChart3,
    path: '/mobile/reports',
  },
  {
    key: 'assistant',
    label: ASSISTANT_NAME,
    description: 'Ask about bookings, the rota, cash up, orders, H&S, menus and more',
    icon: Sparkles,
    path: '/mobile/assistant',
    hub: false,
  },
  {
    key: 'notices',
    label: 'Notices',
    description: 'A notice when a task is due soon or late: turn it on for this phone',
    icon: Bell,
    path: '/mobile/notices',
    hub: false,
  },
  {
    key: 'device',
    label: 'This device',
    description: 'Your office PIN, and sharing this phone or tablet between staff',
    icon: Tablet,
    path: '/mobile/device',
    hub: false,
  },
]
