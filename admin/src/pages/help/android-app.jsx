// src/pages/help/android-app.jsx
// The Help page's "Macaroonie Player (Android)" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'android-app'
export const label = 'Macaroonie Player (Android)'
export const order = 430

export function Section() {
  return (
    <section id="android-app" data-help="">
      <H2>Macaroonie Player (Android app)</H2>
      <P>
        <strong>Macaroonie Player</strong>, the Android app (called Macaroonie until November 2026), runs a till, a kitchen screen, a self-order kiosk or a
        menu screen on an Android tablet, TV box or smart TV. It opens the same apps as Chrome does at pos.,
        kitchen., kiosk. and screens.macaroonie.com, but straight away and full screen: no address bar, no Android bars at the top or bottom, the screen
        stays on and the back button does nothing, so staff and guests can&apos;t leave it by accident. The
        apps inside it update themselves like the web pages do; the app itself rarely needs updating.
      </P>

      <H3>Getting the app on a tablet</H3>
      <P>
        On the tablet, open Chrome at pos.macaroonie.com, kitchen.macaroonie.com or kiosk.macaroonie.com
        (any of the three). The setup screen has a <strong>Get Macaroonie Player</strong> button: tap it, and
        when the file has downloaded open it and tap <strong>Install</strong>. Android may ask you to allow
        installing apps from Chrome first. You can also type the address with /android on the end (for
        example kiosk.macaroonie.com/android) to download it straight away. On a computer the setup screen
        shows that address as a link (it downloads the file there too): type it on the Android device. The
        button only shows once Macaroonie has added
        the app, and never inside the app itself.
      </P>

      <H3>Setting up a tablet with the app</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>Install the app on the tablet (above).</li>
        <li>Open it and pick what the tablet is: <strong>Till</strong>, <strong>Kitchen screen</strong>, <strong>Self-order kiosk</strong> or <strong>Menu screen</strong>.</li>
        <li>It shows a six-letter code and a QR code. Link it as any other device: scan the QR code with your phone (the installer app), or type the code in Store tech (<strong>Add a till</strong>, <strong>Add a screen</strong>, <strong>Add a kiosk</strong>) or, for a menu screen, on the Menu screens page (<strong>Add screen</strong>).</li>
        <li>From then on the tablet opens that app every time it starts.</li>
      </ol>

      <H3>Keeping tablets up to date</H3>
      <P>
        Each till, kitchen screen and kiosk keeps its menu, prices and settings on the tablet, so it opens
        with them straight away, with the internet down too. A kiosk also keeps every picture on its menu
        and its design&apos;s videos. Changes reach the tablets in two ways:
      </P>
      <ul className="list-disc ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li><strong>Straight away</strong>: the tablet is told as soon as you save something it shows (a menu published, a dish sold out, a setting in Store tech).</li>
        <li><strong>By checking</strong>, in case it missed being told: as standard, tills and kiosks check prices and sold out dishes every 30 seconds, every tablet checks its whole menu and settings every 3 minutes, and menu screens check their boards every minute. How often is yours to choose per location: Store tech, <strong>Device updates</strong> (see <a href="#device-updates" className="underline">Device updates</a>). A dish sold out changes on the tablet straight away; new prices (a menu published, a publish you scheduled going live, an option or a promotion changed) download the menu again.</li>
      </ul>
      <P>
        A till&apos;s settings show when it last checked (<strong>Prices and sold out checked</strong>,{' '}
        <strong>Whole menu checked</strong>) and how often it checks; on a kiosk, the staff panel&apos;s{' '}
        <strong>Last checked</strong> and <strong>Checks for changes</strong>; on a menu screen, its settings
        panel.
      </P>

      <H3>Changing what a tablet is</H3>
      <P>
        Tap the <strong>top left corner</strong> of the screen five times quickly (within three seconds).
        The app shows <strong>What is this device?</strong> over the till, kitchen screen or kiosk, which
        keeps running underneath. Pick another type, or press <strong>Back to the till</strong> (nothing
        reloads) or <strong>Reload the till</strong> when it seems stuck. Opened this way it goes back by
        itself after a minute nobody touches it, so a kiosk is never left on it. The taps also reach
        whatever sits in that corner (the venue name, the first tab), which does no harm.
      </P>
      <P>
        Each type keeps its own link to the restaurant. A kiosk switched to a till and back is still the
        same kiosk, still linked; while the tablet shows another type, Store tech shows the kiosk as
        offline. To stop a tablet being a kiosk for good, Disconnect it in its staff panel (or remove it
        in Store tech). A tablet that isn&apos;t linked yet also has <strong>Change device type</strong> on
        its setup screen, and if the app can&apos;t reach Macaroonie it says so, tries again every five
        seconds and offers <strong>Change device type</strong> too.
      </P>
      <InfoBox type="info">
        The corner works from version 1.1 of the app (shown under the choices on What is this device?).
        A tablet with version 1.0 needs the new download installed over it first. Menu screens need
        version 1.2.
      </InfoBox>

      <H3>Menu screens on a TV box or smart TV</H3>
      <P>
        Pick <strong>Menu screen</strong> to show menu boards and order ready boards (the boards and
        playlists you made in Store tech). From version 1.2 the app shows on an Android TV&apos;s
        home screen too, so a TV box or a smart TV running Android TV can install it from the download
        like a tablet (sideloading: allow installing from the browser or file manager you use). With a
        remote, the arrows move between the choices on <strong>What is this device?</strong> and OK picks.
      </P>
      <P>
        A screen with no touch can&apos;t use the top left corner: press <strong>OK five times</strong> on
        the remote to open the screen&apos;s own settings, then <strong>Change device type</strong> (shown
        only inside the app). A screen not linked yet has <strong>Change device type</strong> under its
        code. Like in Chrome, a linked menu screen keeps its boards, pictures and videos and keeps showing
        them with the internet down.
      </P>

      <H3>Printing and the camera</H3>
      <P>
        Bills and receipts printed from the tablet go to Android&apos;s print service, which shows its print
        window: install your printer&apos;s Android print plugin (Epson, Star and others make one) to print
        to it. Ticket printers on the network or plugged into a mini PC are better on the venue hub (Store
        tech, Printers), which prints without asking. The first time the app scans a QR code (a loyalty
        card) Android asks to allow the camera.
      </P>
      <InfoBox type="info">
        To keep guests in the kiosk app, turn on Android&apos;s <strong>App pinning</strong> (Settings,
        Security) and pin the app, or use your device manager&apos;s kiosk mode.
      </InfoBox>

      <H3>Adding a new build of the app (platform admins)</H3>
      <P>
        The <strong>Platform</strong> page&apos;s <strong>Macaroonie Player</strong> tab decides what the setup
        screens offer. After a build on expo.dev, open the Android internal distribution build, copy its
        Install or Download link (or the build page&apos;s own address) and paste it in, then press
        <strong> Copy and offer it</strong>. Macaroonie keeps its own copy of the app, so the download keeps
        working after Expo&apos;s link runs out. It must be an APK build: an app bundle for Google Play
        can&apos;t be installed this way and is refused. <strong>Stop offering it</strong> removes the copy
        and the button (tablets that have the app keep it). Tablets already running the app don&apos;t
        update by themselves: install the new download over the old one.
      </P>
    </section>
  )
}
