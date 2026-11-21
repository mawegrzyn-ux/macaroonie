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

It is a different app from `android-app/` (the till, kitchen screen, kiosk and
menu screen shell): that one keeps the screen awake, hides the bars and has no
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
2. **EAS project**: done. Its id (`acb817a5-...`) is in `app.json`
   (`extra.eas.projectId`), as `eas init --id` writes it; push tokens need it.
   Run `eas init --id acb817a5-4faa-4df1-aacf-e5a341627eb7` once while signed
   in to Expo if EAS asks for the project's `owner` (the account it belongs to).
3. **Push on Android**: Expo's push service sends through Firebase Cloud
   Messaging. Make a Firebase project, add an Android app with package
   `com.macaroonie.office`, and upload its FCM V1 service account key to the
   EAS project (`npx eas credentials`). The API needs nothing: it sends to
   Expo's push service (`api/src/services/notices.js`).
4. **Build** (environment for the build: `MACAROONIE_AUTH0_CLIENT_ID`, and
   `MACAROONIE_ROOT_DOMAIN` / `MACAROONIE_AUTH0_DOMAIN` /
   `MACAROONIE_AUTH0_AUDIENCE` when they aren't the defaults in
   `app.config.js`):
   `npx eas build -p android --profile preview` (or `production`) gives an APK to
   install by hand. Every profile builds an APK for now, like the device app;
   switch `production` to an app bundle when the app goes on Google Play.

## iPhone later

The code is the same (nothing here is Android-only except the notice channel).
It needs an Apple developer account, an APNs key in the EAS project, and
`npx eas build -p ios`. Apple may refuse an app that is mostly a website: push,
voice, the scanner and native sign-in are what make it more.

## Tests

`npm test` (Node only, no phone): the bridge both ways (`test/bridge.test.mjs`),
which addresses stay in the app and where a tapped notice opens
(`test/links.test.mjs`), and the sign-in rules (`test/authCore.test.mjs`).
