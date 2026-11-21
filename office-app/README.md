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
| `speech.listen()`, `speech.speak()` | Pepper's dictation and talk mode | `lib/speech.js` |
| `scanner.scan()` | Barcodes into the order form's search | `components/purchasing/ordering.jsx` |

It is a different app from `android-app/` (Macaroonie Player: the till, kitchen
screen, kiosk and menu screen shell): that one keeps the screen awake, hides the bars and has no
sign-in.

The pages themselves change with every deploy; a new build of the app is only
needed when the app's own code changes (the bridge, sign-in, the scanner).

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

Every profile builds an APK to install by hand, like the device app; switch
`production` to an app bundle when the app goes on Google Play.

- **From GitHub (expo.dev)**: connect the repository with base directory
  **`office-app`** (the device app uses `android-app`). Build from GitHub uses
  the `production` profile and every platform in `app.json`, which is Android
  only for now. A GitHub build has no shell environment, so everything it needs
  comes from the EAS environment variables above.
- **From your computer**: `npx eas build -p android --profile preview` in
  `office-app/` (signed in with `eas login`), with `google-services.json` in the
  folder or the EAS variable.

## iPhone later

Add `"ios"` back to `platforms` in `app.json` when it is time. The code is the
same (nothing here is Android-only except the notice channel).
It needs an Apple developer account, an APNs key in the EAS project, and
`npx eas build -p ios`. Apple may refuse an app that is mostly a website: push,
voice, the scanner and native sign-in are what make it more.

## Tests

`npm test` (Node only, no phone): the bridge both ways (`test/bridge.test.mjs`),
which addresses stay in the app and where a tapped notice opens
(`test/links.test.mjs`), and the sign-in rules (`test/authCore.test.mjs`).
