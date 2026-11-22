// src/pages/help/settings.jsx
// The Help page's "Settings" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'settings'
export const label = 'Settings'
export const order = 260

// ── SETTINGS ────────────────────────────────────
export function Section() {
  return (
    <section id="settings" data-help="">
      <H2>Settings</H2>
      <P>
        Go to <strong>Settings</strong> in the sidebar to customise the look and default behaviour
        of the admin portal. All changes apply immediately and are saved to your browser — they
        persist across sessions without needing to log out or refresh.
      </P>
      <P>
        <strong>Notices</strong>, at the top, are your own push notices for tasks due soon and late (see
        Mobile App, Notices for tasks due and late). Unlike the rest of this page they are kept on the
        server, with their own Save.
      </P>

      <H3>Theme colour</H3>
      <P>
        Choose a brand colour from the preset swatches or enter a hex value in the text box.
        The entire portal updates instantly — buttons, active nav items, and primary actions all
        use the chosen colour. Your choice is remembered even after closing the browser.
      </P>
      <InfoBox type="info">
        Settings are stored locally in your browser — they are not synced across devices or users.
        Each staff member can have their own colour preference.
      </InfoBox>

      <H3>Page colours and card headers</H3>
      <P>
        Every page uses the same look as the Rota dashboard: a light grey background with
        white cards on it, and each card has a coloured header band. The band colour is
        your brand's accent colour (Brand &amp; theme → Colours → Accent), so it matches
        your brand on every page and dashboard. Changing
        the accent there changes the header bands for everyone in your business. The
        Theme colour above only changes buttons and highlights.
      </P>

      <H3>Booking status colours</H3>
      <P>
        Each of the nine booking statuses has its own tile colour on the Timeline. You can
        customise any status colour from the <strong>Booking status colours</strong> section:
      </P>
      <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside ml-2 mb-4">
        <li>Tap a status tile (e.g. <em>Confirmed</em>) to expand its editor.</li>
        <li>Choose from the 12 preset pastel swatches, or use the colour picker / hex input for a custom colour.</li>
        <li>Tap <strong>Done</strong> to apply. A border colour is automatically derived from the background you set.</li>
        <li>Use <strong>Reset all</strong> to return every status to the default palette in one tap.</li>
      </ol>
      <InfoBox type="info">
        Status colour changes apply to the Timeline tiles and the status colour reference swatches
        in this Help guide immediately. The booking status labels and their meanings do not change —
        only the visual colour.
      </InfoBox>

      <H3>Timeline background colour</H3>
      <P>
        Change the background colour of the empty canvas area on the Timeline. Six preset swatches
        range from pure white to soft pastels. You can also use the colour picker or type a hex
        value for a precise match. The change applies in real time on the Timeline.
      </P>

      <H3>Closed / unavailable areas colour</H3>
      <P>
        The grey shading that marks closed hours and blocked slots on the Timeline can be
        recoloured here. Six grey and neutral tones are provided, plus a custom picker. The
        shade is always applied at 38% opacity so it stays subtle over any background.
      </P>

      <H3>Opening hour line</H3>
      <P>
        A thick vertical line that runs the full height of the Timeline, marking the point where the
        first sitting of the day opens. Use the toggle to show or hide it, and the colour picker to
        match your brand or make it more visible against your chosen background. Six preset colour
        swatches are available when the line is enabled. The line is on by default.
      </P>

      <H3>Shade closed areas in header row</H3>
      <P>
        When this toggle is on, the same grey shading and diagonal stripes that appear in the table
        rows for closed and last-orders periods are also drawn in the hours header row at the top of
        the Timeline. Off by default — turn it on if you find the header row hard to read against the
        rest of the canvas.
      </P>

      <H3>Interface</H3>
      <P>
        The <strong>Sidebar expanded by default</strong> toggle controls whether the left navigation
        sidebar starts open (showing labels) or collapsed (showing icons only) when the app loads.
        Turn it off at the host stand if you want maximum screen space from the moment you open the app.
        You can always expand the sidebar manually at any time using the toggle at the top of the sidebar.
      </P>

      <H3>Timeline defaults</H3>
      <P>
        These settings control how the Timeline opens each time. You can also change all of them
        live from the sidebar while on the Timeline — the Settings page just saves the starting state.
      </P>
      <DataTable
        head={['Setting', 'Description']}
        rows={[
          ['Default tile mode', 'Compact (default) — dense, one-line tiles. Detailed — three-line tiles showing name, phone, and table allocation.'],
          ['Compact tile size', 'When in Compact mode, choose S (smallest), M (medium), or L (largest) row and font size.'],
          ['Wide time columns', 'Increases each hour column from 80 px to 120 px wide — useful on large screens or when bookings are closely spaced.'],
          ['Side panel mode', 'When on, the booking drawer opens as a docked right panel. When off, it opens as a floating overlay.'],
          ['Section dividers', 'Show or hide the section label rows (Main Floor, Terrace, etc.) between table groups.'],
          ['Hide inactive', 'Hide cancelled, no-show, and checked-out bookings from the Timeline canvas by default.'],
          ['Timeline hours', 'Set the first and last hour shown on the timeline canvas. Default 09:00–24:00. Narrow it to hide unused hours and make the canvas more compact.'],
        ]}
      />
      <InfoBox type="tip">
        On a large monitor, try Detailed tile mode with Wide time columns for a clear, at-a-glance
        service view. On a tablet at the host stand, Compact S keeps the maximum number of tables
        visible without scrolling.
      </InfoBox>
    </section>
  )
}
