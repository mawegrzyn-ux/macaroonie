// The bridge between the phone pages and the app (admin/src/lib/officeApp.jsx
// is the page's side). BRIDGE_SCRIPT runs in the page before it loads and
// makes window.MacaroonieOffice; each call posts { id, type, args } to the
// app, which answers through window.__macaOffice.reply(id, ok, value), and
// sends speech events through window.__macaOffice.event(id, name, value).
// makeHandler() is the app's side: it routes a message to the app's own
// services and says what to run in the page. Kept apart from App.js (no
// React Native here) so the tests can run it in Node.

export const BRIDGE_VERSION = 1

// Calls the page may make, and the service that answers each.
export const CALLS = {
  'auth.token':          s => s.auth.token(),
  'auth.user':           s => s.auth.user(),
  'auth.signIn':         s => s.auth.signIn(),
  'auth.signOut':        s => s.auth.signOut(),
  'push.token':          s => s.push.token(),
  'speech.speak':        (s, a) => s.speech.speak(a),
  'speech.stopSpeaking': s => s.speech.stopSpeaking(),
  'scan':                s => s.scanner.scan(),
}

/** platform: 'android' | 'ios' (React Native's Platform.OS), shown to the page as MacaroonieOffice.platform. */
export function bridgeScript(version, platform = 'android') {
  return `(function () {
  if (window.MacaroonieOffice) return;
  var seq = 0, waiting = {}, listeners = {};
  function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
  function call(type, args) {
    return new Promise(function (resolve, reject) {
      var id = 'c' + (++seq);
      waiting[id] = { resolve: resolve, reject: reject };
      post({ id: id, type: type, args: args || {} });
    });
  }
  window.__macaOffice = {
    reply: function (id, ok, value) {
      var w = waiting[id]; if (!w) return; delete waiting[id];
      if (ok) w.resolve(value); else w.reject(new Error(value || 'The app could not do that.'));
    },
    event: function (id, name, value) {
      var l = listeners[id]; if (!l) return;
      if (name === 'text' && l.onText) l.onText(value.text, !!value.final);
      if (name === 'error' && l.onError) l.onError(value);
      if (name === 'end') { delete listeners[id]; if (l.onEnd) l.onEnd(); }
    }
  };
  window.MacaroonieOffice = {
    version: ${JSON.stringify(String(version || BRIDGE_VERSION))},
    platform: ${JSON.stringify(platform === 'ios' ? 'ios' : 'android')},
    auth: {
      token: function () { return call('auth.token'); },
      user: function () { return call('auth.user'); },
      signIn: function () { return call('auth.signIn'); },
      signOut: function () { return call('auth.signOut'); }
    },
    push: { token: function () { return call('push.token'); } },
    speech: {
      listen: function (o) {
        o = o || {};
        var id = 'l' + (++seq);
        listeners[id] = { onText: o.onText, onEnd: o.onEnd, onError: o.onError };
        post({ id: id, type: 'speech.listen', args: { lang: o.lang, continuous: !!o.continuous, hints: Array.isArray(o.hints) ? o.hints.slice(0, 300) : undefined } });
        return function () { post({ id: id, type: 'speech.stop', args: {} }); };
      },
      speak: function (o) { return call('speech.speak', o); },
      stopSpeaking: function () { return call('speech.stopSpeaking'); }
    },
    scanner: { scan: function () { return call('scan'); } }
  };
})(); true;`
}

const js = v => JSON.stringify(v === undefined ? null : v)
export const replyScript = (id, ok, value) => `window.__macaOffice && window.__macaOffice.reply(${js(id)}, ${ok ? 'true' : 'false'}, ${js(value)}); true;`
export const eventScript = (id, name, value) => `window.__macaOffice && window.__macaOffice.event(${js(id)}, ${js(name)}, ${js(value)}); true;`

/**
 * The app's side. services: { auth, push, speech, scanner } (speech.listen
 * takes { lang, continuous, hints, onText, onEnd, onError } and returns stop();
 * hints: the venue's own words, cleanHints());
 * run(script)
 * runs JavaScript in the page; allowed(url) says whether the page the
 * message came from may use the bridge. Returns handle(data, url).
 */
/** The venue's words a page asks the recogniser to expect: strings only, capped. */
export const MAX_HINTS = 300
export const HINT_MAX = 60
export function cleanHints(list) {
  if (!Array.isArray(list)) return undefined
  const out = list.filter(h => typeof h === 'string').map(h => h.trim()).filter(h => h && h.length <= HINT_MAX).slice(0, MAX_HINTS)
  return out.length ? out : undefined
}

export function makeHandler({ services, run, allowed }) {
  const stops = new Map()
  return async function handle(data, url) {
    let msg
    try { msg = JSON.parse(data) } catch { return }
    if (!msg || typeof msg.id !== 'string' || typeof msg.type !== 'string') return
    if (!allowed(url)) { run(replyScript(msg.id, false, 'Not on a Macaroonie page.')); return }
    if (msg.type === 'speech.listen') {
      const stop = services.speech.listen({
        lang: msg.args?.lang,
        continuous: !!msg.args?.continuous,
        hints: cleanHints(msg.args?.hints),
        onText: (text, final) => run(eventScript(msg.id, 'text', { text, final: !!final })),
        onError: message => run(eventScript(msg.id, 'error', String(message || 'Couldn\'t hear that.'))),
        onEnd: () => { stops.delete(msg.id); run(eventScript(msg.id, 'end', null)) },
      })
      stops.set(msg.id, stop)
      return
    }
    if (msg.type === 'speech.stop') { stops.get(msg.id)?.(); return }
    const fn = CALLS[msg.type]
    if (!fn) { run(replyScript(msg.id, false, 'The app doesn\'t know ' + msg.type + '.')); return }
    try {
      run(replyScript(msg.id, true, await fn(services, msg.args || {})))
    } catch (e) {
      run(replyScript(msg.id, false, e?.message || String(e)))
    }
  }
}
