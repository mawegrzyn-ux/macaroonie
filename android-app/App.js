// Macaroonie: one Android app for the till, the kitchen screen, the
// self-order kiosk and menu screens. The apps themselves are the web apps on
// pos., kitchen., kiosk. (pos/ in the repository) and screens.<root domain>
// (screen/), so they change with every deploy and never need a new build of
// this app. This shell asks once what the device is, then shows that web app
// full screen in a WebView: screen kept on, system bars hidden, the back
// button does nothing, links off our domain stay out (a till or kitchen
// screen opens them in the browser), and printing goes to Android's print
// service. Five quick taps in the top left corner (corner.js) bring the
// question back, over the app, which keeps running; on a TV with a remote,
// the menu screen's own settings (OK five times) have Change device type.
// The app also lists itself on an Android TV's home screen
// (plugins/withTvLauncher.js) and the picker works with a remote's arrows.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { StatusBar } from 'expo-status-bar'
import { NavigationBar } from 'expo-navigation-bar'
import { useKeepAwake } from 'expo-keep-awake'
import * as Print from 'expo-print'
import { CORNER_SCRIPT, inCorner, nextTaps } from './corner'
import { ROLES, roleOf, urlFor as urlOn, hostOf, ours as oursOn, kindOfUrl, staysPut } from './roles'

const EXTRA = Constants.expoConfig?.extra || {}
const ROOT = String(EXTRA.rootDomain || 'macaroonie.com').toLowerCase()
const WEB_DEBUG = !!EXTRA.webDebug
const VERSION = Constants.expoConfig?.version || '1'
const KIND_KEY = 'macaroonie.kind'
const RETRY_SECS = 5
// The picker opened from the hidden corner goes back to the app by itself
// after this long untouched, so a kiosk isn't left on it.
const AUTO_BACK_SECS = 60
const NAVY = '#1f2a44'
const PINK = '#f4a7b9'

// What the device can be and the address of each: roles.js.
const urlFor = kind => urlOn(kind, ROOT)
const ours = host => oursOn(host, ROOT)

export default function App() {
  useKeepAwake()
  // undefined while the saved kind loads, then the kind or null.
  const [kind, setKind] = useState(undefined)
  const [picking, setPicking] = useState(false)
  // Opened from the hidden corner (not the setup screen's button).
  const [fromCorner, setFromCorner] = useState(false)
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

  const openPicker = useCallback(corner => { setFromCorner(corner); setPicking(true) }, [])
  const closePicker = useCallback(() => setPicking(false), [])
  const reload = useCallback(() => setWebKey(n => n + 1), [])
  const reloadAndClose = useCallback(() => { setWebKey(n => n + 1); setPicking(false) }, [])

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
      {kind === undefined ? <Loading /> : (
        <>
          {/* The app stays underneath the picker, so Back to it doesn't reload it. */}
          {startUrl && (
            <Shell
              key={webKey}
              kind={kind}
              url={startUrl}
              onFollow={followed}
              onChooseApp={() => openPicker(false)}
              onDeviceMenu={() => openPicker(true)}
              onReload={reload}
            />
          )}
          {(picking || !startUrl) && (
            <View style={StyleSheet.absoluteFill}>
              <Picker
                current={startUrl ? kind : null}
                onChoose={choose}
                onBack={startUrl ? closePicker : null}
                onReload={startUrl ? reloadAndClose : null}
                autoBack={fromCorner && !!startUrl}
              />
            </View>
          )}
        </>
      )}
    </View>
  )
}

/** The spinner. With onCorner, the hidden corner works on it too (a page that never finishes loading). */
function Loading({ onCorner = null }) {
  const taps = useRef([])
  const onTouchStart = onCorner ? e => {
    const t = e.nativeEvent
    const next = nextTaps(taps.current, Date.now(), inCorner(t.pageX, t.pageY))
    taps.current = next.taps
    if (next.open) onCorner()
  } : undefined
  return (
    <View style={[styles.root, styles.center]} onTouchStart={onTouchStart}>
      <ActivityIndicator size="large" color={PINK} />
    </View>
  )
}

/**
 * What is this device? Asked on the first start, and again from the web
 * app's setup screen or the hidden corner, over the running app (current).
 */
function Picker({ current, onChoose, onBack, onReload, autoBack }) {
  const name = roleOf(current)?.title.toLowerCase()
  const [left, setLeft] = useState(AUTO_BACK_SECS)
  useEffect(() => {
    if (!autoBack) return undefined
    const t = setInterval(() => setLeft(n => n - 1), 1000)
    return () => clearInterval(t)
  }, [autoBack])
  useEffect(() => { if (autoBack && left <= 0 && onBack) onBack() }, [autoBack, left, onBack])
  // Any touch on the picker starts the minute again.
  const stay = autoBack ? () => setLeft(AUTO_BACK_SECS) : undefined
  // The choice a TV remote's arrows are on (no touch on a TV).
  const [focused, setFocused] = useState(null)
  useEffect(() => { if (autoBack && focused) setLeft(AUTO_BACK_SECS) }, [autoBack, focused])
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.pickerWrap} onTouchStart={stay}>
      <Text style={styles.brand}>Macaroonie</Text>
      <Text style={styles.heading}>What is this device?</Text>
      <Text style={styles.lead}>
        {current
          ? `Each type keeps its own link to the restaurant: switching to another type doesn't unlink the ${name}. While another type shows, the ${name} shows as offline in Store tech.`
          : 'Pick one. It opens that app every time the device starts. To change it later, tap the top left corner of the screen five times quickly (on a menu screen with a remote: press OK five times, then Change device type).'}
      </Text>
      <View style={styles.roles}>
        {ROLES.map((r, i) => (
          <Pressable
            key={r.kind}
            onPress={() => onChoose(r.kind)}
            onFocus={() => setFocused(r.kind)}
            onBlur={() => setFocused(f => (f === r.kind ? null : f))}
            focusable
            hasTVPreferredFocus={current ? r.kind === current : i === 0}
            accessibilityRole="button"
            accessibilityLabel={r.title}
            style={({ pressed }) => [styles.role, r.kind === current && styles.roleOn, focused === r.kind && styles.roleFocus, pressed && styles.rolePressed]}
          >
            <Text style={styles.roleTitle}>{r.title}</Text>
            <Text style={styles.roleText}>{r.text}</Text>
            <Text style={styles.roleHost}>{r.sub}.{ROOT}</Text>
          </Pressable>
        ))}
      </View>
      {onBack && (
        <View style={styles.pickerActions}>
          <Pressable onPress={onBack} focusable onFocus={() => setFocused('back')} onBlur={() => setFocused(null)} accessibilityRole="button"
            style={({ pressed }) => [styles.button, focused === 'back' && styles.buttonFocus, pressed && styles.rolePressed]}>
            <Text style={styles.buttonText}>Back to the {name}</Text>
          </Pressable>
          {onReload && (
            <Pressable onPress={onReload} focusable onFocus={() => setFocused('reload')} onBlur={() => setFocused(null)} accessibilityRole="button"
              style={({ pressed }) => [styles.buttonGhost, focused === 'reload' && styles.buttonFocus, pressed && styles.rolePressed]}>
              <Text style={styles.backText}>Reload the {name}</Text>
            </Pressable>
          )}
        </View>
      )}
      {autoBack && onBack && (
        <Text style={styles.note}>Going back to the {name} in {Math.max(0, left)} s.</Text>
      )}
      <Text style={styles.version}>Version {VERSION}</Text>
    </ScrollView>
  )
}

/** The web app, full screen. */
function Shell({ kind, url, onFollow, onChooseApp, onDeviceMenu, onReload }) {
  const [problem, setProblem] = useState(null)
  const kindRef = useRef(kind)
  kindRef.current = kind

  const shouldLoad = useCallback(req => {
    const target = req.url || ''
    if (/^(about:|data:|blob:|javascript:)/i.test(target)) return true
    // Frames inside the page (a video, a payment form) load as they like.
    if (req.isTopFrame === false) return true
    if (ours(hostOf(target))) {
      const k = kindOfUrl(target, ROOT)
      if (k) onFollow(k)
      return true
    }
    // Anywhere else: a kiosk or menu screen stays put; a till or kitchen
    // screen opens the browser (a supplier's site, a help page).
    if (!staysPut(kindRef.current)) Linking.openURL(target).catch(() => {})
    return false
  }, [onFollow])

  const onMessage = useCallback(e => {
    let msg
    try { msg = JSON.parse(e.nativeEvent.data) } catch { return }
    if (msg?.type === 'macaroonie:choose-app') onChooseApp()
    else if (msg?.type === 'macaroonie:device-menu') onDeviceMenu()
    else if (msg?.type === 'macaroonie:print' && typeof msg.html === 'string') {
      Print.printAsync({ html: msg.html }).catch(() => {})
    }
  }, [onChooseApp, onDeviceMenu])

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
      renderLoading={() => <Loading onCorner={onDeviceMenu} />}
      injectedJavaScript={CORNER_SCRIPT}
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
  note: { color: '#9aa3bb', fontSize: 14 },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 8 },
  role: {
    flexGrow: 1, flexBasis: 260, minHeight: 140, padding: 22, borderRadius: 18,
    backgroundColor: '#2b3858', borderWidth: 2, borderColor: '#2b3858', gap: 8,
  },
  roleOn: { borderColor: PINK },
  // A TV remote's arrows are on it.
  roleFocus: { borderColor: '#ffffff', backgroundColor: '#3a4a72' },
  buttonFocus: { borderWidth: 3, borderColor: '#ffffff' },
  rolePressed: { opacity: 0.75 },
  roleTitle: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  roleText: { color: '#d7dcea', fontSize: 15, lineHeight: 21 },
  roleHost: { color: '#9aa3bb', fontSize: 13, marginTop: 'auto' },
  pickerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  backText: { color: PINK, fontSize: 16, fontWeight: '700' },
  version: { color: '#6f7894', fontSize: 12, marginTop: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24, justifyContent: 'center' },
  button: { minHeight: 52, paddingHorizontal: 24, borderRadius: 14, backgroundColor: PINK, justifyContent: 'center' },
  buttonText: { color: NAVY, fontSize: 17, fontWeight: '800' },
  buttonGhost: { minHeight: 52, paddingHorizontal: 20, borderRadius: 14, borderWidth: 2, borderColor: PINK, justifyContent: 'center' },
})
