// src/pages/help/getting-started.jsx
// The Help page's "Getting Started" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'getting-started'
export const label = 'Getting Started'
export const order = 10

// ── GETTING STARTED ─────────────────────────────
export function Section() {
  return (
    <section id="getting-started" data-help="">
      <H2>Getting Started</H2>
      <P>
        Welcome to Macaroonie. Follow this checklist to get your restaurant set up and ready to take
        bookings. Each step links to a section in this guide.
      </P>
      <InfoBox type="tip">
        Macaroonie lives at <strong>office.macaroonie.com</strong>. The phone app is at{' '}
        <strong>ops.macaroonie.com</strong> (see Mobile App). <strong>macaroonie.com</strong> is the
        public page about the platform, and old admin links there forward to office.macaroonie.com.
      </InfoBox>

      <div className="space-y-3 mb-6">
        {[
          ['Set up your venue', 'Venues > New venue walks you through it: the name, address and timezone, your brand, the menu (read from photos or a PDF), opening hours, tables and the rest. The timezone is critical — all booking times display in your local time.'],
          ['Add tables and sections', 'Organise your floor plan into sections (Main Floor, Terrace, Bar, etc.), then add each table with its seating capacity.'],
          ['Set table order', 'Use the Reorder button on the Tables page to drag tables into the order they appear on your floor plan. This drives the Timeline row sequence and the smart-allocation adjacency logic.'],
          ['Set up table combinations', 'If adjacent tables can be pushed together for larger parties, create a combination (e.g. T1 + T2 = combined table for 6).'],
          ['Configure your weekly schedule', 'Define which days you open and add sittings (Lunch, Dinner). Each sitting has its own slot duration, interval, and cover cap.'],
          ['Set booking rules', 'Configure minimum and maximum covers per booking, the hold time limit, and the cutoff before a slot starts.'],
          ['(Optional) Enable deposits', 'Connect your Stripe account in Ordering setup, then turn deposits on in Booking rules: guests booking online pay by card.'],
          ['Test the booking widget', 'Go to Widget Test in the sidebar and run a test booking end-to-end before going live.'],
        ].map(([title, desc], i) => (
          <div key={i} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold mt-0.5">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <H3>Roles explained</H3>
      <div className="space-y-2">
        {[
          ['Owner', 'Full access. Can manage billing, team, and all settings.'],
          ['Admin', 'Can configure venues, tables, schedules, and rules. Can manage bookings.'],
          ['Operator', 'Can create and manage bookings, Cash Recon, the rota and H&S checks. Can look at customers, tables and the schedule but not change them.'],                ['Viewer', 'Read-only. Can view bookings, customers, menus and schedules but cannot make changes.'],
        ].map(([role, desc]) => (
          <div key={role} className="flex gap-3 items-start border rounded-lg px-3 py-2">
            <span className="text-sm font-semibold w-20 shrink-0">{role}</span>
            <span className="text-sm text-muted-foreground">{desc}</span>
          </div>
        ))}
      </div>

      <H3>Switching restaurants</H3>
      <P>
        If your account is connected to more than one restaurant, the sidebar header shows
        your current restaurant's name with a small arrow next to it. Tap the name (or the
        arrow) to open the restaurant picker. If your account only has one restaurant, the
        name is shown without an arrow — there's nothing to switch to.
      </P>
      <P>
        When you sign in to a restaurant (by picking it on the login screen, or from an
        invitation link), that's the restaurant you work in, even if this browser was last used
        for another one. Switching in the sidebar afterwards sticks until you next sign in.
        Otherwise Macaroonie opens the restaurant you used last on that browser. On the phone
        (ops.macaroonie.com) the restaurant&apos;s name is in the top bar next to the page&apos;s
        title, with a switch button (two arrows) next to sign out to change it.
      </P>

      <H3>Menu on tablets</H3>
      <P>
        On a tablet (or any touch screen) the menu stays tucked away behind the{' '}
        <strong>menu button</strong> in a narrow strip down the left edge, so every page
        gets the full width of the screen. Tap it to slide the menu open, and tap outside
        the menu to close it again.
      </P>
    </section>
  )
}
