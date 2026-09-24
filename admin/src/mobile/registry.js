// src/mobile/registry.js
//
// Single source of truth for what shows up on the /mobile hub. Add an
// entry here + a route in main.jsx to ship a new mobile-optimised module —
// same "one registry drives nav + a picker" pattern as modules.js /
// defaultNav.js elsewhere in this app.

import { LayoutGrid, Receipt } from 'lucide-react'

export const MOBILE_MODULES = [
  {
    key: 'hs-dashboard',
    label: 'H&S Dashboard',
    description: 'Checklists, temperature checks, deliveries, holds and the action log',
    icon: LayoutGrid,
    path: '/mobile/hs-dashboard',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    description: 'Log a petty cash expense and snap a photo of the receipt',
    icon: Receipt,
    path: '/mobile/expenses',
  },
]
