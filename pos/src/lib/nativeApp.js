// The Macaroonie Android app (android-app/ in the repository) shows the till,
// the kitchen screen and the kiosk in a WebView. Inside it the page can talk
// to the app: printing goes to Android's print service (a WebView can't print
// a page itself), and the setup screen can ask the app to pick another kind
// of device. In a browser none of this exists and nothing changes.

/** Is this page running inside the Macaroonie Android app? */
export const IN_APP = typeof window !== 'undefined' && !!window.ReactNativeWebView

/** Send the app a message ({ type, ... }). False when not in the app. */
export function tellApp(message) {
  if (!IN_APP) return false
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}
