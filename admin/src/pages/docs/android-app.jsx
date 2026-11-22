// src/pages/docs/android-app.jsx
// The Docs page's "Macaroonie Player (Android app)" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable, InfoBox } from './parts.jsx'

export const id = 'android-app'
export const label = 'Macaroonie Player (Android app)'
export const order = 310

export function Section() {
  return (
    <section id="android-app" data-doc="">
      <H2>Macaroonie Player (Android app)</H2>
      <P>
        <Mono>android-app/</Mono> (27 Oct 2026) is one Android app, Macaroonie Player (named Macaroonie until 21 Nov
        2026; <Mono>app.json</Mono> <Mono>name</Mono> only: the package, the EAS slug and the user agent's{' '}
        <Mono>MacaroonieApp/&lt;version&gt;</Mono> stay, so installed devices update in place), <Mono>com.macaroonie.app</Mono>, for the
        till, the kitchen screen, the self-order kiosk and (version 1.2, 29 Oct 2026) menu screens: an Expo
        (SDK 58) shell around the <Mono>pos/</Mono> web apps and the <Mono>screen/</Mono> player, built and signed by EAS (project{' '}
        <Mono>@gomono-london/macaroonie</Mono>, GitHub base directory <Mono>android-app</Mono>). The apps
        themselves stay web pages, so a deploy changes them on every device and the app only needs a new build
        when the shell changes. Continuous Native Generation: there is no <Mono>android/</Mono> folder in the
        repository; native settings live in <Mono>app.json</Mono> and its plugins.
      </P>
      <DataTable
        head={['Part', 'How']}
        rows={[
          ['App.js + roles.js', 'First start: Picker (Till / Kitchen screen / Self-order kiosk / Menu screen), saved in AsyncStorage (macaroonie.kind). Then a WebView of https://{pos|kitchen|kiosk|screens}.<root>/ (ROLES, urlFor() in roles.js, tested by android-app/test/roles.test.mjs). useKeepAwake(), <StatusBar hidden />, <NavigationBar hidden /> (and the expo-navigation-bar plugin with hidden), BackHandler always consumed while the WebView shows. The Picker\'s choices and buttons are focusable with onFocus / onBlur drawing a white ring (roleFocus, buttonFocus) and hasTVPreferredFocus on the current (or first) choice, so a TV remote\'s arrows and OK work.'],
          ['Where it may go', 'onShouldStartLoadWithRequest: our domain and its subdomains load; anything else is refused, and a till or kitchen screen opens it in the browser (Linking); a kiosk or menu screen stays put (staysPut()). Landing on a device address (pos., kitchen. / kds., kiosk., screens.: kindOfUrl()) saves that kind (onFollow), so moveDevice() and the setup screen\'s address links change what the app opens next time without reloading the page (the WebView\'s source only changes when someone picks in the Picker).'],
          ['Menu screens (screen/player.js)', 'IN_APP = !!window.ReactNativeWebView, tellApp(). In the app the pairing screen has a Change device type button (data-app-choose, a document click listener) and the settings panel (five taps or five OK presses) a Change device type button (data-act app): both post macaroonie:choose-app. A TV with no touch reaches it with the remote (focusable buttons, Tab / arrows, OK).'],
          ['Android TV (plugins/withTvLauncher.js)', 'A config plugin in app.json: withAndroidManifest adds LEANBACK_LAUNCHER to the main activity\'s launcher intent filter, android:banner @drawable/tv_banner on the application, and uses-feature android.software.leanback, android.hardware.touchscreen, android.hardware.camera(.autofocus) with required false (one APK for tablets and TV boxes); withDangerousMod copies assets/tv-banner.png (320 x 180) to res/drawable-xhdpi/tv_banner.png. Checked with expo prebuild in a scratch copy.'],
          ['Bridge (pos/src/lib/nativeApp.js)', 'IN_APP = !!window.ReactNativeWebView; tellApp(message) posts JSON. printTickets() (lib/print.js) posts { type: macaroonie:print, html } (the same page it would print in a frame) and the app calls expo-print printAsync({ html }), Android\'s print dialog. Pair.jsx shows Change device type (posts macaroonie:choose-app, the app shows the Picker) instead of the links to the other addresses. The hidden corner posts macaroonie:device-menu (below).'],
          ['The hidden corner (corner.js)', "Five taps in the top left corner (CORNER_DP 56 dp square, CORNER_TAPS 5 within CORNER_WINDOW_MS 3000) open the Picker over the running app. CORNER_SCRIPT is the WebView's injectedJavaScript (each page load, main frame only, guarded by window.__macaroonieCorner): a capture-phase pointerdown listener that never stops the touch, measures the corner in CSS pixels as CORNER_DP / visualViewport.scale (so a zoomed kiosk's corner is the same size on the glass), and posts { type: macaroonie:device-menu }. While the page is still loading, Loading's onTouchStart counts the same way with nextTaps() / inCorner() (pageX / pageY in dp). Two copies of one rule because Hermes keeps no function source; android-app/test/corner.test.mjs (npm test, in the workflow) runs the same taps against both. App keeps the Shell mounted under the Picker (an absolute-fill View), so Back to the till doesn't reload it; opened from the corner (fromCorner) it shows Reload the till and goes back after AUTO_BACK_SECS (60) untouched (any touch on it starts the minute again). Each kind has its own origin, so its pairing (localStorage, IndexedDB) stays while another kind shows."],
          ['When it goes wrong', 'onError (main frame) or onHttpError 5xx: Unreachable, trying again every RETRY_SECS (5) by remounting the WebView, with Try now and Change device type. onRenderProcessGone (Android stopped the page): remount. The web apps\' own service workers keep working inside the WebView, so a device that has loaded its app once opens it offline.'],
          ['WebView settings', 'domStorageEnabled, textZoom 100 (the phone\'s font size never resizes the till), no zoom controls, overScrollMode never, mediaPlaybackRequiresUserAction false (kiosk start videos), setSupportMultipleWindows false, mixedContentMode never, allowFileAccess false, user agent + MacaroonieApp/<version>. scalesPageToFit (default) keeps the viewport tag working, so the kiosk\'s zoom (useKioskViewport()) works as in Chrome.'],
          ['app.json / app.config.js', 'Package com.macaroonie.app, orientation default (the device\'s mount decides), CAMERA permission (QR scanning; the WebView asks at runtime), RECORD_AUDIO and SYSTEM_ALERT_WINDOW blocked, splash and adaptive icons from the till icon\'s macaroon. app.config.js adds extra.rootDomain (MACAROONIE_ROOT_DOMAIN, default macaroonie.com) and extra.webDebug (MACAROONIE_WEB_DEBUG=1: chrome://inspect).'],
          ['eas.json', 'development: APK with web debugging. preview: APK for installing by hand. production: also an APK for installing by hand (distribution internal), autoIncrement, because Build from GitHub on expo.dev builds every platform with production and asks nothing; switch it to an app bundle when the app goes on Google Play. appVersionSource remote: EAS keeps the version code.'],
          ['Download (migration 213)', "platform_settings (global, no RLS) row android_app holds the copy: { url, key, bytes, sha256, source_url, file_url }. services/androidAppSvc.js: saveAndroidApp(link) fetches the pasted link (https; http too outside production) with one 45 s budget (under nginx's 60 s on /api/), reads a web page (expo.dev's build page) for the first .apk address in it (apkLinkIn(), JSON escapes undone), caps the file at 250 MB, checks it is an APK (apkProblem(): zip with AndroidManifest.xml, no BundleConfig.pb, so an .aab is refused), puts it through storageSvc (platform/android/<uuid>.apk) and removes the previous copy. routes/androidApp.js: GET / PUT { link } / DELETE /api/platform/android-app (platform admins; the Platform page's Macaroonie Player tab, components/platform/AndroidAppCard.jsx) and public GET /pos-api/android-app ({ available, path, bytes, updated_at }, nothing else). routes/posSite.js: /android on pos., kitchen. and kiosk. streams the local copy as macaroonie-player.apk (no-store) or redirects to an S3 copy; 404 page when there is none or the file is missing. Pair.jsx (useAndroidApp(), AndroidApp): not in the app, a button on an Android browser, elsewhere \"Android device? Get Macaroonie Player: open <address> on it\" with the address as a download link. pos/vite.config.js: /android in navigateFallbackDenylist, so the service worker never answers it with the app."],
          ['Checks', '.github/workflows/android-app.yml on pull requests touching android-app/: npm ci, npm test (the corner\'s tests), expo config, expo export --platform android. deploy.yml ignores android-app/**. android-app/package-lock.json is tracked (the root .gitignore ignores lockfiles; !android-app/package-lock.json) so EAS installs what was tested.'],
        ]}
      />
      <InfoBox type="info">
        Not built: a native QR scanner (the web apps use <Mono>BarcodeDetector</Mono> where the WebView has
        it, else a USB / Bluetooth scanner), silent printing (Android shows its print dialog; USB and network
        ticket printers belong on the venue hub), locking a kiosk in (use Android&apos;s app pinning or a
        device manager), and an iPhone / iPad build (<Mono>platforms</Mono> is android only).
      </InfoBox>
      <H3>Macaroonie Office (office-app/)</H3>
      <P>
        A second Expo app (SDK 58, <Mono>com.macaroonie.office</Mono>): the staff app for phones, around the phone
        pages of <Mono>ops.&lt;root&gt;/mobile</Mono>. <Mono>auth.js</Mono>: Auth0 in the phone&apos;s browser
        (expo-auth-session, PKCE, <Mono>offline_access</Mono>), the refresh token in expo-secure-store;{' '}
        <Mono>authCore.js</Mono> the rules. <Mono>bridge.js</Mono>: <Mono>bridgeScript()</Mono> put on each page
        before it loads (<Mono>window.MacaroonieOffice</Mono>: <Mono>auth.token/user/signIn/signOut</Mono>,{' '}
        <Mono>push.token</Mono>, <Mono>speech.listen/speak/stopSpeaking</Mono>, <Mono>scanner.scan</Mono>) and{' '}
        <Mono>makeHandler()</Mono> on the app&apos;s side, answering only pages of ours (<Mono>bridgeAllowed()</Mono>).{' '}
        <Mono>links.js</Mono>: what stays in the app (ops. and office., https), where a tapped notice opens.{' '}
        <Mono>speechCore.js</Mono>: one listening&apos;s rules (continuous pieces joined; Android&apos;s{' '}
        <Mono>client</Mono>, <Mono>no-speech</Mono>, <Mono>speech-timeout</Mono> and <Mono>aborted</Mono> endings never shown;
        continuous dropped for the run if the recogniser can&apos;t do it). Android draws the app edge to edge (always,
        from SDK 54): <Mono>App.js</Mono> keeps the web view inside the safe area
        (react-native-safe-area-context) and above the keyboard (<Mono>keyboardDidShow</Mono>&apos;s height, which is the
        keyboard less the navigation bar), with dark status bar icons over the white pages.{' '}
        <Mono>Scanner.js</Mono> (expo-camera); push by expo-notifications (channel <Mono>tasks</Mono>), speech by
        expo-speech-recognition and expo-speech. Build settings in <Mono>app.config.js</Mono> (root domain, Auth0
        native client id, audience; the EAS project id is in <Mono>app.json</Mono>). Every <Mono>eas.json</Mono> profile builds
        an APK for now. Checked by <Mono>.github/workflows/office-app.yml</Mono> (npm ci, tests, expo config and export);
        <Mono>deploy.yml</Mono> ignores <Mono>office-app/**</Mono>. Tests: <Mono>office-app/test</Mono> (Node, in CI with the device
        app&apos;s). Set-up the owner does once (Auth0 native application, EAS, Firebase for push): its README.
      </P>
    </section>
  )
}
