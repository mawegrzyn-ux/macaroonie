// The hidden way back to "What is this device?": five quick taps in the top
// left corner of the screen. Taps aren't taken from the page (the till's
// venue name or first tab, the kitchen screen's All tab, the kiosk's logo
// strip or first section sit there, and a few extra taps on them do no
// harm), so the web app works exactly as in a browser.
//
// Counted in two places, by the same rule: in the web page by CORNER_SCRIPT
// (injected into every page the WebView loads; it posts
// macaroonie:device-menu) and natively by nextTaps() while the page is still
// loading. Hermes keeps no function source, so the script can't be made from
// nextTaps() itself: change both together (test/corner.test.mjs checks both).

/** The corner's size, in screen dp. */
export const CORNER_DP = 56
/** How many taps, and within how long. */
export const CORNER_TAPS = 5
export const CORNER_WINDOW_MS = 3000

/**
 * One touch: the taps still counted after it, and whether this one opens
 * the menu. A touch outside the corner starts again.
 */
export function nextTaps(taps, now, inCorner) {
  if (!inCorner) return { taps: [], open: false }
  const kept = taps.filter(t => now - t <= CORNER_WINDOW_MS)
  kept.push(now)
  if (kept.length >= CORNER_TAPS) return { taps: [], open: true }
  return { taps: kept, open: false }
}

/** Is a touch at (x, y) dp in the corner? */
export const inCorner = (x, y) => x <= CORNER_DP && y <= CORNER_DP

// The page's CSS pixels can be bigger or smaller than dp (the kiosk zooms to
// its design's size through the viewport tag), so the corner is measured in
// CSS pixels divided by the page's scale. Listens in the capture phase so a
// page that stops a touch from bubbling still counts it. Ends with true, as
// react-native-webview asks of injected code.
export const CORNER_SCRIPT = `(function () {
  if (window.__macaroonieCorner) return;
  window.__macaroonieCorner = true;
  var taps = [];
  window.addEventListener('pointerdown', function (e) {
    if (e.isPrimary === false) return;
    var scale = (window.visualViewport && window.visualViewport.scale) || 1;
    var size = ${CORNER_DP} / scale;
    var now = Date.now();
    if (e.clientX > size || e.clientY > size) { taps = []; return; }
    taps = taps.filter(function (t) { return now - t <= ${CORNER_WINDOW_MS}; });
    taps.push(now);
    if (taps.length < ${CORNER_TAPS}) return;
    taps = [];
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'macaroonie:device-menu' })); } catch (err) {}
  }, true);
})();
true;`
