// Where Macaroonie Office opens and what stays inside it. The app shows the
// phone pages of the admin on ops.<root> (the same build as the office, opened
// on /mobile); office.<root> pages open inside it too. Any other address
// opens in the phone's browser. Kept apart from App.js so the tests can
// check it without React Native.

/** The host of an http(s) address, lower case, or null. */
export function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ''))
  return m ? m[1].toLowerCase() : null
}

/** The phone pages' address, at a path (default the phone app's home). */
export const opsUrl = (root, path = '/mobile') => 'https://ops.' + root + (String(path).startsWith('/') ? path : '/' + path)

/** Whether a page may load in the app: ops. and office. of our domain, https only. */
export function staysInApp(url, root) {
  if (!/^https:\/\//i.test(String(url || '')) && !/^about:blank$/i.test(String(url || ''))) return false
  if (/^about:blank$/i.test(url)) return true
  const host = hostOf(url)
  return host === 'ops.' + root || host === 'office.' + root
}

/** Whether the page asking the bridge for something may have it (the token above all): our pages only. */
export const bridgeAllowed = (url, root) => staysInApp(url, root) && !/^about:/i.test(url)

/**
 * Where a tapped notice opens: the API sends a path of the office (/today);
 * on the phone pages that is /mobile/today. Anything else that is a path of
 * ours opens as it is; anything that isn't a path goes to the phone home.
 */
export function noticeUrl(path, root) {
  const p = String(path || '')
  if (!p.startsWith('/') || p.startsWith('//')) return opsUrl(root)
  if (p === '/today') return opsUrl(root, '/mobile/today')
  return opsUrl(root, p)
}
