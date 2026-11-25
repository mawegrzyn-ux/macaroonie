// src/pages/help/shared-devices.jsx
// The Help page's "Shared devices and PINs" section (Pepper-first step 6a,
// migration 280). Help.jsx gathers every file in this folder (except
// parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'shared-devices'
export const label = 'Shared devices and PINs'
export const order = 265

export function Section() {
  return (
    <section id="shared-devices" data-help="">
      <H2>Shared devices and PINs</H2>
      <P>
        A tablet in the kitchen or a phone at the pass is often used by several people while one person is
        signed in on it. Mark it as <strong>shared</strong> and every change on it is made as the person who
        typed their PIN, not as whoever signed in: the food safety log says who took the reading, the task
        history says who snoozed the task, and Pepper&apos;s Done list says who confirmed the card.
      </P>
      <H3>Marking a device as shared</H3>
      <P>
        On the device itself, open <strong>Settings</strong> (on the phone pages: <strong>This device</strong>
        in the three-dot menu), and under <strong>Shared device</strong> pick the venue, give the device a name
        (Kitchen tablet) and tap <strong>Mark this device as shared</strong>. Owners and admins can do this
        (Settings, Manage). The same card lists the group&apos;s shared devices and who is on each, with{' '}
        <strong>Stop</strong>. It works in a browser and in the Macaroonie Office app.
      </P>
      <H3>Stopping a device being shared</H3>
      <P>
        <strong>Stop sharing this device</strong> (on the device) or <strong>Stop</strong> (on another device&apos;s
        row) is for owners and admins (Settings, Manage) and for the person who shared it. On the shared device
        itself: if you have an office PIN, it asks <strong>Who is this?</strong> first, so nobody else at the
        device can stop it as you. If you have none (your own phone, say), it stops and the device signs out
        straight after: anyone could have tapped Stop, so getting back in takes your own sign-in. Set an office
        PIN on another device first if you want to stop it without signing out. To stop a different device
        from a shared one, someone allowed to stop it says who they are with their office PIN first.
      </P>
      <H3>Who is this?</H3>
      <P>
        On a shared device, reading is open to anyone. Before any change (a Save, a Pepper card&apos;s Confirm,
        a task&apos;s snooze or skip) the device asks <strong>Who is this?</strong>: tap your name and type
        your PIN on the pad. The change then goes through as you. In the office the pill at the bottom right
        shows your name; on the phone pages it is in the three-dot menu, with <strong>Switch person</strong>.{' '}
        <strong>Lock</strong> is always one tap, and the device locks itself after 2 minutes without a tap.
      </P>
      <DataTable
        head={['PIN', 'What it is', 'What it lets you do on a shared device']}
        rows={[
          ['Till PIN', 'The PIN you sign in to the till with (set in Till setup)', 'Log checks only: fridge, hold, cooking and delivery checks, checklist ticks, corrective actions, and Pepper\'s cards for those'],
          ['Office PIN', 'Your own PIN, set by you in Settings → Your office PIN (or This device on the phone)', 'Anything your own role may do, and never more than the account signed in on the device'],
        ]}
      />
      <P>
        A change a till PIN can&apos;t make asks again for an office PIN. Pay, tips, allergen data and anything
        deleted still ask for their typed word or a named person on top, the same as anywhere else.
      </P>
      <H3>Your office PIN</H3>
      <P>
        Set it on your own phone or computer, not on a shared device: <strong>Settings → Your office PIN</strong>,
        4 to 6 digits, typed twice. Easy ones (1234, 1111) are refused. It is kept only as a scramble nobody
        can read back. <strong>Remove my PIN</strong> takes it away; a new PIN ends any switch made with the old one.
      </P>
      <InfoBox type="warn">
        Five wrong PINs for one person lock that person on that device for 5 minutes (the device doesn&apos;t
        say whether the name or the PIN was wrong). A device that gets too many wrong PINs for anyone waits
        5 minutes too.
      </InfoBox>
    </section>
  )
}
