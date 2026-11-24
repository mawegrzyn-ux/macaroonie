// Where the phone pages sit on the screen, kept apart from App.js (no React
// Native here) so the tests can check it in Node.
//
// Android (edge to edge from Expo SDK 54) reports the keyboard's height less
// the navigation bar, so the bottom inset is added to it. An iPhone reports
// the whole keyboard, which already covers the home indicator: adding the
// inset would leave a gap above the keyboard.

/** The page's padding: { paddingTop, paddingBottom }. */
export function pagePadding({ os, insets = {}, keyboard = 0 }) {
  const top = insets.top || 0
  const bottom = insets.bottom || 0
  const k = Math.max(0, keyboard || 0)
  if (os === 'ios') return { paddingTop: top, paddingBottom: k > 0 ? k : bottom }
  return { paddingTop: top, paddingBottom: bottom + k }
}

/** The keyboard events to follow: an iPhone's will-events move with the keyboard, Android has only did-events. */
export const keyboardEvents = os => (os === 'ios'
  ? { show: 'keyboardWillShow', hide: 'keyboardWillHide' }
  : { show: 'keyboardDidShow', hide: 'keyboardDidHide' })
