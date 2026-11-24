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
layout, speech).

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

On Android every profile but `app-store` builds an APK to install by hand,
like the device app; `app-store` makes the app bundle for Google Play.

- **From GitHub (expo.dev)**: connect the repository with base directory
  **`office-app`** (the device app uses `android-app`). Build from GitHub uses
  the `production` profile and every platform in `app.json`: Android and, since
  step 6d, iPhone, which fails until the Apple account is set up (below), so
  pick Android only there until then. A GitHub build has no shell environment,
  so everything it needs comes from the EAS environment variables above.
- **From your computer**: `npx eas build -p android --profile preview` in
  `office-app/` (signed in with `eas login`), with `google-services.json` in the
  folder or the EAS variable.

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
  `production` are internal (ad hoc: only iPhones registered on the Apple
  account can install them), and `app-store` is for TestFlight and the App
  Store (`distribution: store`; on Android it makes an app bundle for Google
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
  Android `intentFilters`), so no associated domains are needed. Sign-in
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
   `npx eas build -p ios --profile app-store` for TestFlight. EAS asks to sign
   in to the Apple account and makes the certificate and provisioning
   profile. `npx eas submit -p ios --profile production` sends an app-store
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
one listening's rules (`test/speechCore.test.mjs`), and what differs on an
iPhone with the iOS settings (`test/ios.test.mjs`).
