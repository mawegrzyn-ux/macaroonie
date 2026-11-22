// src/pages/help/faq.jsx
// The Help page's "FAQ & Troubleshooting" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2 } from './parts.jsx'

export const id = 'faq'
export const label = 'FAQ & Troubleshooting'
export const order = 540

export function Section() {
  return (
    <section id="faq" data-help="">
      <H2>FAQ &amp; Troubleshooting</H2>
      <div className="space-y-4">
        {[
          {
            q: 'A page shows "This page stopped working".',
            a: 'Something on that page failed while it was being shown. Nothing you saved before is lost. Press Reload page; moving to another page from the menu also clears it. If it happens again, send support the message in the grey box and say what you pressed just before.',
          },
          {
            q: 'My venue is not showing any slots in the widget.',
            a: 'Check that (1) the venue is active — it is easy to accidentally deactivate it in settings. (2) The venue has a schedule with sittings for the day you are testing. (3) The date is not blocked by a date override marked as Closed. (4) The booking cutoff has not passed for those slots.',
          },
          {
            q: 'A guest says the slot was available but they got a conflict error at checkout.',
            a: 'This is expected behaviour. The slot was available when the guest started, but another guest completed their booking first. The double-booking protection (database UNIQUE constraint + FOR UPDATE lock) prevents two bookings for the same slot. The guest should select another time.',
          },
          {
            q: 'Bookings are not appearing on the Timeline after they are confirmed.',
            a: 'Click the refresh button in the Timeline toolbar. If bookings still do not appear, log out and log back in — Auth0 tokens expire after a period of inactivity, which prevents data from loading. This is not a data loss issue; the bookings are saved correctly in the database.',
          },
          {
            q: 'How do I block off a specific date (bank holiday, private event)?',
            a: 'Go to Schedule → click the calendar/override icon on the day → Add date override → mark it as Closed (or add custom sittings with reduced hours). The override applies to all tables at that venue for that date.',
          },
          {
            q: 'Can the same table be booked twice in one day?',
            a: 'Yes — multiple bookings at different times on the same table is normal and correct. The system only prevents overlapping bookings on the same table. The slot generator subtracts confirmed bookings and active holds when calculating what is available.',
          },
          {
            q: 'What happens if a guest does not complete their booking within the hold time?',
            a: 'The hold expires automatically. The slot becomes available again within the next minute (pg_cron sweep runs every minute). The guest sees an "expired" message if they try to continue. There is no charge taken for expired holds.',
          },
          {
            q: 'How do I change the party size limit for my venue?',
            a: 'Go to Rules for your venue and update Min Covers and Max Covers. These limits apply to all bookings for that venue. The widget will only show slots for party sizes within this range.',
          },
          {
            q: 'A combination booking is only showing one tile in the Timeline, not spanning all the tables.',
            a: 'The Timeline merges tiles for adjacent tables. If the combination includes non-adjacent tables (with other tables between them in the list), you will see separate tiles. This is correct — each contiguous group of tables in the combination shows as one merged tile, and non-adjacent groups show as separate tiles.',
          },
          {
            q: 'I dragged a booking to a new time but the duration changed.',
            a: 'This is fixed in the current version. Dragging now preserves the booking\'s actual duration (including any manual resize). If you see the duration reset to the default slot duration, ensure your API is up to date.',
          },
          {
            q: 'The venue selector is empty on the Timeline.',
            a: 'This usually means your Auth0 session has expired. Log out and log back in. If the issue persists, check that at least one venue is active for your account on the Venues page.',
          },
          {
            q: 'I dragged a booking to a different table but it ended up on unexpected tables.',
            a: 'Smart allocation picks the best arrangement anchored to the table you dropped on. If the target table alone cannot seat the party, the system looks for a combination that includes that table, then falls back to adjacent tables by sort order. To get predictable results, (1) configure combinations for the table groupings you want, and (2) set your table sort order to match the physical floor plan — Tables → Reorder.',
          },
          {
            q: 'A booking appeared in the Unallocated row after a drag.',
            a: 'This means a booking was displaced when smart allocation moved the dragged booking onto its table, and no other free table was available at that time. The displaced booking is still confirmed — it just has no physical table. Drag it out of the Unallocated row and drop it onto a suitable table row to re-assign it. The smart-allocation engine will run again from the new target table.',
          },
          {
            q: 'How do I control which tables the system combines when I drag a large-party booking?',
            a: 'Two ways: (1) Create explicit table combinations on the Tables page — the system always prefers configured combinations over ad-hoc adjacency. (2) Set your table sort order (Tables → Reorder) so that tables you want combined are adjacent in the list — the adjacency expansion follows sort order, so physically adjacent tables should be neighbours in the list.',
          },
          {
            q: 'I set the table order but the Timeline still shows the old order.',
            a: 'The Timeline fetches the table list when it loads. Click the Refresh button in the Timeline toolbar, or navigate away and back, to pick up the new sort order.',
          },
          {
            q: 'Dragging a booking to a different table returns it to where it was with no error.',
            a: 'The most common cause is that migration 010 (allocation_rules) has not been applied to the database. Run: psql $DATABASE_URL -f migrations/010_allocation_rules.sql. Without this migration, the /relocate endpoint fails silently because the allow_cross_section_combo column and disallowed_table_pairs table do not exist.',
          },
          {
            q: 'The drag snapped back and the Timeline shows a red banner saying "No table combination is configured".',
            a: 'The smart-allocation engine found the right table set (via adjacency expansion) but no pre-configured combination exists for those tables. Go to Tables → Table combinations → Add combination, create a combination for those tables, then try the drag again.',
          },
          {
            q: 'I created a new booking for 5 covers but it only shows on one table in the Timeline.',
            a: 'The booking was probably confirmed via the free-booking path before the combination_id fix was deployed. The booking hold had a combination_id but the older confirm code did not copy it to the booking record. Open the booking in the drawer, click Override, re-select the correct tables, and save to fix the assignment.',
          },
          {
            q: 'Slot caps I entered are not showing when I reopen the sitting.',
            a: 'This was a known bug (now fixed) where PostgreSQL returned slot_time as HH:MM:SS but the frontend expected HH:MM, so saved values would not display on reload. After updating to the latest version, saved caps should display correctly.',
          },
          {
            q: 'I want to prevent certain tables from being combined by the smart-allocation engine.',
            a: 'Go to Tables → scroll to Disallowed pairs → select the two tables and click Add. The engine will never combine that pair, regardless of party size or adjacency. Note: this only restricts the engine — operators can still manually assign any table combination via the booking drawer Override.',
          },
          {
            q: 'Guests can\'t see late slots in the widget but they appear in the admin timeline.',
            a: 'Check the Doors close time on that day in the Schedule page. If it\'s set, the widget hides slots at or after that time. Either remove the Doors close time, move it later, or enable \'Allow widget bookings past doors-close time\' in Rules → Opening hours enforcement.',
          },
          {
            q: 'A paid booking via the widget didn\'t show the guest\'s notes / appeared as single table instead of combination.',
            a: 'This was a bug in the Stripe webhook — fixed. The webhook now correctly copies both combination_id and guest_notes from the hold into the booking. If you have affected historical bookings, you\'ll need to manually update them via the drawer.',
          },
          {
            q: 'The Manual allocation button does not appear.',
            a: 'It is always visible on the slot selection step of the New booking modal, next to the Continue button. If you do not see it, check that you are on the Timeline page (not the Bookings list) and that the modal has fully loaded.',
          },
          {
            q: 'I created a schedule exception but slots still show normally.',
            a: 'Check that the exception\'s date range covers today\'s date and that the priority is set correctly. If two exceptions overlap the same date, the one with the higher priority number wins. Also verify migration 014 and 015 have been run on your database.',
          },
          {
            q: 'Grey columns appear where I expect the venue to be open.',
            a: 'Grey columns mean the slot query returned no available slots for that time. This usually means no sitting covers that time in your schedule. Check your sittings on the Schedule page and ensure the day is toggled open.',
          },
          {
            q: 'I can see fewer slots than expected — some late slots are missing.',
            a: 'This was fixed in migration 020. Previously the system only showed slots where the entire booking would finish before the last order time. Now any slot that starts at or before the last order time is shown. If you still see fewer slots than expected after applying migration 020, check that the sitting\'s end time (Last order) is set correctly in the Schedule.',
          },
          {
            q: 'The booking modal shows a warning about running past last orders or doors close.',
            a: 'This is informational only — the booking can still be confirmed. The amber warning means the booking end time falls after the sitting\'s last order time. The red warning means it falls after the sitting\'s doors close time. Both warnings are shown to help you plan staffing, but neither blocks the booking.',
          },
          {
            q: 'A guest\'s booking is running longer than expected — how do I update the end time?',
            a: 'Open the booking in the drawer (tap the tile on the Timeline). In the Date & time section, tap the End time button. A time picker appears — select the new end time and tap Save end time in the drawer header. The Timeline updates immediately. On a tablet, the native OS time picker opens automatically.',
          },
          {
            q: 'I want to change the brand colour / make the portal look different.',
            a: 'Go to Settings in the sidebar. In the Appearance section, pick a colour using the colour picker, type a hex value directly, or select one of the preset swatches. The change applies instantly across the whole portal. Settings are saved in your browser and persist across sessions.',
          },
          {
            q: 'The + New booking button has disappeared from the toolbar.',
            a: 'The + New booking button moved from the toolbar to a round floating button at the bottom-right corner of the Timeline canvas. You can also click any empty cell on the canvas to start a manual booking at that time.',
          },
          {
            q: 'The venue selector / refresh / fullscreen controls are gone from the Timeline toolbar.',
            a: 'These controls moved to the sidebar (left menu). They appear above the logout button when you are on the Timeline page. If the sidebar is collapsed to icon-only mode, you will see small icon buttons; expand the sidebar to see the full labels.',
          },
          {
            q: 'How do I hide cancelled and no-show bookings from the Timeline?',
            a: 'In the sidebar, while on the Timeline page, tap the Inactive toggle. This hides cancelled, no-show, and checked-out bookings from the canvas. Tap it again to show them. The setting persists across sessions — it is also configurable as a default in Settings → Timeline defaults.',
          },
          {
            q: 'How do I edit the start time and end time of a booking from the drawer?',
            a: 'In the booking drawer, tap either the start time pill or the end time pill in the Date & time section. Both open the same unified editor showing the date, start time, and end time together. Change whichever values you need, then tap the save button in the drawer header. To close without saving, tap the start pill again.',
          },
          {
            q: 'Can I type a number directly into the covers field in the booking drawer?',
            a: 'Yes. In the booking drawer, tap the covers number in the Guest details section — it becomes a direct-entry field. You can also use the + and − buttons. The value saves when you tap the save button in the drawer header.',
          },
          {
            q: 'How do I change the colour of a specific booking status on the Timeline?',
            a: 'Go to Settings → Booking status colours. Tap the status tile you want to change (e.g. Confirmed). Choose one of the 12 preset swatches or use the colour picker for a custom shade. Tap Done. To restore all statuses to their defaults at once, tap Reset all.',
          },
          {
            q: 'The Timeline background colour swatch I clicked did not seem to change anything.',
            a: 'The colour did apply — the swatch selected applies immediately to the Timeline canvas. If the change is hard to see, try a more distinct colour (e.g. a warm cream or pale blue from the swatches). The colour picker circle in Settings also updates to reflect the newly selected swatch.',
          },
          {
            q: 'How do I make the Timeline tiles show the phone number and table allocation?',
            a: 'Tap the Detail toggle in the sidebar (on the Timeline page) to switch to Detailed tile mode. Each tile will expand to show three lines: name + covers, phone number, and table allocation. You can set Detailed as the default in Settings → Timeline defaults → Default tile mode.',
          },
          {
            q: 'The booking tiles are too small to read on my large monitor.',
            a: 'Two options: (1) In Settings → Timeline defaults, increase the Compact tile size from S to M or L for larger text and row height while staying in compact mode. (2) Switch to Detailed mode using the Detail toggle in the sidebar for the fullest information display. You can also enable Wide time columns in Settings to spread the Timeline out horizontally.',
          },
          {
            q: 'Can I make the hour columns wider so I can see booking times more clearly?',
            a: 'Yes. Go to Settings → Timeline defaults → Wide time columns and toggle it on. This increases each hour column from 80 px to 120 px. The change applies instantly on the Timeline and persists across sessions.',
          },
        ].map(({ q, a }) => (
          <div key={q} className="border rounded-lg p-4">
            <p className="text-sm font-semibold mb-2">Q: {q}</p>
            <p className="text-sm text-muted-foreground">A: {a}</p>
          </div>
        ))}
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">What is the thick coloured line on the Timeline?</p>
          <p className="text-sm text-muted-foreground">
            That is the <strong>opening hour line</strong> — a visual marker at the start of the
            first sitting for the day. You can change its colour or turn it off entirely in{' '}
            <strong>Settings → Appearance → Opening hour line</strong>.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Why is a booking showing a ⛔ stop sign?</p>
          <p className="text-sm text-muted-foreground">
            Two or more active bookings are assigned to the same table at the same time. Both tiles
            are flagged with a red border and the stop sign. Open one of the bookings and either
            change its table assignment or adjust its time to resolve the conflict.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">The stats bar doesn't show Lunch and Dinner separately — it shows a time range instead.</p>
          <p className="text-sm text-muted-foreground">
            Session names haven't been set yet. Go to <strong>Schedule</strong>, click the pencil
            icon on each sitting, and enter a name (e.g. "Lunch", "Dinner"). The stats bar will
            use these names automatically.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">How do I hide the early-morning columns on the Timeline?</p>
          <p className="text-sm text-muted-foreground">
            Go to <strong>Settings → Timeline defaults → Timeline hours</strong> and change the
            start hour to match when your day actually begins (e.g. 11:00). The timeline canvas
            will only show hours from that point onwards.
          </p>
        </div>
        <div className="space-y-1.5 border rounded-xl px-4 py-3">
          <p className="text-sm font-semibold">Can I assign a booking to no table (Unallocated)?</p>
          <p className="text-sm text-muted-foreground">
            Yes. Open the booking drawer, click <strong>Override</strong> in the table section, and
            select <strong>Unallocated</strong> at the top of the table list. The booking moves to
            the orange Unallocated row on the Timeline where it can be dragged to a real table later.
          </p>
        </div>
      </div>
    </section>
  )
}
