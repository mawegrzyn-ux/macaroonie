// src/components/recipes/DishList.jsx
//
// The Recipes page's Dishes tab (inventory phase 2): every dish on the
// group's menus (as they are being edited) with the recipe it uses by
// default, how many venues, streams or order types use another, and whether
// that recipe can be costed. Filter by menu or show only dishes with no
// recipe. A dish with no recipe is matched to recipes by product code, then
// name (matchThing() in shared/itemMatch.js, on the server), and goods whose
// barcode is a stock item's are offered a one-line recipe of it: both come
// as a list to review (untick what is wrong) and then Save. Links whose dish
// is on no menu any more are listed at the end; the nightly sweep deletes
// them after 30 days. Tapping a dish opens its matrix. API: routes/recipeLinks.js.

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search, Link2, Package, Check, Plus } from 'lucide-react'
import { useApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { inputCls, ErrorNote, ConfirmDelete, Modal, Segmented } from '@/components/staff/shared'
import { Card, btn } from '@/components/purchasing/shared'
import { CoverageBadge, penceText } from './shared'

const COVER_WORDS = { unlinked: 'No recipe', deal: 'Meal deal', not_needed: 'Service', some: 'Some places only' }
const KIND_WORDS = { deal: 'Meal deal', goods: 'Goods', service: 'Service' }

function DishCoverage({ coverage }) {
  if (['full', 'partial', 'none'].includes(coverage)) return <CoverageBadge coverage={coverage} />
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
      coverage === 'unlinked' ? 'bg-amber-50 text-amber-900 border-amber-200' : 'bg-muted text-muted-foreground border-border')} data-coverage={coverage}>
      {COVER_WORDS[coverage] || coverage}
    </span>
  )
}

export function DishList({ onOpen, onMake, canManage, startQ = '' }) {
  const api = useApi()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['recipe-dishes'], queryFn: () => api.get('/recipe-links/dishes') })
  const [menuId, setMenuId] = useState('')
  const [only, setOnly] = useState('all')
  // ?q= starts the search (Pepper's link to a dish, by its name).
  const [q, setQ] = useState(startQ)
  const [review, setReview] = useState(null)
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const rows = useMemo(() => (data?.dishes || [])
    .filter(d => !menuId || d.menu_id === menuId)
    .filter(d => only === 'all' || d.coverage === 'unlinked')
    .filter(d => words.every(w => [d.name, d.section, d.menu, d.sku, d.default?.recipe_name].some(x => (x || '').toLowerCase().includes(w)))),
  [data, menuId, only, q])
  const forget = useMutation({
    mutationFn: id => api.delete('/recipe-links/links/' + id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipe-dishes'] }),
  })
  if (isLoading) return <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
  if (error) return <ErrorNote error={error} />
  const suggested = data.dishes.filter(d => d.suggestion)
  const goods = data.dishes.filter(d => d.goods_item)
  const edit = canManage && data.can.manage
  return (
    <div className="space-y-4" data-testid="dish-list">
      <p className="text-sm text-muted-foreground">
        Link each dish on your menus to its recipe. A venue, a revenue stream or an order type (takeaway, delivery) can use another
        recipe or a variation: open the dish to set them.
      </p>
      {edit && (suggested.length > 0 || goods.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {suggested.length > 0 && (
            <button type="button" className={cn(btn.primary, 'h-12')} onClick={() => setReview('recipes')} data-testid="dish-bulk-open">
              <Link2 className="w-4 h-4" />Link {suggested.length} {suggested.length === 1 ? 'dish' : 'dishes'} to their recipes
            </button>
          )}
          {goods.length > 0 && (
            <button type="button" className={cn(btn.outline, 'h-12')} onClick={() => setReview('goods')} data-testid="dish-goods-open">
              <Package className="w-4 h-4" />Link {goods.length} goods to their stock items
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[14rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputCls, 'h-12 pl-9')} value={q} onChange={e => setQ(e.target.value)} placeholder="Search dishes, sections, recipes"
            aria-label="Search dishes" data-testid="dish-search" />
        </label>
        <select className={cn(inputCls, 'h-12 w-56')} value={menuId} onChange={e => setMenuId(e.target.value)} aria-label="Menu" data-testid="dish-menu">
          <option value="">Every menu</option>
          {data.menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <Segmented value={only} onChange={setOnly} options={[{ value: 'all', label: 'All' }, { value: 'unlinked', label: 'No recipe (' + data.counts.unlinked + ')' }]}
          className="[&>button]:h-12" testid="dish-only" />
      </div>
      <Card title={rows.length + (rows.length === 1 ? ' dish' : ' dishes')} bodyClass="p-0">
        {!rows.length ? (
          <p className="p-4 text-sm text-muted-foreground">{data.dishes.length ? 'Nothing matches.' : 'No dishes yet: they are made on the Menus page.'}</p>
        ) : (
          <ul className="divide-y" data-testid="dish-rows">
            {rows.map(d => (
              <li key={d.id} className="flex flex-wrap items-center">
                <button type="button" onClick={() => onOpen(d.id)} data-testid="dish-row" data-name={d.name}
                  className="flex-1 min-w-[16rem] text-left px-4 py-3 min-h-[56px] flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-muted/50 touch-manipulation">
                  <span className="flex-1 min-w-[12rem]">
                    <span className="font-medium">{d.name}</span>
                    {KIND_WORDS[d.kind] && <span className="ml-2 text-xs rounded-full bg-muted px-2 py-0.5">{KIND_WORDS[d.kind]}</span>}
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {[d.menu, d.section, d.price_pence != null ? penceText(d.price_pence) : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="w-56 max-w-full text-sm">
                    {d.default ? <span className="font-medium">{d.default.recipe_name}</span>
                      : d.suggestion ? <span className="text-xs text-muted-foreground">Matches {d.suggestion.recipe_name}</span>
                        : d.goods_item ? <span className="text-xs text-muted-foreground">Stock item {d.goods_item.name}</span> : null}
                    {d.overrides > 0 && <span className="block text-xs text-muted-foreground">+{d.overrides} {d.overrides === 1 ? 'other place' : 'other places'}</span>}
                  </span>
                  <DishCoverage coverage={d.coverage} />
                </button>
                {edit && onMake && d.coverage === 'unlinked' && (d.kind === 'dish' || d.kind === 'goods') && !d.suggestion && !d.goods_item && (
                  <button type="button" className={cn(btn.outline, 'h-12 mx-4 my-2')} onClick={() => onMake(d.id)} data-testid="dish-make-recipe">
                    <Plus className="w-4 h-4" />Make a recipe for this dish
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data.missing.length > 0 && (
        <Card title="No longer on a menu" bodyClass="p-0">
          <p className="px-4 pt-3 text-xs text-muted-foreground">Links whose dish isn&apos;t on any menu now. They are deleted 30 days after the dish went; a dish that comes back keeps its link.</p>
          <ul className="divide-y" data-testid="dish-missing">
            {data.missing.map(m => (
              <li key={m.link_id} className="px-4 py-2 min-h-[56px] flex items-center gap-2">
                <span className="flex-1 text-sm">{m.recipe_name || 'A recipe'}<span className="block text-xs text-muted-foreground">{m.missing_since ? 'gone since ' + String(m.missing_since).slice(0, 10) : 'gone since the last check'}</span></span>
                {edit && <ConfirmDelete label="Delete link" onConfirm={() => forget.mutate(m.link_id)} disabled={forget.isPending} big />}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {review && <ReviewLinks kind={review} dishes={review === 'recipes' ? suggested : goods} onClose={() => setReview(null)} />}
    </div>
  )
}

/** The matches to review: each ticked when sure, untick what is wrong, then Save. */
function ReviewLinks({ kind, dishes, onClose }) {
  const api = useApi()
  const qc = useQueryClient()
  const [ticked, setTicked] = useState(() => new Set(dishes.filter(d => kind === 'goods' || d.suggestion?.sure).map(d => d.id)))
  const toggle = id => setTicked(t => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const save = useMutation({
    mutationFn: () => (kind === 'goods'
      ? api.post('/recipe-links/goods', { dishes: dishes.filter(d => ticked.has(d.id)).map(d => ({ dish_id: d.id, item_id: d.goods_item.id })) })
      : api.post('/recipe-links/bulk', { links: dishes.filter(d => ticked.has(d.id)).map(d => ({ dish_id: d.id, recipe_id: d.suggestion.recipe_id })) })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe-dishes'] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe-pickers'] })
      onClose()
    },
  })
  return (
    <Modal title={kind === 'goods' ? 'Link goods to their stock items' : 'Link dishes to their recipes'} onClose={onClose}
      footer={(
        <button type="button" className={cn(btn.primary, 'h-12')} disabled={!ticked.size || save.isPending} onClick={() => save.mutate()} data-testid="dish-bulk-save">
          {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Save {ticked.size} {ticked.size === 1 ? 'link' : 'links'}
        </button>
      )}>
      <p className="text-sm text-muted-foreground">
        {kind === 'goods'
          ? 'Each goods dish gets a recipe of one of its stock item (the same barcode), linked for every venue.'
          : 'Matched by product code, then name. Sure matches are ticked; untick any that are wrong. Each is linked for every venue.'}
      </p>
      <ul className="rounded-lg border divide-y" data-testid="dish-bulk-list">
        {dishes.map(d => (
          <li key={d.id}>
            <button type="button" onClick={() => toggle(d.id)} aria-pressed={ticked.has(d.id)} data-testid="dish-bulk-row"
              className="w-full text-left px-3 py-2 min-h-[56px] flex items-center gap-3 hover:bg-muted touch-manipulation">
              <span className={cn('w-6 h-6 rounded border flex items-center justify-center shrink-0', ticked.has(d.id) ? 'bg-primary border-primary text-primary-foreground' : 'bg-background')}>
                {ticked.has(d.id) && <Check className="w-4 h-4" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium">{d.name}</span> <span className="text-xs text-muted-foreground">{d.menu}</span>
                <span className="block text-xs text-muted-foreground">
                  {kind === 'goods' ? 'Stock item: ' + d.goods_item.name : d.suggestion.recipe_name + ' · ' + d.suggestion.reason}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote error={save.error} />
    </Modal>
  )
}
