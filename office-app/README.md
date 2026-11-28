# Macaroonie Office

The staff app for phones (OUTSTANDING 44 item 13, `docs/PEPPER_FIRST.md` 4.8).
A native shell around the admin's phone pages (`ops.<domain>/mobile`): it signs
in natively, shows the pages in a web view, and gives them what a web page can't
do well inside an app, through a bridge (`bridge.js`, the page's side is
`admin/src/lib/officeApp.jsx`):

| Bridge | What for | Page side |
|---|---|---|
| `auth.token()`, `auth.user()`, `auth.signOut()` | Sign-in (Google refuses sign-in inside a web view) | `lib/officeApp.jsx` fills Auth0's context |
| `push.token()` | The Today task notices (due soon, late) | `lib/push.js`, `components/notices/NoticeSettings.jsx` |
| `speech.listen()`, `speech.speak()` | Pepper's dictation and talk mode (`continuous`: one listening through pauses until stopped, Android 13 and up; rules in `speechCore.js`; `hints`: the venue's own words, given to the recogniser as contextual strings) | `lib/speech.js` |
| `scanner.scan()` | Barcodes into the order form's search | `components/purchasing/ordering.jsx` |
| `camera.permission()` | The camera for a page's Photo input (asked once) | `lib/officeApp.jsx` `photoCapture()` |
| `share.take()`, `share.onShared(fn)` | A picture (or a link or a note) shared to the app from the gallery or another app, taken once into Capture (`shareCore.js`) | `lib/officeApp.jsx` `useSharedItem()`, `pages/mobile/MobileHub.jsx` |
| `platform` | `android` or `ios`: which phone (the notices' device label) | `lib/push.js` |

It is a different app from `android-app/` (Macaroonie Player: the till, kitchen
screen, kiosk and menu screen shell): that one keeps the screen awake, hides the bars and has no
sign-in.

Android draws the app edge to edge (always, from Expo SDK 54), under the
status bar, the navigation buttons and the keyboard. `App.js` keeps the web
view inside the safe area (`react-native-safe-area-context`) and, while the
keyboard is up, above it; the scanner's Cancel sits above the buttons too.

The pages themselves change with every deploy; a new build of the app is only
needed when the app's own code changes (the bridge, sign-in, the scanner, the
layout, speech, the share target).

## Sharing to the app (Android)

Since 26 Nov 2026 the app is a share target: in the gallery (or any app),
Share → Macaroonie Office opens the app with the picture in Capture on the
phone home. It is
[`expo-share-intent`](https://github.com/achorein/expo-share-intent) 9.0.0
(the release for Expo SDK 58; 8.x is SDK 57, 7.x SDK 56) and its config plugin
in `app.json`:

- `androidIntentFilters` `image/*` and `text/plain` (a link or a note opens as
  a typed capture), `androidMultiIntentFilters` `image/*` (several pictures:
  the first is kept and Capture says so). Prebuild puts `SEND` and
  `SEND_MULTIPLE` intent filters on the main activity (`singleTask`).
- `disableIOS: true`: the iPhone needs a share extension, an app group and
  the Apple account; not built yet.

`App.js` (`useShareTarget()`) listens to the library's native module rather
than its hook (the hook gives one address per file; the content address with
the sharing app's read grant is tried first, then the copy the module makes
in the app's cache). The picture is shrunk on the phone with
`expo-image-manipulator` (2,000 px on the long side, JPEG 0.8, then 0.6 if
still over 5 MB) and kept in memory only, until the page takes it
(`share.take()`) or 10 minutes pass (`shareCore.js`). The page is told
(`share.onShared`) when it is on the phone pages; otherwise, or before
sign-in, the phone home loads and takes it. Builds made before this have no
`share` part; the pages feature-detect it.

**A new build is needed** for this (the intent filters and two native
modules): nothing to set on expo.dev, the build from GitHub picks it up.

## Setting it up (once, by the owner)

1. **Auth0: a Native application** for this app (Applications → Create
   Application → Native). Note its Client ID. Settings:
   - Allowed Callback URLs and Allowed Logout URLs: `macaroonie-office://callback`
   - Refresh Token Rotation on; Grant Types: Authorization Code, Refresh Token
   - APIs: allow it the Macaroonie API (the same audience the office uses)
   - Login Experience → Types of Users = **Business Users**, as the office's
     application has: this is what keeps it invitation-only.
2. **EAS project**: `gomono-london/macaroonie-office`. `app.json` has its id
   (`extra.eas.projectId`, as `eas init --id` writes it) and `"owner":
   "gomono-london"`; push tokens need the id.
3. **Firebase for push.** Expo's push service sends to Android through Firebase
   Cloud Messaging, and the app needs two things from the Firebase project
   (`macaroonie-office`, Android app `com.macaroonie.office`):
   - **`google-services.json`** (Firebase console → Project settings → Your
     apps → the Android app → download), needed when the app is built. Don't
     commit it. On expo.dev → the project → Environment variables, add a
     variable named **`GOOGLE_SERVICES_JSON`**, type **File**, upload the
     file, visibility Sensitive or Secret, for production, preview and
     development. `app.config.js` passes it to the build as
     `android.googleServicesFile`. For a build on your own computer, put the file
     at `office-app/google-services.json` instead (git-ignored). Without it the
     app still builds but can't get a push token, so Turn on notices says
     notifications are off.
   - **The FCM V1 service account key** (Firebase console → Project settings →
     Service accounts → Generate new private key), uploaded to the EAS project:
     expo.dev → the project → Credentials → Android → `com.macaroonie.office` →
     FCM V1 service account key (or `eas credentials`). Expo's push service uses
     it to deliver. The API needs nothing: it sends to Expo
     (`api/src/services/notices.js`).
4. **Auth0 client id for the build**: `MACAROONIE_AUTH0_CLIENT_ID` as an EAS
   environment variable (production, preview, development). The domain,
   audience and root domain default to the live ones in `app.config.js`; set
   `MACAROONIE_ROOT_DOMAIN` / `MACAROONIE_AUTH0_DOMAIN` /
   `MACAROONIE_AUTH0_AUDIENCE` only for a build pointed elsewhere.
5. **The signing keystore**: nothing to do. The first build makes one if the
   project has none: a build from GitHub runs EAS non-interactively, and in
   that mode eas-cli generates a keystore and saves it on the EAS project
   (checked in eas-cli 27.11's source: `SetUpBuildCredentials` and
   `CreateKeystore`). After that first build, download a backup from expo.dev →
   Credentials → Android: every later version must be signed with the same key,
   or phones refuse it as an update. If you'd rather make it before any build,
   `eas credentials` (Android → production → Keystore → Set up a new keystore)
   does it interactively.

## Building

Three profiles (`eas.json`):

- **`production`**: the store build. On Android an **app bundle (`.aab`) for
  Google Play**, its version code counted up by EAS on every build
  (`appVersionSource: remote`, `autoIncrement`); on an iPhone, App Store and
  TestFlight. An app bundle can't be installed on a phone by hand.
- **`preview`**: an **APK** to install by hand (and ad hoc on registered
  iPhones), for trying a build before it goes to Play.
- **`development`**: an APK with the web view's debugging on
  (`MACAROONIE_WEB_DEBUG`).

- **From GitHub (expo.dev)**: connect the repository with base directory
  **`office-app`** (the device app uses `android-app`). Build from GitHub uses
  the `production` profile, so it makes the Play bundle, and every platform in
  `app.json`: Android only until the Apple account is set up (below). A GitHub
  build has no shell environment, so everything it needs comes from the EAS
  environment variables above.
- **From your computer**: in `office-app/` (signed in with `eas login`), with
  `google-services.json` in the folder or the EAS variable:
  `npx eas build -p android --profile production` for Play, or
  `--profile preview` for an APK.

## Google Play

The Play developer account is set up; what is left is done once, in the Play
Console and on expo.dev (no key or file goes in the repository or the chat):

1. **Make the app** in the Play Console with the package name
   **`com.macaroonie.office`** (`app.json`), and fill in the store listing,
   content rating, data safety (name and email for sign-in, push token,
   nothing for advertising) and the privacy policy address
   **https://macaroonie.com/privacy**.
2. **The first bundle by hand**: Google takes the first upload only through
   the Play Console. Build with the `production` profile, download the `.aab`
   from expo.dev, and upload it to **Testing → Internal testing** as a new
   release. Play App Signing starts then: the EAS keystore becomes the
   **upload key**, and Google signs what phones install.
   - Phones that already have the Office app from an APK were signed with the
     EAS key, so they can't update to the Play version under Google's own
     signing key: uninstall and install from Play. To let them update
     instead, choose to sign with your own key when Play asks, and give it
     the EAS keystore (expo.dev → Credentials → Android → download).
3. **Uploads from EAS after that**: in Google Cloud, make a service account
   for the Play project and give it access in the Play Console (Users and
   permissions → invite the service account's email, release permissions for
   this app). Make a JSON key for it and upload the key on expo.dev → the
   project → Credentials → Android → `com.macaroonie.office` → **Google
   Service Account Key** (for submissions). Then
   `npx eas submit -p android --profile production` (or expo.dev's submit
   after a build) sends the latest bundle to the **internal** track as a
   **draft** (`eas.json` `submit.production.android`): a Play app that has
   never been published takes only drafts, so each one is rolled out in the
   Play Console. Once the app is published, `releaseStatus` can become
   `completed` and the track `production`.

## iPhone

Ready to build (Pepper-first step 6d, 24 Nov 2026), not built or run on an
iPhone yet: it needs the owner's **Apple Developer Program** membership (paid,
yearly), which only the owner can join and sign in to.

What is set up in the code:

- `app.json`: `platforms` is Android only until the Apple account is set up (Build from GitHub on expo.dev builds every platform listed, and an iPhone build fails without the account); `OFFICE_IOS=1` adds `ios` through `app.config.js` (CI's iPhone bundle check uses it), and once the account is ready add `"ios"` to `platforms` for good; `ios.bundleIdentifier`
  `com.macaroonie.office`; `ios.supportsTablet` false (phones only, like the
  phone pages); `ios.infoPlist` has the reason shown for each permission the
  app asks for: the camera (scanning, photos), the microphone and speech
  recognition (Pepper), the photo library (picking a photo to capture), and
  `ITSAppUsesNonExemptEncryption: false` (only the system's own HTTPS, so App
  Store Connect doesn't ask about export rules on every upload). Notifications
  need no reason string on an iPhone: the phone asks when Turn on notices is
  tapped.
- `app.config.js`: push asks Apple for the production environment
  (`aps-environment`), except for the `development` profile (the sandbox).
- `eas.json`: every profile builds for an iPhone too; `preview` and
  `development` are internal (ad hoc: only iPhones registered on the Apple
  account can install them), and `production` is for TestFlight and the App
  Store (`distribution: store`; on Android it makes the app bundle for Google
  Play).
- The code paths that differ, each in a file the tests run in Node:
  - push: the same Expo push token (`ExponentPushToken[...]`, the API's `app`
    kind); Expo sends it through APNs instead of FCM. The notice channel is
    Android's only. The device is labelled "on iPhone" in the person's notices.
  - speech: the phone's own recogniser (Apple's) through the same bridge; its
    results each hold every word so far, so nothing is joined
    (`speechCore.js`, `cumulative`); the venue's words go to it as contextual
    strings, as on Android 13 and up; the task hint is dictation.
  - the scanner: an iPhone reads a UPC-A as an EAN-13 with a leading 0;
    `scanCore.js` gives the page the 12 digits, as Android does.
  - safe areas and the keyboard: an iPhone reports the whole keyboard, which
    covers the home indicator already, and moves it with will-events
    (`layout.js`).
  - back: an iPhone has no back button; a swipe from the left edge goes back
    in the pages (`allowsBackForwardNavigationGestures`).
- No app links: neither app opens `https://` links of ours from outside (no
  Android VIEW `intentFilters` for our hosts; the only added filters are the
  share target's SEND ones), so no associated domains are needed.
- Sharing to the app is Android only (`disableIOS` on `expo-share-intent`):
  the iPhone's share extension comes later. Sign-in
  comes back by the `macaroonie-office://` scheme.

What the owner does, once:

1. **Join the Apple Developer Program** (developer.apple.com) as the business,
   and note the Team ID.
2. **Auth0**: the same Native application serves both phones. Nothing to add
   (the callback is the app's scheme, not a web address).
3. **Push (APNs)**: `npx eas credentials -p ios` (signed in with `eas login`)
   → production → Push Notifications → set up a push key. EAS makes the key
   on the Apple account and keeps it for Expo's push service, which the API
   already sends to. Nothing changes on the server.
4. **The first build**: first add `"ios"` to `platforms` in `app.json` (it is left out until now so expo.dev's Build from GitHub doesn't try an iPhone build), then in `office-app/`, `npx eas build -p ios --profile
   preview` for iPhones registered with `npx eas device:create` (internal), or
   `npx eas build -p ios --profile production` for TestFlight. EAS asks to sign
   in to the Apple account and makes the certificate and provisioning
   profile. `npx eas submit -p ios --profile production` sends that
   build to App Store Connect (make the app there first, with the bundle id
   above).
5. **App Store review**: the privacy answers (the app collects the person's
   name and email for sign-in, and nothing for tracking), and a test login
   for the reviewer. Apple may refuse an app that is mostly a website: push,
   voice, the scanner, capture and native sign-in are what make it more.

The Android build is unchanged by any of this.

## Tests

`npm test` (Node only, no phone): the bridge both ways (`test/bridge.test.mjs`),
which addresses stay in the app and where a tapped notice opens
(`test/links.test.mjs`), the sign-in rules (`test/authCore.test.mjs`),
one listening's rules (`test/speechCore.test.mjs`), what differs on an
iPhone with the iOS settings (`test/ios.test.mjs`), and sharing to the app:
the bridge's share part, what was shared, shrinking and the inbox
(`test/share.test.mjs`).
