// src/mobile/registry.js
//
// Single source of truth for what shows up on the /mobile hub. Add an
// entry here + a route in main.jsx to ship a new mobile-optimised module —
// same "one registry drives nav + a picker" pattern as modules.js /
// defaultNav.js elsewhere in this app.

import { LayoutGrid, LayoutTemplate, Receipt, ShoppingCart, Wallet, Users, ShoppingBag, Wheat, Sparkles } from 'lucide-react'

export const MOBILE_MODULES = [
  {
    key: 'hs-dashboard',
    label: 'H&S Dashboard',
    description: 'Checklists, temperature checks, deliveries, holds and the action log',
    icon: LayoutGrid,
    path: '/mobile/hs-dashboard',
  },
  {
    key: 'dashboards',
    label: 'Dashboards',
    description: 'Your own dashboards: any mix of checks, cash, rota and allergens',
    icon: LayoutTemplate,
    path: '/mobile/dashboards',
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
  },
  {
    key: 'cash-up',
    label: 'Cash Up',
    description: 'This week\'s days at a glance - status, income and variance',
    icon: Wallet,
    path: '/mobile/cash-up',
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
    label: 'AI assistant',
    description: 'Bookings, H&S checks, supplier orders and menus by chat',
    icon: Sparkles,
    path: '/mobile/assistant',
  },
]
