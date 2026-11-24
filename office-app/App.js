// Macaroonie Office: the staff app for phones (OUTSTANDING 44 item 13,
// docs/PEPPER_FIRST.md 4.8, way C: a native shell around the existing phone
// pages). It signs in natively (auth.js: Auth0 in the phone's browser), then
// shows the phone pages of the admin (ops.<root>/mobile: Today, the cash-up,
// wages, orders, Pepper and the rest) in a web view, so they change with
// every deploy and never need a new build of this app. Before a page loads
// the app puts a bridge on it (bridge.js), which the pages use for what a web
// page can't do well inside an app:
//   - sign-in: the access token, refreshed here (admin/src/lib/officeApp.jsx)
//   - push: the app's Expo push token, for the Today task notices
//     (admin/src/lib/push.js; api/src/services/notices.js sends them)
//   - speech: the phone's own recognition and voice, for Pepper's dictation
//     and talk mode (admin/src/lib/speech.js)
//   - a barcode scanner (Scanner.js), for the order form's Scan button
// Links off our two hosts open in the phone's browser; the back button goes
// back in the pages. Android and iPhone from the same code (README.md); what
// differs is kept in small files the tests run in Node: the keyboard and the
// page's padding (layout.js), how results join (speechCore.js), a UPC-A scan
// (scanCore.js), and the notice channel (Android only).
//
// Android draws the app edge to edge, under the status bar, the navigation
// buttons and the keyboard (always, from Expo SDK 54). The pages are kept
// clear of all three: the web view sits inside the safe area, and while the
// keyboard is up it ends where the keyboard starts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Keyboard, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import Constants from 'expo-constants'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import * as Speech from 'expo-speech'
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import { createAuth } from './auth'
import { bridgeScript, makeHandler } from './bridge'
import { opsUrl, staysInApp, bridgeAllowed, noticeUrl } from './links'
import Scanner from './Scanner'
import { createSession } from './speechCore'
import { pagePadding, keyboardEvents } from './layout'

const EXTRA = Constants.expoConfig?.extra || {}
const ROOT = String(EXTRA.rootDomain || 'macaroonie.com').toLowerCase()
const VERSION = Constants.expoConfig?.version || '1'
const PROJECT_ID = EXTRA.eas?.projectId
const NAVY = '#1f2a44'
const PINK = '#f4a7b9'

const auth = createAuth({
  domain: EXTRA.auth0Domain, clientId: EXTRA.auth0ClientId, audience: EXTRA.auth0Audience, scheme: EXTRA.scheme || 'macaroonie-office',
})

// Notices show while the app is open too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
})

async function pushToken() {
  if (Platform.OS === 'android') {
    // The API sends notices on this channel (channelId 'tasks').
    await Notifications.setNotificationChannelAsync('tasks', {
      name: 'Tasks due and late', importance: Notifications.AndroidImportance.HIGH,
    })
  }
  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== 'granted') throw new Error('Notifications are off for Macaroonie Office. Allow them in the phone\'s settings.')
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })
  return data
}

// One recognition at a time: the callbacks and the session (speechCore.js)
// of the one listening now. continuous (a hold, dictation) keeps listening
// through pauses until stop(); it is dropped for the rest of this run if the
// phone's recogniser turns out not to manage it.
let hearing = null
let continuousWorks = true
ExpoSpeechRecognitionModule.addListener('result', e => {
  const h = hearing
  if (!h) return
  const final = !!e.isFinal
  h.onText?.(h.session.text(e.results?.[0]?.transcript, final), final)
})
ExpoSpeechRecognitionModule.addListener('error', e => {
  const h = hearing
  if (h && h.session.error(e.error)) h.onError?.(e.message || e.error)
})
ExpoSpeechRecognitionModule.addListener('end', () => {
  const h = hearing
  hearing = null
  if (h?.session.end()) continuousWorks = false
  h?.onEnd?.()
})

const speech = {
  listen({ lang, continuous, hints, onText, onEnd, onError }) {
    // An iPhone's results each hold every word so far (speechCore.js).
    const session = createSession({ continuous: !!continuous && continuousWorks, cumulative: Platform.OS === 'ios' })
    const mine = { onText, onEnd, onError, session, started: false, stopped: false }
    hearing = mine
    ExpoSpeechRecognitionModule.requestPermissionsAsync().then(p => {
      if (hearing !== mine) return
      if (!p.granted) { onError?.('Macaroonie Office needs the microphone. Allow it in the phone\'s settings.'); hearing = null; onEnd?.(); return }
      // Let go before the microphone opened: nothing to listen to.
      if (mine.stopped) { hearing = null; onEnd?.(); return }
      mine.started = true
      // hints: the venue's own words (fridges, dishes, staff, suppliers) as the
      // recogniser's contextual strings (Android 13 and up, iOS).
      ExpoSpeechRecognitionModule.start({
        lang: lang || 'en-GB', interimResults: true, continuous: session.continuous,
        ...(hints?.length ? { contextualStrings: hints } : {}),
        // iPhone: words for a box, not a search; the default audio session
        // (play and record, to the speaker) lets answers be read aloud after.
        ...(Platform.OS === 'ios' ? { iosTaskHint: 'dictation' } : {}),
      })
    })
    return () => {
      if (hearing !== mine || mine.stopped) return
      mine.stopped = true
      session.stop()
      if (mine.started) ExpoSpeechRecognitionModule.stop()
    }
  },
  speak: ({ text, lang } = {}) => new Promise(resolve => Speech.speak(String(text || ''), { language: lang || 'en-GB', onDone: resolve, onStopped: resolve, onError: resolve })),
  stopSpeaking: () => Speech.stop(),
}

export default function App() {
  return <SafeAreaProvider><Office /></SafeAreaProvider>
}

/** How much of the screen the keyboard takes above the navigation buttons (0 when it is down). */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    // Android gives the keyboard's height less the navigation bar's; an iPhone the whole of it.
    // An iPhone's will-events move with the keyboard (layout.js); Android has did-events only.
    const ev = keyboardEvents(Platform.OS)
    const shown = Keyboard.addListener(ev.show, e => setHeight(e.endCoordinates?.height || 0))
    const hidden = Keyboard.addListener(ev.hide, () => setHeight(0))
    return () => { shown.remove(); hidden.remove() }
  }, [])
  return height
}

function Office() {
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardHeight()
  const [user, setUser] = useState(undefined)   // undefined while the kept sign-in is checked
  const [signingIn, setSigningIn] = useState(false)
  const [problem, setProblem] = useState(null)
  const [scanning, setScanning] = useState(null) // the scan's resolve while the camera is open
  const [startUrl, setStartUrl] = useState(opsUrl(ROOT))
  const [webKey, setWebKey] = useState(0)
  const web = useRef(null)
  const canGoBack = useRef(false)

  useEffect(() => { auth.restore().then(u => setUser(u)).catch(() => setUser(null)) }, [])

  const signIn = useCallback(async () => {
    setSigningIn(true); setProblem(null)
    try {
      const u = await auth.signIn()
      if (u) setUser(u)
    } catch (e) {
      setProblem(e?.message || 'Couldn\'t sign in.')
    }
    setSigningIn(false)
  }, [])

  const run = useCallback(script => web.current?.injectJavaScript(script), [])
  const handle = useMemo(() => makeHandler({
    run,
    allowed: url => bridgeAllowed(url, ROOT),
    services: {
      auth: {
        token: () => auth.token(),
        user: async () => auth.user(),
        signIn: async () => { const u = await auth.signIn(); if (u) setUser(u); return u },
        signOut: async () => { await auth.signOut(); setUser(null); return true },
      },
      push: { token: pushToken },
      speech,
      scanner: { scan: () => new Promise(resolve => setScanning(() => resolve)) },
    },
  }), [run])

  // A tapped notice opens its page.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(r => {
      const url = noticeUrl(r.notification.request.content.data?.url, ROOT)
      setStartUrl(url); setWebKey(n => n + 1)
    })
    return () => sub.remove()
  }, [])

  // Back goes back in the pages; on the first page Android's own back leaves the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (scanning) { scanning(null); setScanning(null); return true }
      if (canGoBack.current) { web.current?.goBack(); return true }
      return false
    })
    return () => sub.remove()
  }, [scanning])

  const clear = { paddingTop: insets.top, paddingBottom: insets.bottom }
  if (user === undefined) {
    return <View style={[s.screen, s.center, clear]}><ActivityIndicator color={PINK} size="large" /><StatusBar style="light" /></View>
  }
  if (!user) {
    return (
      <View style={[s.screen, s.center, clear]}>
        <StatusBar style="light" />
        <Text style={s.title}>Macaroonie Office</Text>
        <Text style={s.lead}>Today&apos;s tasks, the cash-up, orders and Pepper, with notices when something is due or late.</Text>
        <Pressable style={s.button} onPress={signIn} disabled={signingIn} accessibilityRole="button">
          {signingIn ? <ActivityIndicator color={NAVY} /> : <Text style={s.buttonText}>Sign in</Text>}
        </Pressable>
        {problem && <Text style={s.problem}>{problem}</Text>}
        <Text style={s.small}>Signing in opens your phone&apos;s browser, then comes back here.</Text>
      </View>
    )
  }
  return (
    <View style={s.screen}>
      {/* The pages are white: dark icons in the status bar. */}
      <StatusBar style="dark" />
      <View style={[s.page, pagePadding({ os: Platform.OS, insets, keyboard })]}>
        <WebView
          key={webKey}
          ref={web}
          source={{ uri: startUrl }}
          style={s.web}
          injectedJavaScriptBeforeContentLoaded={bridgeScript(VERSION, Platform.OS)}
          onMessage={e => handle(e.nativeEvent.data, e.nativeEvent.url)}
          onNavigationStateChange={n => { canGoBack.current = n.canGoBack }}
          onShouldStartLoadWithRequest={req => {
            if (staysInApp(req.url, ROOT)) return true
            Linking.openURL(req.url).catch(() => {})
            return false
          }}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          mediaPlaybackRequiresUserAction={false}
          webviewDebuggingEnabled={!!EXTRA.webDebug}
          startInLoadingState
          renderLoading={() => <View style={[s.screen, s.center, StyleSheet.absoluteFill]}><ActivityIndicator color={PINK} size="large" /></View>}
        />
      </View>
      {scanning && <Scanner onDone={code => { scanning(code); setScanning(null) }} />}
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: NAVY },
  center: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  page: { flex: 1, backgroundColor: '#ffffff' },
  web: { flex: 1, backgroundColor: '#ffffff' },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 12 },
  lead: { color: '#dbe1ee', fontSize: 16, textAlign: 'center', marginBottom: 28, lineHeight: 22 },
  button: { minHeight: 56, minWidth: 220, borderRadius: 14, backgroundColor: PINK, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  buttonText: { color: NAVY, fontSize: 18, fontWeight: '700' },
  problem: { color: '#ffb4b4', marginTop: 16, textAlign: 'center' },
  small: { color: '#9aa6bf', marginTop: 24, fontSize: 13, textAlign: 'center' },
})
