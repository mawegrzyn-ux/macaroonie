// shared/nav/sections.js: the standard menu's sections, in their order, with
// their standard descriptions (NAV_SECTION_DESCRIPTIONS). A page names its
// section by label in its area's file (shared/nav/<area>.js). A section
// renamed in the Navigation designer has no standard description (the group
// can write one).

export const SECTIONS = [
  { label: 'Home', order: 10, description: "Start here: today's jobs, local information, the overview and your dashboards." },
  { label: 'Service', order: 20, description: 'Day-to-day service: bookings, customers, loyalty and online orders.' },
  { label: 'Money', order: 30, description: 'Sales reports and the daily cash-up.' },
  { label: 'Health & safety', order: 40, description: 'Food safety records, checklists and the action log.' },
  { label: 'Stock', order: 50, description: 'Ordering from suppliers, and what you buy.' },
  { label: 'People', order: 60, description: 'Staff, the rota, pay and tips.' },
  { label: 'Menus', order: 70, description: 'Menus, dishes, allergens, tax and promotions.' },
  { label: 'Brand & web', order: 80, description: 'Your brand, the website, media, reviews and emails.' },
  { label: 'Venues', order: 90, description: 'Your locations and how each one takes bookings and orders.' },
  // Migration 202 holds this section as JSON (the nav test checks they match).
  { label: 'Store tech', order: 100, description: 'Tills, kiosks, kitchen screens, menu screens, printers and their designers.' },
  { label: 'Admin', order: 110, description: 'Logins, access, settings and this menu.' },
  { label: 'Help', order: 120, description: 'Guides, what is new and support.' },
]
