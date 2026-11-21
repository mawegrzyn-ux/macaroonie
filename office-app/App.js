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
// back in the pages. Android first; nothing here is Android-only except the
// notice channel, so an iPhone build is the same code (see README.md).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
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

// One recognition at a time: the callbacks of the one listening now.
let hearing = null
ExpoSpeechRecognitionModule.addListener('result', e => {
  const text = e.results?.[0]?.transcript || ''
  hearing?.onText?.(text, !!e.isFinal)
})
ExpoSpeechRecognitionModule.addListener('error', e => {
  if (e.error === 'no-speech' || e.error === 'aborted') return
  hearing?.onError?.(e.message || e.error)
})
ExpoSpeechRecognitionModule.addListener('end', () => { const h = hearing; hearing = null; h?.onEnd?.() })

const speech = {
  listen({ lang, onText, onEnd, onError }) {
    hearing = { onText, onEnd, onError }
    ExpoSpeechRecognitionModule.requestPermissionsAsync().then(p => {
      if (!p.granted) { onError?.('Macaroonie Office needs the microphone. Allow it in the phone\'s settings.'); const h = hearing; hearing = null; h?.onEnd?.(); return }
      ExpoSpeechRecognitionModule.start({ lang: lang || 'en-GB', interimResults: true, continuous: false })
    })
    return () => ExpoSpeechRecognitionModule.stop()
  },
  speak: ({ text, lang } = {}) => new Promise(resolve => Speech.speak(String(text || ''), { language: lang || 'en-GB', onDone: resolve, onStopped: resolve, onError: resolve })),
  stopSpeaking: () => Speech.stop(),
}

export default function App() {
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

  if (user === undefined) {
    return <View style={[s.screen, s.center]}><ActivityIndicator color={PINK} size="large" /><StatusBar style="light" /></View>
  }
  if (!user) {
    return (
      <View style={[s.screen, s.center]}>
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
      <StatusBar style="light" />
      <WebView
        key={webKey}
        ref={web}
        source={{ uri: startUrl }}
        style={s.web}
        injectedJavaScriptBeforeContentLoaded={bridgeScript(VERSION)}
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
      {scanning && <Scanner onDone={code => { scanning(code); setScanning(null) }} />}
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: NAVY },
  center: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  web: { flex: 1, backgroundColor: '#ffffff' },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 12 },
  lead: { color: '#dbe1ee', fontSize: 16, textAlign: 'center', marginBottom: 28, lineHeight: 22 },
  button: { minHeight: 56, minWidth: 220, borderRadius: 14, backgroundColor: PINK, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  buttonText: { color: NAVY, fontSize: 18, fontWeight: '700' },
  problem: { color: '#ffb4b4', marginTop: 16, textAlign: 'center' },
  small: { color: '#9aa6bf', marginTop: 24, fontSize: 13, textAlign: 'center' },
})
