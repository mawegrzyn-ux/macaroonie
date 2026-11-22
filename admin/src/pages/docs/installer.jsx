// src/pages/docs/installer.jsx
// The Docs page's "Installer app & link codes" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'installer'
export const label = 'Installer app & link codes'
export const order = 300

export function Section() {
  return (
    <section id="installer" data-doc="">
      <H2>Installer app &amp; link codes</H2>
      <P>
        Migration 184. A till, kitchen screen, kiosk or menu screen that isn't set up shows a code of its
        own and a QR code; someone signed in links it from a phone (the installer app,{' '}
        <Mono>installer.&lt;domain&gt;</Mono>) or from the admin (Store tech's Add windows, Screens). That
        is the only way a device is set up: since 19 Oct 2026 Store tech and the installer no longer make
        codes to type into a device (<Mono>POST /api/pos/venues/:id/devices</Mono> and{' '}
        <Mono>POST /api/pos/devices/:id/pairing-code</Mono> are gone).
      </P>
      <H3>Link codes</H3>
      <DataTable
        head={['Piece', 'What it does']}
        rows={[
          ['pos_pairings', 'A code a till / kitchen screen / kiosk shows: code_hash (sha256 of the normalised code, unique), secret_hash, app (the address it was shown on: terminal | kds | kiosk, null on a test address), device_info, expires_at (15 minutes), claimed_at, device_id, tenant_id. No tenant until linked; forced RLS lets anyone see unclaimed rows (like screen_pairings).'],
          ['services/linkCodes.js', 'LINK_MINUTES, newLinkCode() (the screen alphabet, ABC-DEF), linkCodeHash(), linkUrl(code) = installerOrigin() + /link/<code>, linkCodeTaken() (a code is never live in both tables, so a typed code finds one device), findLinkCode() (screen first, then device).'],
          ['POST /pos-api/pairings', 'No auth, 30/min per address. { app?, device? } -> { id, code, secret, expires_at, link_url }. The secret stays on the device; only its hash is kept.'],
          ['GET /pos-api/pairings/:id', 'Authorization: Pairing <secret>, 240/min per address (a venue\'s devices share one). waiting | expired | paired (with device_id, name, kind, short_code, venue). Paired only while the device row still holds this code\'s secret_hash and isn\'t removed.'],
          ['POST /api/pos/venues/:id/link', 'Store tech manage. { code, device_id? | name, kind?, settings? }. Locks the code row, refuses run-out and used codes, a kind other than the code\'s app (422), another venue\'s or tenant\'s device (404). New device: 201 with a short code; device_id: 200, the existing row takes the code\'s secret_hash (the old device stops, forgetDevice() + the 30 s device cache), keeps name and settings. A removed device (revoked_at) is brought back: revoked_at cleared, its settings through cleanDeviceSettings() (ids of streams, printers, floor areas, stations, kiosk designs or card machines that no longer exist dropped instead of refused, since nobody could edit a removed device first). Marks the code claimed with the tenant.'],
          ['POST /screen-api/pairings', 'Menu screens, as before, now also returns link_url and skips codes live in pos_pairings. Linked by POST /api/screens/screens/claim.'],
        ]}
      />
      <H3>The devices</H3>
      <P>
        Till app <Mono>pos/src/screens/Pair.jsx</Mono>: <Mono>useLinkCode()</Mono> asks for a code on
        mount (<Mono>requestLinkCode()</Mono> in <Mono>pos/src/lib/store.js</Mono>, with the screen size and
        the address's kind), shows it with a QR code (<Mono>qrSvg()</Mono> from{' '}
        <Mono>shared/qr.js</Mono>) and checks it every 4 s (<Mono>checkLinkCode()</Mono>, which saves the
        device through <Mono>startPaired()</Mono>, the same as <Mono>pair()</Mono>); a run-out code is
        replaced. There is no typed-code form; a device moved from another address brings a hand-over code
        in <Mono>#pair=</Mono> and pairs with it by itself (<Mono>pair-moving</Mono>, or{' '}
        <Mono>pair-error</Mono> above the shown code if it fails). The menu screen player
        (<Mono>screen/player.js</Mono> <Mono>showCode()</Mono>) draws the QR code beside its code;{' '}
        <Mono>qr.js</Mono> is in <Mono>PLAYER_LIBS</Mono> and the player's <Mono>SHELL_FILES</Mono>.
      </P>
      <P>
        <Mono>shared/qr.js</Mono>: a dependency-free QR encoder (Model 2, byte mode, versions 1-10, levels L
        / M / Q / H, Reed-Solomon over GF(256), all 8 masks with the standard's penalty).{' '}
        <Mono>qrMatrix(text, {'{ ecc }'})</Mono> and <Mono>qrSvg(text, {'{ margin, dark, light, title }'})</Mono>.
        Tests: <Mono>shared/test/qr.test.mjs</Mono> (capacities, patterns, format bits, a known code);
        checked against a QR reader when written.
      </P>
      <H3>The installer app</H3>
      <P>
        The admin build on <Mono>installer.&lt;domain&gt;</Mono>: <Mono>routes/installerSite.js</Mono>{' '}
        (fastify-plugin onRequest hook, host kind <Mono>installer</Mono> from{' '}
        <Mono>platformHostKind()</Mono>) serves <Mono>admin/dist</Mono> with <Mono>/manifest.webmanifest</Mono>{' '}
        answered by <Mono>installer.webmanifest</Mono> (start <Mono>/install</Mono>), redirects http to https,
        lets <Mono>/api/</Mono>, <Mono>/ws</Mono> and <Mono>/uploads/</Mono> through. The wildcard nginx block
        already sends the host to the API; <Mono>installer</Mono> is in <Mono>RESERVED_SUBDOMAINS</Mono>.
        Auth0 must list the address in Allowed Callback URLs, Logout URLs and Web Origins.
      </P>
      <DataTable
        head={['Route', 'Page', 'Calls']}
        rows={[
          ['/install', 'pages/installer/InstallerHome.jsx: venue (maca_installer_venue), Link / Add, the four lists with state', 'GET /api/installer/venues/:id (pos_setup or screens view; devices with their whole settings, removed_devices (revoked ones, which a code can bring back), stations, kiosk designs, menu screens, boards, playlists, can, addresses), every 10 s'],
          ['/install/link[/:code]', 'pages/installer/InstallerLink.jsx: code box, Scan (components/installer/QrScanner.jsx, BarcodeDetector), what the code is, new or one already here (?replace=&kind=; reusable(): not linked first, then linked, then removed; guessReuse(): the one not linked when there is exactly one is picked), name and settings', 'POST /api/installer/lookup (pos_setup or screens manage), POST /api/pos/venues/:id/link, POST /api/screens/screens/claim'],
          ['/link/:code', 'LinkRedirect in main.jsx: what a device\'s QR code opens', '-'],
          ['/install/add', 'pages/installer/InstallerAdd.jsx: kind, the address (with a QR code), then on to Link', '-'],
          ['/install/device/:kind/:id', 'pages/installer/InstallerDevice.jsx: state, name and settings (Save sends the whole settings), Identify / Reload (menu screens), move to a new device, remove (asks twice)', 'PATCH /api/pos/devices/:id, PATCH /api/screens/screens/:id, identify, reload, DELETE; a new device goes through /install/link?replace='],
        ]}
      />
      <P>
        <Mono>components/installer/InstallerShell.jsx</Mono> (header with back, the restaurant group switch and
        sign out; swaps the apple-touch-icon, theme colour and title while mounted).{' '}
        <Mono>pages/installer/shared.jsx</Mono>: <Mono>KINDS</Mono>, <Mono>useInstallerVenues()</Mono>,{' '}
        <Mono>useOverview()</Mono>, <Mono>deviceState()</Mono>, <Mono>KindSettings</Mono>,{' '}
        <Mono>tidyCode()</Mono> / <Mono>codeFromScan()</Mono>. <Mono>lib/hosts.js</Mono>:{' '}
        <Mono>IS_INSTALLER_HOST</Mono> (the AppShell and /mobile trees go to /install there),{' '}
        <Mono>installerHref()</Mono>. In the admin: <Mono>ShownCodeField</Mono>,{' '}
        <Mono>LinkDeviceModal</Mono> and <Mono>InstallerLine</Mono> in <Mono>components/pos/TillsSection.jsx</Mono>, on the Tills, Kitchen
        screens and Kiosks tabs. Tests: <Mono>api/test/installer.test.mjs</Mono>, the system-paths test and
        the sweep's fixtures link a kitchen screen and a till; every API test adds devices through{' '}
        <Mono>linkDevice()</Mono> in <Mono>api/test/support/devices.mjs</Mono> (show a code, link it).
      </P>
    </section>
  )
}
