// src/mobile/registry.js
//
// Single source of truth for what shows up on the /mobile hub. Add an
// entry here + a route in main.jsx to ship a new mobile-optimised module —
// same "one registry drives nav + a picker" pattern as modules.js /
// defaultNav.js elsewhere in this app. `areas` are the Today feed's task
// areas (api/src/services/opsToday.js) a tile's badge counts; Today counts
// every task.

import { ListTodo, LayoutGrid, Receipt, ShoppingCart, Wallet, Users, ShoppingBag, Wheat, Sparkles } from 'lucide-react'
import { ASSISTANT_NAME } from '@shared/assistant.js'

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
    key: 'cash-up',
    label: 'Cash Up',
    description: 'This week\'s days at a glance - status, income and variance',
    icon: Wallet,
    path: '/mobile/cash-up',
    areas: ['cash'],
  },
  {
    key: 'wages',
    label: 'Wages',
    description: 'Staff wages for the week - what\'s owed and what\'s been paid',
    icon: Users,
    path: '/mobile/wages',
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
  },
  {
    key: 'assistant',
    label: ASSISTANT_NAME,
    description: 'Ask about bookings, the rota, cash up, orders, H&S, menus and more',
    icon: Sparkles,
    path: '/mobile/assistant',
  },
]
