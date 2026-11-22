// src/pages/help/installer.jsx
// The Help page's "Installer app" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'installer'
export const label = 'Installer app'
export const order = 420

// ── INSTALLER APP ─────────────────────────────────
export function Section() {
  return (
    <section id="installer" data-help="">
      <H2>Installer app</H2>
      <P>
        The installer is a phone app for setting up a venue&apos;s devices while you stand next to them:
        tills, kitchen screens, self-order kiosks and menu screens. Open{' '}
        <strong>installer.macaroonie.com</strong> on your phone and sign in as usual. In Chrome choose{' '}
        <strong>Install app</strong> (on an iPhone, Share then <strong>Add to Home Screen</strong>) so it
        opens like an app. It shows what you can see in Store tech (tills, kitchen screens, kiosks) and
        Menu screens; linking and changing devices needs Manage on them.
      </P>

      <H3>Linking a device</H3>
      <ol className="list-decimal ml-5 space-y-2 text-sm text-muted-foreground mb-4">
        <li>On the device, open its address in Chrome: <strong>pos.macaroonie.com</strong> for a till, <strong>kitchen.macaroonie.com</strong> for a kitchen screen, <strong>kiosk.macaroonie.com</strong> for a kiosk, <strong>screens.macaroonie.com</strong> for a menu screen. It shows a six-letter code and a QR code.</li>
        <li>Scan the QR code with your phone&apos;s camera. It opens the installer on that code. (In the installer, <strong>Link a device showing a code</strong> lets you type the code instead, or scan it with <strong>Scan the QR code</strong> where the phone offers it.)</li>
        <li>Check the venue at the top (<strong>Change</strong> picks another). For a new device, give it a name and, for a kitchen screen, tick the stations it shows; for a menu screen, pick the board or playlist. To put the code on one already set up (it keeps its name and settings), choose <strong>One already here</strong> and pick it: one that isn&apos;t linked is picked for you, and removed ones are at the bottom of the list.</li>
        <li>Tap <strong>Link</strong>. The device sets itself up within a few seconds.</li>
      </ol>
      <P>
        The code is for the kind of device it was shown on: a code from the kitchen screen address can only
        become a kitchen screen. Codes change every 15 minutes until they&apos;re used, and work once.
      </P>

      <H3>Adding a new device</H3>
      <P>
        <strong>Add a new device</strong> asks what it is, then shows its address (with a QR code a device
        with a camera can scan to open it). Open it on the device and link the code it shows. That is the
        only way a device is set up, here and in Store tech: devices never take a code typed into them.
      </P>

      <H3>A device&apos;s page</H3>
      <P>
        The home page lists every till, kitchen screen, kiosk and menu screen at the venue with its state:{' '}
        <strong>Online</strong>, <strong>Offline</strong> or <strong>Not linked</strong>. Tap one to change its name and settings (then Save), to show a menu
        screen&apos;s name on it (<strong>Show its name on the screen</strong>) or reload it, to move it
        to a new device, or to remove it.
      </P>
      <P>
        <strong>Move it to a new device</strong> is for a broken or replaced tablet or TV: link the new
        device&apos;s code and it takes this device&apos;s name and settings;
        the old one stops working.
      </P>
      <InfoBox type="info">
        The installer only links and sets up devices. Everything else (stations and the kitchen flow, kiosk
        designs, boards and playlists, printers) is set up on their own pages in Store tech.
      </InfoBox>
    </section>
  )
}
