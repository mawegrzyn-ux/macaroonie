import { useMemo } from 'react'
const it = (n, name) => ({ id: '00000000-0000-4000-8000-0000000001' + n, name, price_pence: 1290, description: 'Tasty dish', dietary: [], variant_groups: [], variants: [] })
const menu = { id: 'm1', name: 'Dinner Menu', tenant_name: 'One Thai', print_paper_size: 'A4', print_orientation: 'landscape', print_settings: {}, dietary_tags: [], callouts: [],
  sections: [{ id: '00000000-0000-4000-8000-000000000001', title: 'Mains', items: [it(10, 'Green curry'), it(11, 'Pad thai')] }],
  print_layout: { fold: 'vertical', fold_gap_mm: 12, pages: [{ id: 'p1', blocks: [] }] } }
window.__puts = []
export function useApi() {
  return useMemo(() => ({
    get: async p => p.endsWith('/design') ? structuredClone(menu) : [],
    put: async (p, body) => { window.__puts.push(body); return { id: 'm1', print_layout: JSON.parse(JSON.stringify(body.layout)) } },
    post: async () => ({}), patch: async () => ({}), delete: async () => ({}),
  }), [])
}
