# The venue hub on Android: scope of works

Status: scope, 30 Oct 2026. Nothing here is built. Today the hub runs on a
mini PC (Linux or Windows, `docs/POS.md` 2.6) and, with hub first on, the
location's tills, kiosks, kitchen screens and order ready boards trade
through it (`docs/POS.md` section 11). This document scopes running the same
hub on an Android device instead of a mini PC.

## What the hub does today, and what changes on Android

The hub is about 2,300 lines of plain Node (`hub/`, no npm packages) plus the
shared rules it imports (`shared/pos/mirror.js`, the sequencer, tickets).
Most of it is platform-free and would run on Android unchanged:

| Part | Files | On Android |
|---|---|---|
| Linking (code, QR), calling the cloud | `src/cloud.js`, `bin/hub.js` | Unchanged |
| Hub first: the venue copy, uploads, follow, persistence | `src/venue.js`, `shared/pos/mirror.js` | Unchanged (`venue.json` / `venue.log` in the app's private folder; `fsync` works) |
| LAN server for devices (:9181), status page (:9180) | `src/lan.js`, `src/statusPage.js` | Unchanged (ports above 1024 are allowed) |
| Network printers (TCP 9100, ESC/POS) | `src/printer.js`, `src/escpos.js` | Unchanged |
| USB printers | `src/usb.js` (Linux `/dev/usb/lp*` via sysfs, Windows PowerShell) | **New**: Android has neither; USB goes through Android's USB Host API in native code |
| Updates | `src/update.js` (unpacks with the `tar` command), `bin/launcher.js` (restarts the process) | **New**: no `tar` or child processes to rely on; the Android service takes the launcher's job |
| Install and run as a service | `hub/install/*` (systemd, scheduled task) | **New**: an Android app with a foreground service, started on boot |
| The computer's details | `src/service.js` (`os.networkInterfaces()`, `process.platform`) | Mostly unchanged; battery, charging and Wi-Fi vs Ethernet come from Android |

So the work is a thin Android shell around the existing hub, three platform
pieces (USB printing, updates, running as a service) and some cloud and admin
changes. The rules (what a sale is, what prints where, hub first) are not
touched.

## Recommended approach

**Run the existing hub JavaScript on Android with nodejs-mobile**, inside a
small native Android app whose foreground service starts Node and runs
`hub/bin/hub.js`. A local bridge (a localhost-only HTTP endpoint with a
random key, run by the service) gives the hub what Node can't reach on
Android: USB printers, built-in printers, device details, and "restart me"
after an update.

Rejected alternatives:

- **Rewrite the hub in Kotlin.** The hub's core is the shared JavaScript
  sequencer and mirror; a second implementation would drift from the cloud's
  and the devices' copies, which is exactly what hub first depends on not
  happening.
- **Run it in React Native's JavaScript engine (Hermes)** inside the
  Macaroonie app. Hermes has no Node built-ins (`net`, `http`, `fs`,
  `crypto`), so every one of them would need a native module and the hub's
  code would fork from the mini PC's.

### Its own app, or a role in the Macaroonie app?

| | A separate app, Macaroonie Hub (`com.macaroonie.hub`) | A fifth role in the Macaroonie app |
|---|---|---|
| Size | Node's runtime only where it is needed | Adds Node's runtime (roughly 25-30 MB for arm64) to every till, kiosk and screen |
| Build | Plain Android (Kotlin) + nodejs-mobile; no React Native / Expo native-module compatibility to keep up with | nodejs-mobile has to work with the app's Expo SDK and React Native version through a config plugin; each Expo upgrade is a risk |
| Operators | Two apps to download (both from the `/android` page) | One app, pick Venue hub in the device type picker |
| Hub on a till | Not possible | Possible later: the till's app could also run the hub in the background |

**Recommendation: a separate app** for a dedicated device, at least for the
first version. The hub service and its bridge are the same code either way,
so it can become a role in the main app later if a hub on a till turns out
to be wanted (see Q-A).

## The device

The hub has to be on, on the venue network, all the time. Suitable devices,
best first:

1. **An Android box with an Ethernet port** (Android 11 or later), mains
   powered, plugged into the router. Cheapest, no battery to manage, stable
   address. The equivalent of the mini PC.
2. **An Android POS terminal with a built-in printer** (for example Sunmi or
   iMin). The hub could also print on the built-in printer; most have
   Ethernet on their base.
3. **A spare Android tablet** on its charger. Works, but battery, Wi-Fi sleep
   and power-saving make it the least reliable; fine for a trial.

Not recommended: a till that staff also use as the hub (it gets switched off,
taken away or restarted during service, and the location loses hub first and
its network printers with it).

## Android constraints and how each is handled

| Constraint | Handling |
|---|---|
| Background work is stopped | A **foreground service** with a permanent notification. Android 14+ needs a service type: `connectedDevice` (it serves the venue's devices and printers). Not `dataSync`, which Android 15 limits to 6 hours a day. |
| Doze and app standby | Ask to be left out of battery optimisation on first start; hold a partial wake lock and a Wi-Fi lock (low-latency) while the service runs; on a box on mains power this is mostly moot. The app says on its screen, and the hub reports to Store tech, when battery optimisation is still on. |
| Starting after a power cut | `RECEIVE_BOOT_COMPLETED` starts the service after a reboot (also after the app is updated: `MY_PACKAGE_REPLACED`). Tested by pulling the plug. |
| Stable address | Devices find the hub by the addresses it reports. Android randomises the Wi-Fi MAC address per network by default (Android 10+), which breaks a fixed address reserved on the router: use Ethernet, or set the venue network to the device's own MAC. The hub reports Wi-Fi vs Ethernet and the app warns about a randomised MAC. |
| Address changing while the internet is down | Devices learn the hub's address from the cloud, so a change while offline isn't seen until the internet is back (true of the mini PC too). Possible later: announce the hub on the LAN (mDNS, Android `NsdManager`) so devices can find it without the cloud. |
| Plain http on the LAN | Unchanged: the devices already allow it (Android app 1.3, `plugins/withVenueNetwork.js`). The hub app itself only listens. |
| Network details | `os.networkInterfaces()` may give less on newer Android versions (`getifaddrs` restrictions); the bridge supplies addresses from `ConnectivityManager` when Node's list is empty. Checked in the spike. |
| Keeping the link secret | `hub.json` (device id and secret) in the app's private storage; optionally sealed with the Android Keystore. Uninstalling the app forgets it (the hub shows a new code, as a mini PC does after `hub.js unlink`). |

## Printing on Android

| Printer | How | Effort |
|---|---|---|
| Network (Epson and similar on 9100) | Unchanged Node code | None |
| USB receipt printer | The bridge lists printer-class USB devices (`UsbManager`), asks for permission once per printer (Android shows a dialog the first time; on a dedicated box an "always use for this device" intent filter avoids repeat asks), writes tickets by bulk transfer and reads the status reply (DLE EOT) like the Linux path. Ids stay `usb:<vendor>:<product>:<serial>`, so Store tech's USB on the hub works as it is. | Medium |
| Built-in printer (Sunmi, iMin) | Vendor SDK in the bridge (Sunmi's print service takes raw ESC/POS), reported as `builtin:<vendor>` in the hub's printer list. Optional, per vendor. | Small per vendor |
| Bluetooth printer | `BluetoothSocket` (SPP) in the bridge, `bt:<address>` ids, pairing done in Android settings. Optional. | Medium |

`hub/src/usb.js` gets a third system beside Linux and Windows (`android`),
which calls the bridge for list / print / status; the queueing (status
questions in line with tickets) stays as it is.

## Updates

The hub would keep updating itself from the same cloud release as the mini
PC (`hubRelease()`, `GET /pos-api/hub/release.tgz`), so a fix reaches both at
once:

- Replace the `tar` command with a small JavaScript reader (gzip from
  `node:zlib`, then the tar headers), used on every platform. That also takes
  away a dependency the Windows hub has today.
- On Android the service plays the launcher's part: it starts Node with the
  version named in `current.json`, and after an update (exit code 75) or a
  stop it restarts Node. nodejs-mobile can start Node once per process, so
  the hub runs in its own Android process (`android:process=":hub"`) and the
  service restarts that process. The rollback rule is the same as
  `bin/launcher.js`: three quick stops go back a version and hold the new one
  back.
- The Android app itself (the shell, the bridge, Node's runtime) is updated
  by installing a new APK, as the Macaroonie app is today (a platform admin
  pastes the build link; `/android/hub` serves it).

## Cloud and admin changes

- `pos_devices.info` already takes what the hub reports. Add Android's
  details: `platform: 'android'` (Node reports it), model, Android version,
  network (Ethernet / Wi-Fi and signal), battery and charging, battery
  optimisation on/off, MAC randomised.
- Store tech → Venue hub: a "Set up a hub on Android" box beside the mini PC
  one (download the Hub app, open it, link the code), and warnings on the
  hub's row for Android problems (on battery, not charging, on Wi-Fi with a
  random MAC, battery optimisation on). The installer app's Add a hub gets
  the same choice.
- The APK download: a `platform_settings` row `android_hub` and `/android/hub`
  on the device hosts, the same as the Macaroonie app's (migration 213).
- No change to linking, hub first, LAN keys or printing jobs.

## Work, in phases

Rough working days for one developer; the spike decides the rest.

| Phase | Work | Days |
|---|---|---|
| 0. Spike | nodejs-mobile in a bare Android app on an Android box: run `hub/bin/hub.js` unchanged, link it, print to a network printer, a till on the LAN reaching :9181, `os.networkInterfaces()`, `fsync`, 8 hours with the screen off. Check which Node version nodejs-mobile has (the hub asks for Node 22; nodejs-mobile has trailed Node's releases) and list what the hub needs changing for it. | 2-3 |
| 1. The app and its service | Kotlin app: foreground service (`connectedDevice`), boot start, wake and Wi-Fi locks, battery-optimisation prompt, Node in its own process, restart on stop. Screens: link code with QR, then the hub's state (a WebView of its own status page), log, "forget this venue". | 5-8 |
| 2. Updates | JavaScript tar reader (all platforms) with tests; the service as launcher (current.json, rollback, held back); APK download on the platform page and `/android/hub`. | 3-4 |
| 3. Printing | The bridge (localhost HTTP + key), USB list / print / status with the permission flow; `usb.js` android system with tests against a stand-in bridge. Built-in Sunmi printer if wanted (Q-C). | 5-8 |
| 4. Cloud and admin | Android details in the hub's report, Venue hub page and installer app wording and warnings, docs (Help, Docs, CLAUDE.md). | 2-3 |
| 5. Testing | Unit tests in CI (bridge stand-in, tar reader, android usb system); on devices: a full service day through the hub, internet down, power pulled, router restarted, Wi-Fi dropped, 72 hours running, an update and a rollback. | 4-6 |
| **Total** | | **21-32** |

## Risks

- **nodejs-mobile's Node version and upkeep.** It has historically trailed
  Node's releases. If the hub needs something newer than it offers, the hub
  must avoid those features (checked in the spike) or we carry a patched
  build. A stalled project would leave the Android hub on an old Node.
- **Device makers' power management.** Some Android builds stop foreground
  services anyway (aggressive vendor battery savers). Dedicated boxes on
  mains power are much safer than tablets; the device list we recommend
  should only include models we have soak-tested.
- **USB permission prompts** after a reboot or replugging on some devices,
  which would leave a USB printer silent until someone taps Allow on the hub.
  Mitigated by the intent filter on dedicated boxes; flagged on the hub's row.
- **Not on Google Play.** Sideloaded like the Macaroonie app; a Play listing
  would need the foreground service type justified in Google's review.

## Not in scope

- A hub on a till that is also used as a till (see Q-A).
- iOS / iPadOS (no long-running background services).
- Finding the hub without the cloud (mDNS), noted above as a later step.
- Cash drawers and customer displays on the hub.

## Open questions

| # | Question | Depends on it |
|---|---|---|
| Q-A | A separate Macaroonie Hub app (recommended), or a role in the Macaroonie app so a till can also be the hub? | Phase 1 packaging |
| Q-B | Which devices to support first: an Android box with Ethernet, a POS terminal with a built-in printer, a spare tablet? | Phase 0 hardware, Phase 5 soak list |
| Q-C | Which printers matter on Android: USB, built-in (which vendor), Bluetooth? | Phase 3 |
| Q-D | Is a hub on Wi-Fi acceptable, or do we require Ethernet (and say so in Store tech)? | Phase 4 warnings |
