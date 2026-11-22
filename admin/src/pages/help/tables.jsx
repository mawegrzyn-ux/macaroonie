// src/pages/help/tables.jsx
// The Help page's "Tables & Combinations" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'tables'
export const label = 'Tables & Combinations'
export const order = 70

// ── TABLES ──────────────────────────────────────
export function Section() {
  return (
    <section id="tables" data-help="">
      <H2>Tables &amp; Combinations</H2>

      <H3>Adding tables</H3>
      <P>
        Go to <strong>Tables</strong> in the sidebar. Select your venue, then click{' '}
        <strong>Add table</strong>. Each table needs:
      </P>
      <ul className="list-disc list-inside text-sm text-muted-foreground ml-2 mb-4 space-y-1">
        <li><strong>Label</strong> — the name shown on the Timeline (e.g. T1, Bar 3, Garden A).</li>
        <li><strong>Section</strong> — which area of the restaurant this table belongs to.</li>
        <li><strong>Min covers</strong> — smallest party size this table suits.</li>
        <li><strong>Max covers</strong> — largest party size this table suits.</li>
      </ul>
      <P>
        Tables with <strong>Active</strong> turned off will not appear in the Timeline or widget
        and cannot be booked.
      </P>

      <H3>Sections</H3>
      <P>
        Sections group tables into areas of your restaurant — for example, <em>Main Floor</em>,{' '}
        <em>Terrace</em>, or <em>Private Dining Room</em>. Sections appear as labelled groups in
        the Timeline, making it easier to find a table at a glance. Create sections on the Tables
        page before adding tables to them.
      </P>

      <H3>Table combinations</H3>
      <P>
        A table combination defines two or more tables that can be pushed together to accommodate
        a larger party. For example, T1 and T2 can form a combined table for up to 8 covers.
      </P>
      <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
        <li>Scroll to the <strong>Table combinations</strong> section at the bottom of the Tables page.</li>
        <li>Click <strong>Add combination</strong>.</li>
        <li>Give it a name (e.g. "T1 + T2"), set the min and max covers for the combined space, and select which tables are part of it.</li>
        <li>Save. The combination will now be offered by the booking widget for appropriately sized parties.</li>
      </ol>
      <InfoBox type="info">
        The booking widget automatically selects the right table or combination based on party size.
        When multiple options fit, the widget prefers individual tables first and only suggests
        combinations when needed for larger parties.
      </InfoBox>

      <H3>How combination tiles appear in the Timeline</H3>
      <P>
        When a combination booking is confirmed, the Timeline shows it as a single tall tile spanning
        all the member table rows — as long as those tables are adjacent in the Timeline list.
        If non-adjacent tables are combined (e.g. T1+T2 and T4, with T3A between them in the list),
        separate tiles appear at each group's position.
      </P>
      <InfoBox type="info">
        Pre-configured combinations always take priority over the adjacency rule when you drag a
        booking on the Timeline. Even if a combination's members are not neighbours in the sort
        order (e.g. T1+T2+T3B with T3A sitting between T2 and T3B), the system will use the
        combination as a relocation target. The "Allow non-adjacent tables" rule in Rules only
        affects the engine's automatic expansion, not combinations you have explicitly created.
      </InfoBox>

      <H3>Setting table order</H3>
      <P>
        The order of tables in the Tables page determines the row sequence in the Timeline{' '}
        <strong>and</strong> controls which tables are considered "next to" each other when the
        system automatically finds space for a dragged booking. Getting this order right is
        important for smart allocation to work the way your floor plan is physically laid out.
      </P>
      <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
        <li>Go to <strong>Tables</strong> in the sidebar and select your venue.</li>
        <li>Click the <strong>Reorder</strong> button in the top-right header.</li>
        <li>The page switches to a flat sorted list showing all tables with position numbers on the left.</li>
        <li>Grab the <strong>grip handle</strong> (⠿) on any row and drag it up or down to the desired position.</li>
        <li>When the order looks right, click <strong>Save order</strong>. The new order takes effect in the Timeline and smart allocation immediately.</li>
      </ol>
      <InfoBox type="tip">
        Set up your table order to match the physical floor plan — tables that are physically
        adjacent should be adjacent in the list. This is what the system uses when it tries to
        combine nearby tables for a large-party booking that gets dragged to a new position.
      </InfoBox>
    </section>
  )
}
