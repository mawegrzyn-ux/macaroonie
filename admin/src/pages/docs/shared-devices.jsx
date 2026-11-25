// src/pages/docs/shared-devices.jsx
// The Docs page's "Shared devices and the person switch" section
// (Pepper-first step 6a, migration 280). Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'shared-devices'
export const label = 'Shared devices and the person switch'
export const order = 75

export function Section() {
  return (
    <section id="shared-devices" data-doc="">
      <H2>Shared devices and the person switch</H2>
      <P>
        docs/PEPPER_FIRST.md 13, decisions 6 and 9: on a shared device a PIN person switch comes before any
        change; a till PIN is enough for logging checks and nothing else; any other change needs the
        person&apos;s own office PIN and is limited to what that person&apos;s role may do, never more than the
        signed-in account. The server is the judge: the browser only carries two tokens.
      </P>
      <H3>Tables (migration 280, all with forced RLS)</H3>
      <DataTable
        head={['Table', 'What']}
        rows={[
          ['shared_devices', 'A browser or Office app install marked shared for a venue: name, kind (browser | office_app), the device token\'s sha-256 (never the token), created_by, last_seen_at'],
          ['user_office_pins', 'Each person\'s office PIN: PBKDF2 (shared/pos/pin.js hashPin(), like the till PIN) with a salt of its own; never returned by a route'],
          ['shared_device_people', 'One row per person switch: kind till (cash_staff) | office (users), name, the act token\'s sha-256, started_at, last_used_at, ended_at'],
          ['shared_device_pin_tries', 'Wrong PINs per device and person key (staff:<id> | user:<id>, * for the device): failures, first_failed_at, locked_until'],
          ['shared_device_changes', 'Each change made on a shared device: the person (or none), method, route, status: the share of changes tied to a named person'],
        ]}
      />
      <P>
        <Mono>ai_actions.shared_device_id</Mono> names the device a Pepper card was confirmed on; the row&apos;s{' '}
        <Mono>actor</Mono> is the person&apos;s name and <Mono>user_sub</Mono> their own sub with an office PIN
        (none with a till PIN). Report catalogue: the five tables are left out (tokens and sessions, secrets,
        a log of requests).
      </P>
      <H3>Routes (/api/shared-devices, routes/sharedDevices.js)</H3>
      <DataTable
        head={['Route', 'What']}
        rows={[
          ['GET /', 'The group\'s shared devices and who is on each (Settings View)'],
          ['POST /', '{ venue_id, name, kind }: mark this device shared (Settings Manage); the answer holds the device token (sd_ + 64 hex) once'],
          ['DELETE /:id', 'Stop a device being shared: Settings Manage or the person who shared it (created_by). Judged by stopRefusal(), not the guard (config FREE): an office PIN person switched in answers for themselves; otherwise the account, and on a shared device an account with an office PIN of its own gets person_needed / office_pin_needed first. GET / and GET /this give can_stop'],
          ['GET /this', 'The device the X-Shared-Device header names and the person switched in; 404 code shared_device_unknown (another group\'s token too)'],
          ['GET /people', 'Who can switch in: the venue\'s cash_staff with a till PIN, the group\'s users with an office PIN'],
          ['POST /act', '{ person: staff:<id> | user:<id>, pin }: the switch; an act token (sp_ + 64 hex) for X-Acting-Person. 403 pin_wrong (tries_left), 429 / 403 pin_locked'],
          ['POST /lock', 'Ends the switch (the given act token, or whoever is on the device)'],
          ['POST /still-here', 'The device is in use: keeps the switch going'],
          ['GET | PUT | DELETE /my-pin', 'The signed-in person\'s own office PIN; PUT and DELETE are refused (409) on a shared device; weakPin() refuses easy ones'],
        ]}
      />
      <H3>The check (middleware/sharedDevice.js)</H3>
      <P>
        <Mono>sharedDeviceGuard()</Mono> runs at the end of <Mono>requireAuth</Mono> (and of the tests&apos; auth
        stub), so every route that signs people in runs it, once per request. With no{' '}
        <Mono>X-Shared-Device</Mono> header nothing changes. A GET passes as the account (with the person&apos;s
        limits when an act token is sent). Any other method is a change and needs a live person (403{' '}
        <Mono>person_needed</Mono>); a till PIN passes only where the route says{' '}
        <Mono>config.sharedDevice: CHECK</Mono> (food safety readings POST / PATCH, the checklist instance PUT) or
        its <Mono>config.sharedDevice.till(req)</Mono> says yes (Pepper&apos;s Confirm and Undo on a card whose
        tool is in <Mono>CHECK_TOOLS</Mono>, <Mono>ai/chat.js</Mono>); anywhere else 403{' '}
        <Mono>office_pin_needed</Mono>. <Mono>config.sharedDevice: FREE</Mono> marks a POST that isn&apos;t a
        change (the chat, its files, Cancel, a form card&apos;s saved line, form drafts, the usage record,
        report runs and exports, the switch itself, Lock, still here).
      </P>
      <P>
        <Mono>req.acting</Mono> then holds the person. <Mono>permissionLevel()</Mono> /{' '}
        <Mono>permissionLevels()</Mono> return the lower of the account&apos;s level and an office PIN
        person&apos;s own (platform admins included), and <Mono>requireRole()</Mono> checks both roles.{' '}
        <Mono>whoDid(req, said)</Mono> is the name a change is recorded under (food safety{' '}
        <Mono>recorded_by</Mono>, whatever the body says; the checklist&apos;s <Mono>completed_by</Mono>; an H&amp;S
        action&apos;s <Mono>created_by</Mono> and completion); the task log takes the person&apos;s sub and name.
        Pepper&apos;s contexts carry both headers (<Mono>staffAuthOf()</Mono>, passed on by{' '}
        <Mono>callApi()</Mono>, so the inner route checks them again) and the person (
        <Mono>staffPrincipalOf()</Mono>, read by <Mono>staffReq()</Mono> and <Mono>audit()</Mono>).{' '}
        <Mono>recordSharedChange()</Mono> (onResponse, app.js) keeps each change in{' '}
        <Mono>shared_device_changes</Mono>.
      </P>
      <DataTable
        head={['Constant', 'Value']}
        rows={[
          ['ACT_IDLE_SECONDS', '120: the switch ends after this long with no change and no still-here'],
          ['ACT_MAX_MINUTES', '30: and never lasts longer from the PIN'],
          ['PIN_TRIES / PIN_LOCK_MINUTES', '5 wrong PINs lock that person on that device for 5 minutes'],
          ['DEVICE_TRIES', '15 wrong PINs on one device within 5 minutes, whoever for, lock the device'],
        ]}
      />
      <H3>The admin</H3>
      <P>
        <Mono>lib/sharedDevice.js</Mono> keeps the device token (localStorage <Mono>maca_shared_device</Mono>) and
        the act token (memory only: a reload is a Lock), and the idle timer (taps and keys;{' '}
        <Mono>IDLE_MS</Mono>). <Mono>lib/api.js</Mono> sends both headers on every call, and on 403{' '}
        <Mono>person_needed</Mono> / <Mono>office_pin_needed</Mono> asks <Mono>askWho()</Mono> and sends the call
        once more; on 404 <Mono>shared_device_unknown</Mono> it forgets the device. <Mono>components/SharedDevice.jsx</Mono>:{' '}
        <Mono>SharedDeviceLayer</Mono> (AppShell and MobileShell: the Who is this? names and PIN pad; the pill
        with Lock only in the office, <Mono>pill={'{false}'}</Mono> on the phone, whose header menu shows the
        person with <Mono>useSharedLock()</Mono> and <Mono>askWhoNow()</Mono>), <Mono>SharedDeviceSettings</Mono> and <Mono>OfficePinSettings</Mono> (Settings, and the
        phone&apos;s <Mono>/mobile/device</Mono>).
      </P>
      <InfoBox type="warn">
        The device is known only by the token its browser sends. Someone who clears the browser&apos;s storage
        on a shared device has the signed-in account&apos;s own access again; sign such devices in with an
        account that has only what the device needs. Tests: api/test/shared-devices.test.mjs.
      </InfoBox>
    </section>
  )
}
