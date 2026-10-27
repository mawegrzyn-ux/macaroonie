// Macaroonie: one Android app for the till, the kitchen screen and the
// self-order kiosk. The apps themselves are the web apps on pos., kitchen.
// and kiosk.<root domain> (pos/ in the repository), so they change with every
// deploy and never need a new build of this app. This shell asks once what
// the device is, then shows that web app full screen in a WebView: screen kept
// on, system bars hidden, the back button does nothing, links off our domain
// stay out (a till or kitchen screen opens them in the browser), and printing
// goes to Android's print service.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { StatusBar } from 'expo-status-bar'
import { NavigationBar } from 'expo-navigation-bar'
import { useKeepAwake } from 'expo-keep-awake'
import * as Print from 'expo-print'

const EXTRA = Constants.expoConfig?.extra || {}
const ROOT = String(EXTRA.rootDomain || 'macaroonie.com').toLowerCase()
const WEB_DEBUG = !!EXTRA.webDebug
const VERSION = Constants.expoConfig?.version || '1'
const KIND_KEY = 'macaroonie.kind'
const RETRY_SECS = 5
const NAVY = '#1f2a44'
const PINK = '#f4a7b9'

// What the device can be, and the address of each (pos/src/lib/appHost.js).
const ROLES = [
  { kind: 'terminal', sub: 'pos', title: 'Till', text: 'Orders and payments at the counter or at the tables.' },
  { kind: 'kds', sub: 'kitchen', title: 'Kitchen screen', text: 'Orders for the kitchen, the pass and the order ready boards.' },
  { kind: 'kiosk', sub: 'kiosk', title: 'Self-order kiosk', text: 'Guests order and pay by themselves.' },
]
const KIND_OF_SUB = { pos: 'terminal', kitchen: 'kds', kds: 'kds', kiosk: 'kiosk' }
const roleOf = kind => ROLES.find(r => r.kind === kind) || null
const urlFor = kind => `https://${roleOf(kind).sub}.${ROOT}/`

/** The host of an http(s) address, lower case, or null. */
function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ''))
  return m ? m[1].toLowerCase() : null
}
const ours = host => host === ROOT || (!!host && host.endsWith('.' + ROOT))

export default function App() {
  useKeepAwake()
  // undefined while the saved kind loads, then the kind or null.
  const [kind, setKind] = useState(undefined)
  const [picking, setPicking] = useState(false)
  // The address the WebView opens. Navigation inside the web apps (a device
  // moved to another address) never changes it, so the page isn't reloaded.
  const [startUrl, setStartUrl] = useState(null)
  const [webKey, setWebKey] = useState(0)

  useEffect(() => {
    AsyncStorage.getItem(KIND_KEY)
      .then(saved => {
        const k = roleOf(saved) ? saved : null
        setKind(k)
        if (k) setStartUrl(urlFor(k))
        else setPicking(true)
      })
      .catch(() => { setKind(null); setPicking(true) })
  }, [])

  // Whatever the device is now is what it opens next time.
  useEffect(() => {
    if (kind) AsyncStorage.setItem(KIND_KEY, kind).catch(() => {})
  }, [kind])

  const choose = useCallback(k => {
    setKind(k)
    setStartUrl(urlFor(k))
    setWebKey(n => n + 1)
    setPicking(false)
  }, [])

  // The web app moved to another device address (lib/appHost.js moveDevice(),
  // or a link on its setup screen): remember it, without reloading the page.
  const followed = useCallback(k => setKind(k), [])

  // The back button never leaves a till, kitchen screen or kiosk; on the
  // picker it goes back to the app when there is one.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (picking && kind) { setPicking(false); return true }
      if (picking) return false
      return true
    })
    return () => sub.remove()
  }, [picking, kind])

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <NavigationBar hidden />
      {kind === undefined
        ? <Loading />
        : picking || !startUrl
          ? <Picker current={kind} onChoose={choose} onBack={kind ? () => setPicking(false) : null} />
          : <Shell
              key={webKey}
              kind={kind}
              url={startUrl}
              onFollow={followed}
              onChooseApp={() => setPicking(true)}
              onReload={() => setWebKey(n => n + 1)}
            />}
    </View>
  )
}

function Loading() {
  return (
    <View style={[styles.root, styles.center]}>
      <ActivityIndicator size="large" color={PINK} />
    </View>
  )
}

/** What is this device? Asked on the first start, and again from the web app's setup screen. */
function Picker({ current, onChoose, onBack }) {
  return (
    <ScrollView contentContainerStyle={styles.pickerWrap}>
      <Text style={styles.brand}>Macaroonie</Text>
      <Text style={styles.heading}>What is this device?</Text>
      <Text style={styles.lead}>Pick one. It opens that app every time the device starts; you can change it later from the app's setup screen.</Text>
      <View style={styles.roles}>
        {ROLES.map(r => (
          <Pressable
            key={r.kind}
            onPress={() => onChoose(r.kind)}
            accessibilityRole="button"
            accessibilityLabel={r.title}
            style={({ pressed }) => [styles.role, r.kind === current && styles.roleOn, pressed && styles.rolePressed]}
          >
            <Text style={styles.roleTitle}>{r.title}</Text>
            <Text style={styles.roleText}>{r.text}</Text>
            <Text style={styles.roleHost}>{r.sub}.{ROOT}</Text>
          </Pressable>
        ))}
      </View>
      {onBack && (
        <Pressable onPress={onBack} accessibilityRole="button" style={({ pressed }) => [styles.back, pressed && styles.rolePressed]}>
          <Text style={styles.backText}>Back to the {roleOf(current)?.title.toLowerCase()}</Text>
        </Pressable>
      )}
      <Text style={styles.version}>Version {VERSION}</Text>
    </ScrollView>
  )
}

/** The web app, full screen. */
function Shell({ kind, url, onFollow, onChooseApp, onReload }) {
  const [problem, setProblem] = useState(null)
  const kindRef = useRef(kind)
  kindRef.current = kind

  const shouldLoad = useCallback(req => {
    const target = req.url || ''
    if (/^(about:|data:|blob:|javascript:)/i.test(target)) return true
    // Frames inside the page (a video, a payment form) load as they like.
    if (req.isTopFrame === false) return true
    const host = hostOf(target)
    if (ours(host)) {
      const sub = host.slice(0, -(ROOT.length + 1))
      if (KIND_OF_SUB[sub]) onFollow(KIND_OF_SUB[sub])
      return true
    }
    // Anywhere else: a kiosk stays put; a till or kitchen screen opens the
    // browser (a supplier's site, a help page).
    if (kindRef.current !== 'kiosk') Linking.openURL(target).catch(() => {})
    return false
  }, [onFollow])

  const onMessage = useCallback(e => {
    let msg
    try { msg = JSON.parse(e.nativeEvent.data) } catch { return }
    if (msg?.type === 'macaroonie:choose-app') onChooseApp()
    else if (msg?.type === 'macaroonie:print' && typeof msg.html === 'string') {
      Print.printAsync({ html: msg.html }).catch(() => {})
    }
  }, [onChooseApp])

  if (problem) {
    return <Unreachable url={url} problem={problem} onRetry={onReload} onChooseApp={onChooseApp} />
  }
  return (
    <WebView
      source={{ uri: url }}
      style={styles.web}
      containerStyle={styles.root}
      javaScriptEnabled
      domStorageEnabled
      cacheEnabled
      textZoom={100}
      setBuiltInZoomControls={false}
      setDisplayZoomControls={false}
      overScrollMode="never"
      pullToRefreshEnabled={false}
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo
      setSupportMultipleWindows={false}
      mixedContentMode="never"
      allowFileAccess={false}
      applicationNameForUserAgent={`MacaroonieApp/${VERSION}`}
      webviewDebuggingEnabled={WEB_DEBUG}
      startInLoadingState
      renderLoading={() => <Loading />}
      onShouldStartLoadWithRequest={shouldLoad}
      onMessage={onMessage}
      onError={e => setProblem(e.nativeEvent?.description || 'The page could not be loaded.')}
      onHttpError={e => {
        const code = e.nativeEvent?.statusCode
        if (code >= 500) setProblem(`The server answered ${code}.`)
      }}
      // Android stopped the page (out of memory, a crash): open it again.
      onRenderProcessGone={onReload}
    />
  )
}

/** The web app can't be reached (no connection, the server restarting): try again by itself. */
function Unreachable({ url, problem, onRetry, onChooseApp }) {
  const [left, setLeft] = useState(RETRY_SECS)
  useEffect(() => {
    const t = setInterval(() => setLeft(n => n - 1), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { if (left <= 0) onRetry() }, [left, onRetry])
  return (
    <View style={[styles.root, styles.center, styles.pad]}>
      <Text style={styles.heading}>Can't reach {hostOf(url)}</Text>
      <Text style={styles.lead}>Check the Wi-Fi. Trying again in {Math.max(0, left)} s.</Text>
      <Text style={styles.small}>{problem}</Text>
      <View style={styles.row}>
        <Pressable onPress={onRetry} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && styles.rolePressed]}>
          <Text style={styles.buttonText}>Try now</Text>
        </Pressable>
        <Pressable onPress={onChooseApp} accessibilityRole="button" style={({ pressed }) => [styles.buttonGhost, pressed && styles.rolePressed]}>
          <Text style={styles.backText}>Change device type</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  web: { flex: 1, backgroundColor: NAVY },
  center: { alignItems: 'center', justifyContent: 'center' },
  pad: { padding: 32 },
  pickerWrap: { flexGrow: 1, justifyContent: 'center', padding: 32, gap: 16 },
  brand: { color: PINK, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  heading: { color: '#ffffff', fontSize: 30, fontWeight: '800' },
  lead: { color: '#d7dcea', fontSize: 17, lineHeight: 24, maxWidth: 640 },
  small: { color: '#9aa3bb', fontSize: 13, marginTop: 8, textAlign: 'center' },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8 },
  role: {
    flexGrow: 1, flexBasis: 260, minHeight: 140, padding: 22, borderRadius: 18,
    backgroundColor: '#2b3858', borderWidth: 2, borderColor: '#2b3858', gap: 8,
  },
  roleOn: { borderColor: PINK },
  rolePressed: { opacity: 0.75 },
  roleTitle: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  roleText: { color: '#d7dcea', fontSize: 15, lineHeight: 21 },
  roleHost: { color: '#9aa3bb', fontSize: 13, marginTop: 'auto' },
  back: { alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { color: PINK, fontSize: 16, fontWeight: '700' },
  version: { color: '#6f7894', fontSize: 12, marginTop: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24, justifyContent: 'center' },
  button: { minHeight: 52, paddingHorizontal: 24, borderRadius: 14, backgroundColor: PINK, justifyContent: 'center' },
  buttonText: { color: NAVY, fontSize: 17, fontWeight: '800' },
  buttonGhost: { minHeight: 52, paddingHorizontal: 20, borderRadius: 14, borderWidth: 2, borderColor: PINK, justifyContent: 'center' },
})
