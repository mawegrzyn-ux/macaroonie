// src/pages/help/screens.jsx
// The Help page's "Menu Screens" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'screens'
export const label = 'Menu Screens'
export const order = 330

// ── MENU SCREENS ────────────────────────────────
export function Section() {
  return (
    <section id="screens" data-help="">
      <H2>Menu Screens</H2>
      <P>
        Show your menus on screens in the restaurant (digital menu boards). There are four pages,
        each with its own entry under Store tech in the menu: <strong>Menu screens</strong> (the
        screens themselves), <strong>Screen board designer</strong> (the boards they show),{' '}
        <strong>Screen playlists</strong> (boards that take turns) and <strong>Screen walls</strong>{' '}
        (several screens showing one picture). A row of buttons at the top of each goes to the other
        three. Every screen shows a board, or a playlist of boards. Prices come from your <strong>published</strong>{' '}
        menus, so a price change appears on every screen when you publish the menu (now or at the
        time you scheduled). Dishes marked sold out (on the till or the Online orders board) show
        as sold out within seconds.
      </P>

      <H3>What you need</H3>
      <P>
        Any screen that can run Chrome: an Android TV box or stick, a smart TV with Chrome, an
        Android tablet, or a PC. Fully Kiosk Browser (Android) works too. The screen needs the
        internet to get started and for changes; if the internet drops, it keeps showing its
        boards, photos, videos and fonts, and catches up as soon as it is back online.
      </P>

      <H3>Adding a screen</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>On the screen, open the screens address shown on <strong>Menu screens → Add a screen</strong> (screens.your-domain) in Chrome.</li>
        <li>In Chrome&apos;s menu choose <strong>Install app</strong> (or <strong>Add to Home screen</strong>): it then opens full screen with no address bar. In Fully Kiosk, set the address as the Start URL.</li>
        <li>The screen shows a six-letter code and a QR code (both change every 15 minutes until they&apos;re used).</li>
        <li>In the admin press <strong>Add screen</strong>, type the code, give the screen a name (e.g. Counter left), pick the location and what it shows. Or scan the QR code with your phone: it opens the installer app (see Installer app) to do the same there. The screen shows it within a few seconds.</li>
      </ol>
      <P>
        Each screen gets an ID (S1, S2 ...). <strong>Identify</strong> shows the name and ID on the
        screen for 20 seconds, so you can tell which is which. <strong>Edit</strong> changes what it
        shows, its size, and <strong>Mounted</strong>: turn the picture for a screen hung on its side
        (for TVs that can&apos;t turn it themselves). <strong>New device for this screen</strong>{' '}
        moves the screen to a new box or TV by its code; the old one stops. Removing a screen sends
        it back to showing a code.
      </P>
      <P>
        On the screen itself, five quick taps (or five presses of OK on a TV remote) open its own
        settings: its name and ID, the venue, what it is showing, whether it is online, Reload, and{' '}
        <strong>Disconnect this screen</strong> (asked twice). A disconnected screen shows a new code and
        is listed here as not paired, with its name and boards kept: <strong>New device for this
        screen</strong> pairs it again.
      </P>
      <P>
        The list shows which screens are online (a green dot), what each is showing now, and
        when an offline screen was last seen.
      </P>
      <P>
        A screen that ever starts with nothing on it (black, no code and no board: a part of the screen
        program couldn&apos;t be loaded) tries again by itself every minute until it starts. While it is
        like that it doesn&apos;t answer Reload from this page and shows as offline here; turning the
        screen off and on, or reloading it on the device, starts it at once.
      </P>
      <P>
        <strong>With several locations</strong>: boards and playlists are shared by every location
        (one design for all; each screen shows its own location&apos;s sold out dishes and order
        ready board), while screens and walls belong to a location. The <strong>Location</strong>{' '}
        picker at the top of the Menu screens and Screen walls pages shows one location&apos;s screens and walls, or
        every location&apos;s; it is remembered on this device, and a new screen or wall starts at the
        location picked.
      </P>

      <H3>Designing a board</H3>
      <P>
        <strong>Screen board designer → New board</strong>: give it a name and the screen&apos;s size (Full HD
        landscape or portrait, 4K, HD, or your own). The designer opens. Add blocks from the left
        (tap +, or drag onto the board), drag them to move (press anywhere on a block, photos
        included), drag the corner to resize; they snap to a grid (hold Alt to place freely,
        arrow keys nudge). On a tablet, tap a block first, then drag it. The panel on the right
        has the selected block&apos;s options; with nothing selected it has the board&apos;s
        background, colours, fonts and price style. Save when you&apos;re done.
      </P>
      <P>
        <strong>Grid</strong>: the grid button at the top (next to the zoom buttons) shows lines
        over the board where blocks snap, with every fifth line darker. Zoomed out, the lines
        are drawn every few snap steps so they don&apos;t run together. The snap step is in the
        board panel under Snap. Your choice is remembered on this device.
      </P>
      <P>
        <strong>Colours</strong>: every colour shows your brand&apos;s colours first
        (the Brand &amp; theme page): tap one to use it. To use any other colour, tap the
        square below them for your device&apos;s colour picker, or type a code like
        #f5b301. A ticked swatch means that theme colour is in use; a ring round the square
        means a custom colour.
      </P>
      <P>
        <strong>Theme maker</strong> (board panel): the background, colours and fonts from a
        picture and a few words. A light theme gives the board a deep background with light words,
        which reads best from across the room. See Website Builder → Make a theme from a picture.
      </P>
      <P>
        <strong>Photos and videos from your computer</strong>: drag them straight onto the board.
        Dropped on a picture (or video) block, they replace its picture; dropped anywhere else,
        they become a new block there, the photo&apos;s own shape. They go into Media too, and the
        same file dropped twice is only kept once.
      </P>
      <DataTable
        head={['Block', 'What it shows']}
        rows={[
          ['Menu list', 'A section of a menu (or dishes you pick), with prices, descriptions, options (Small £3 · Large £4), allergen tags and calories. 1 to 4 columns, sizes and colours, dotted line to the price. Menu sections in the left column add one in a tap.'],
          ['Featured dish', 'One dish, large, with its photo from the menu, description and price.'],
          ['Price', 'Just a dish\'s price (or one option\'s), to put on a photo or a designed background, so the price still updates.'],
          ['Heading / Text', 'Your own words, any font and size.'],
          ['Image', 'A photo, logo or picture from Media.'],
          ['Video', 'A video from Media (MP4 or WebM, up to 150 MB), playing on a loop, sound off unless you tick With sound. Each screen keeps a copy, so it plays without the internet. Use MP4 (H.264): it plays on every screen.'],
          ['Scrolling text', 'A line of text moving across the board, like a news ticker. Set its speed, gap and direction.'],
          ['Box or line', 'A coloured panel behind other blocks, or a line (make it thin).'],
          ['Clock', 'The venue\'s time, with the date if you like.'],
          ['Allergen key', 'What the tags on this board\'s dishes mean, from your allergen notice.'],
          ['Store status', 'The venue\'s tills, kitchen screens, kiosks, printers, card machines, menu screens and venue hub as a honeycomb, the same as Store tech → Tech board: each a hexagon coloured and marked by whether it is working, with what needs attention and a key under it. For staff screens only (see below).'],
        ]}
      />
      <H3>The Store status block: the kit on a back office screen</H3>
      <P>
        The <strong>Store status</strong> block shows the venue&apos;s kit as the Tech board&apos;s honeycomb, on
        a menu screen: one hexagon per till, kitchen screen, kiosk, printer, card machine, menu screen and
        the venue hub, grouped by kind, green when working, amber when it needs a look, red when down, grey
        when not linked, each with its mark (a tick, an exclamation mark, a cross, a dash) and the ring of its
        kind. The big hexagon first is the venue overall. Under it, <strong>Needs attention</strong> lists
        what is down or needs a look, worst first, with when it was last seen, and the key says what the
        rings and fills mean. The screen shows its own venue&apos;s kit and checks about every 45 seconds; the
        designer shows example kit.
      </P>
      <P>
        In the block&apos;s panel: <strong>Which kit</strong> (tap kinds to show only those; none picked shows
        all of it), names on the hexagons, the venue&apos;s health first, what needs attention, the key,{' '}
        <strong>Large</strong> or <strong>Compact</strong> hexagons (they always fit the block), the size of
        the words under it and the colour of the group names. The words take the board&apos;s fonts and text
        colour; on a dark board the block takes the dark look.
      </P>
      <InfoBox type="warn">
        The Store status block names the venue&apos;s kit (Drive thru till, Kitchen printer), so put it only on
        boards for staff screens: the back office, the kitchen, the manager&apos;s office. Don&apos;t put it on a
        board guests can see. A screen only gets the kit when one of its boards has the block, and it gets
        names and states only (no addresses or serial numbers).
      </InfoBox>
      <P>
        The designer shows the live prices. <strong>Draft prices</strong> shows the menus as saved
        but not yet published, and <strong>Sold out at</strong> shows a venue&apos;s sold out
        dishes, so you can check how the board will look. A menu that has never been published
        shows nothing on a board until you publish it. Sections set to <strong>Hide
        everywhere</strong> never show.
      </P>
      <P>
        Sold out dishes are crossed out with <strong>Sold out</strong> (wording in the board
        settings), or left out if you pick <strong>Leave out</strong> on the block.
      </P>
      <P>
        <strong>Combos on a board.</strong> A Menu list or Featured dish block has{' '}
        <strong>Combos</strong>: <strong>Like the menu</strong> shows a combo as its name,
        description and price (&ldquo;from £11.00&rdquo; when choices can cost more);{' '}
        <strong>How to order (steps)</strong> also shows its steps numbered 1, 2, 3, each with
        its rule (Choose 1, Optional, up to 2), its choices and their extra charges, and
        &ldquo;With Fries&rdquo; on a step that only shows with an earlier pick, like a
        how-to-order poster.
      </P>

      <H3>Animation</H3>
      <P>
        Any block can <strong>come on</strong> with a movement (fade, rise up, drop down, from the
        left or right, zoom, pop, wipe), taking the time you set and starting after a delay, so
        blocks can arrive one after another. A block can also keep moving <strong>while on</strong>{' '}
        (pulse, float, swing, slow zoom, blink). Press <strong>Play</strong> at the top of the
        designer to watch the board as the screens will show it (videos play and scrolling text
        moves too); press Stop to place blocks where they end up. In the board settings,{' '}
        <strong>Play the animations again every</strong> replays the entrances, for a board that
        stays on for a long time.
      </P>

      <H3>Playlists and times of day</H3>
      <P>
        <strong>Screen playlists</strong>: a playlist is a list of boards that take turns, each for the seconds you
        set (drag to reorder). <strong>Set times and dates</strong> on a board to show it only
        then, for example a breakfast board 07:00 to 11:00 and a lunch board 11:00 to 15:00. A time
        ends just before its end time, so the lunch board takes over at exactly 11:00. Boards with
        no times show all the time. When nothing is on, the screen goes black. Times are the
        venue&apos;s time. Save the playlist, then pick it for a screen.
      </P>
      <P>
        Each board <strong>comes on with</strong> a transition (cut, fade, slide in from either
        side, slide up or down, zoom, wipe) at the speed you pick. A board with a video offers{' '}
        <strong>Video length</strong> to show it for exactly as long as its video. The{' '}
        <strong>Preview</strong> under the list plays the boards with their transitions (up to 5
        seconds each, so you can check quickly). Screens with the same playlist change boards at
        the same moment.
      </P>

      <H3>Walls: several screens, one picture</H3>
      <P>
        Screens side by side (or stacked) can show one board between them: one picture across all
        of them, changing boards, playing videos and scrolling text together.
      </P>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Add each screen as usual (the Menu screens page).</li>
        <li><strong>Screen walls → New wall</strong>: name it and pick how many screens across and down.</li>
        <li>Under <strong>Which screen goes where</strong>, pick each screen as you look at the wall (left, right, top left ...).</li>
        <li><strong>Gap between screens</strong>: how much of the picture hides behind the frames where two screens meet, so lines and text stay straight across (0 for frameless screens).</li>
        <li>Press <strong>Make a board this size</strong> (the wall&apos;s size: two Full HD screens side by side make 3840 x 1080, plus the gap), then <strong>Design</strong> it. The designer shows dashed lines where the screens meet, so nothing important sits on a join.</li>
        <li>Pick the board (or a playlist of wall-sized boards) under <strong>Shows</strong> and save the wall. The preview shows which part each screen gets.</li>
      </ol>
      <P>
        A screen on a wall shows the wall&apos;s board instead of its own; take it off the wall
        (pick No screen) to give it its own board again. The screens keep in step on their own
        (each sets its clock from Macaroonie), so they don&apos;t need to see each other.
      </P>


      <H3>Sold out from the till</H3>
      <P>
        On the till, <strong>hold a dish down</strong> (or tap one that&apos;s sold out) and choose{' '}
        <strong>Sold out for today</strong> (back on at midnight), <strong>Sold out until I put it
        back</strong>, or <strong>Back on sale</strong>. It changes the till, online ordering, the
        Online orders board and the screens at once. Till roles need <strong>Mark dishes sold
        out</strong> (Supervisor and Manager have it), or a manager types their PIN. It needs the
        till to be online. Tills and kiosks also check what is sold out every 30 seconds (or as set in Store tech, Device updates), so one
        that missed the change catches up within half a minute.
      </P>
      <InfoBox type="tip">
        Changing a board or playlist reaches the screens within seconds. If a screen seems stuck,
        <strong> Reload</strong> it from the list, or check it&apos;s online.
      </InfoBox>
    </section>
  )
}
