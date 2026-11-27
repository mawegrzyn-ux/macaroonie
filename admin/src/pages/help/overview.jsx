// src/pages/help/overview.jsx
// The Help page's "The Overview Page" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'overview'
export const label = 'The Overview Page'
export const order = 40

export function Section() {
  return (
    <section id="overview" data-help="">
      <H2>The Overview Page</H2>
      <P>
        <strong>Overview</strong> (the home page, sidebar nav) is built from tiles — your
        pins, today's stats, upcoming bookings, venue status, and (if your
        owner has added them) H&amp;S status tiles. An owner or admin can click
        <strong> Customise layout</strong> to add, remove, resize, reorder, rename, and set which
        roles can see each tile. To rename a tile, type in its <strong>Name</strong> box and tap
        Save; <strong>Use default</strong> puts the built-in name back.
      </P>
      <H3>Available tiles</H3>
      <DataTable
        head={['Tile', 'Shows']}
        rows={[
          ['Your pins', 'Your own pins, the same as on Home (see the info box below).'],
          ['Today\'s stats', 'Bookings today, covers today, deposit revenue, upcoming today.'],
          ['Upcoming bookings', 'Today\'s remaining bookings from now, soonest first.'],
          ['Venues status', 'One card per venue with an active/inactive dot and table count.'],
          ['H&S checks today', 'Combined Checklists + Food safety status for today. Below the overall badge, every checklist is listed by name (done/not done), plus one line each for fridge/freezer checks, hot/cold hold checks, and cooking checks (only the categories you actually have configured), and a delivery checks line showing how many deliveries were logged that day — grouped by venue if you have more than one. A delivery that failed a check with no corrective action noted turns the day red.'],
          ['Week\'s H&S status', 'The same status as a Monday-to-Sunday strip for the current week — one coloured cell per day.'],
          ['Allergen lookup', 'Pick a menu, search a dish, or press Allergens & diet and tap tags in the grid to list dishes that have them or are free from them. Shows Contains, May contain and Can be removed apart (see Menus, Allergen matrix).'],
          ['Stock', 'Each venue in a line: counts to approve, transfers to receive, flagged items to review, the last full count and, with Costing view and Till reports view, this week\'s theoretical food cost and the latest actual. Needs Stock view; tap a venue for its Stock page.'],
        ]}
      />
      <H3>H&amp;S status colours</H3>
      <DataTable
        head={['Colour', 'Meaning']}
        rows={[
          ['Green', 'Everything due today is complete, with no unresolved out-of-range readings.'],
          ['Amber', 'Some checks are done, some aren\'t yet.'],
          ['Red', 'Either nothing has been done yet, or there\'s an out-of-range reading (temperature, hold, or cooking check) still missing a corrective action — that always takes priority over the completion count.'],
          ['Grey', 'Nothing is due or configured for that day.'],
        ]}
      />
      <P>
        The status combines Checklists (every active checklist counts, regardless of its
        daily/weekly/monthly frequency — see the Checklists section) with Food safety
        (equipment and hold temperature checks against their configured capture times, and
        cooking-check sessions against their required item count).
      </P>
      <H3>Per-role visibility</H3>
      <P>
        In edit mode, each tile shows a <strong>Visible to all</strong> / <strong>Hidden
        from N</strong> button — click it to untick specific roles. A hidden tile simply
        doesn't appear for anyone in that role; there's no partial/blurred state.
      </P>
      <InfoBox type="info">
        The <strong>Your pins</strong> tile is different from the Overview's own tile
        layout: an admin decides whether the tile appears at all (and for which roles), but
        what is inside it is each person's own pins, picked from the pages of their own menu
        with <strong>Edit pins</strong>. They are kept with your login, so the same pins show
        on any device, and nobody else sees them (see Home, Your pins).
      </InfoBox>
    </section>
  )
}
