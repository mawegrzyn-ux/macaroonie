// Editor for the Online ordering block (migration 126): the ordering app
// (menu, basket, checkout) as a page block. See
// api/src/views/site/blocks/online_ordering.eta for how the venue is chosen
// and how these settings reach shared/ordering.eta.
import { useQuery } from '@tanstack/react-query'
import { useApi } from '@/lib/api'
import { FormRow } from '../shared'
import { ThemeColourPicker } from '../ThemeColourPicker'

const input = 'w-full text-sm border rounded-md px-2 py-1.5 bg-background min-h-[36px]'

function Check({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-2 text-sm min-h-[36px] cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}

function Group({ title, children }) {
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

export function OnlineOrderingEditor({ data, onChange }) {
  const api = useApi()
  const set = (k) => (v) => onChange({ ...data, [k]: v })
  const { data: venues = [] } = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get('/venues'),
    staleTime: 60_000,
  })
  const mode = data.basket_mode === 'modal' ? 'modal' : 'side'
  return (
    <div className="space-y-3">
      <FormRow label="Venue"
        hint="Automatic: on /order the venue the guest chose; on a location page that location; with one venue taking online orders, that venue; otherwise guests pick a location. Only venues with online ordering switched on (Online orders, Setup) show anything.">
        <select value={data.venue_id || ''} onChange={e => set('venue_id')(e.target.value || null)} className={input}>
          <option value="">Automatic</option>
          {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </FormRow>
      <FormRow label="Heading (optional)" hint="Shown above the menu.">
        <input value={data.heading || ''} onChange={e => set('heading')(e.target.value)} className={input} />
      </FormRow>

      <Group title="Title and text">
        <Check label="Hide the title" checked={data.hide_title} onChange={set('hide_title')}
          hint="Useful when a hero or heading above already says where the order is from." />
        {!data.hide_title && (
          <FormRow label="Title" hint="Blank: the venue name. {venue} and {address} fill in this venue's name and address.">
            <input value={data.title_text || ''} onChange={e => set('title_text')(e.target.value)} placeholder="Venue name" className={input} />
          </FormRow>
        )}
        <Check label="Hide the text under the title" checked={data.hide_subtitle} onChange={set('hide_subtitle')} />
        {!data.hide_subtitle && (
          <FormRow label="Text under the title" hint="Blank: “Order for collection · address”. {venue} and {address} work here too.">
            <textarea rows={2} value={data.subtitle_text || ''} onChange={e => set('subtitle_text')(e.target.value)}
              placeholder="Order for collection · address" className={input} />
          </FormRow>
        )}
      </Group>

      <Group title="Basket">
        <FormRow label="Show the basket">
          <div className="grid grid-cols-2 gap-1.5">
            {[['side', 'Beside the menu', 'On phones it is always a pop-up.'], ['modal', 'Pop-up only', 'A basket button floats at the bottom, like on phones.']].map(([k, label, hint]) => (
              <button key={k} type="button" onClick={() => set('basket_mode')(k)} title={hint}
                className={'text-sm border rounded-md px-2 py-2 min-h-[44px] touch-manipulation ' + (mode === k ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent')}>
                {label}
              </button>
            ))}
          </div>
        </FormRow>
        {mode === 'side' && (
          <Check label="Keep the basket in view while scrolling" checked={data.basket_sticky !== false} onChange={set('basket_sticky')}
            hint="Desktop and tablet. A long basket scrolls inside itself." />
        )}
        <FormRow label="Basket background">
          <ThemeColourPicker value={data.basket_bg || ''} onChange={set('basket_bg')} noneLabel="Default" />
        </FormRow>
        <FormRow label="Basket text colour" hint="Pick one if the background is dark.">
          <ThemeColourPicker value={data.basket_text || ''} onChange={set('basket_text')} noneLabel="Default" />
        </FormRow>
        <Check label="Show VAT under the total" checked={data.show_vat !== false} onChange={set('show_vat')}
          hint="“Includes VAT £x” in the basket and at checkout." />
      </Group>

      <Group title="Menu">
        <Check label="Keep the category bar in view while scrolling" checked={data.sticky_nav !== false} onChange={set('sticky_nav')}
          hint="The menu and category tabs (and search, if on) stay at the top; the current category is highlighted." />
        {(data.sticky_nav !== false || (mode === 'side' && data.basket_sticky !== false)) && (
          <FormRow label="Space for a sticky site header (px)" hint="Leave at 0: the bar and basket fit below your site header automatically. Enter a height only to override that.">
            <input type="number" inputMode="numeric" min={0} max={200} value={data.sticky_offset ?? 0}
              onChange={e => set('sticky_offset')(Math.max(0, Math.min(200, Number(e.target.value) || 0)))} className={input + ' w-28'} />
          </FormRow>
        )}
        <Check label="Search box" checked={data.show_search} onChange={set('show_search')}
          hint="Guests can search dishes by name or description across all menus." />
        {data.show_search && (
          <FormRow label="Show search as" hint="An icon saves space: a round magnifier at the start of the category bar that stays put while the categories scroll under it. Tapping it opens the search box.">
            <div className="grid grid-cols-3 gap-1.5">
              {[['bar', 'Full-width box'], ['icon_phone', 'Icon on phones'], ['icon', 'Icon everywhere']].map(([k, label]) => {
                const on = (data.search_style || 'bar') === k
                return (
                  <button key={k} type="button" onClick={() => set('search_style')(k)}
                    className={'text-sm border rounded-md px-2 py-2 min-h-[44px] touch-manipulation ' + (on ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-accent')}>
                    {label}
                  </button>
                )
              })}
            </div>
          </FormRow>
        )}
        <Check label="Highlight house favourites" checked={data.highlight_favourites} onChange={set('highlight_favourites')}
          hint="Dishes ticked as House favourite on the Menus page get a badge and a coloured edge." />
        {data.highlight_favourites && (
          <FormRow label="Badge text">
            <input value={data.favourite_label || ''} onChange={e => set('favourite_label')(e.target.value)} placeholder="House favourite" className={input} />
          </FormRow>
        )}
        {data.highlight_favourites && (
          <FormRow label="Favourite background">
            <ThemeColourPicker value={data.favourite_bg || ''} onChange={set('favourite_bg')} noneLabel="Default" />
          </FormRow>
        )}
        {data.highlight_favourites && (
          <FormRow label="Favourite text colour" hint="Pick one if the background is dark.">
            <ThemeColourPicker value={data.favourite_text || ''} onChange={set('favourite_text')} noneLabel="Default" />
          </FormRow>
        )}
        <Check label="Let guests add a note to each dish" checked={data.item_notes !== false} onChange={set('item_notes')}
          hint="The “Note for the kitchen” box on each dish. The order-wide notes and allergy boxes at checkout stay." />
      </Group>
    </div>
  )
}
