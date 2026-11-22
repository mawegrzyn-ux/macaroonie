// The phone: Home in one column with the ask bar at the bottom, hold to talk
// (the speech is scripted: no microphone), typing as an equal route, the
// camera as a way to capture an invoice for For review, and the person switch
// that comes before any change on a shared tablet.
// Source: reports/AI first back office strategy.md (22 Nov 2026), "The phone:
// short answers, hold to talk, capture", the target flows and decision 6.
App.view('phone', {
  label: 'Phone',
  group: 'Mock-ups',
  render(root) {
    const { icon, esc, el, money, data } = App
    const NOW = '11:48'
    const HOLD_MS = 350                     // shorter than this is a tap
    const venue = data.venues[0]            // Ware
    const me = data.people[0]               // signed in on her own phone
    const FRIDGE = data.fridges[0]          // Walk-in fridge
    const RANGE = [0, 5]
    const supplier = data.suppliers[0]
    const feed = data.tasks.filter(t => t.when === 'late' || t.when === 'now').slice(0, 3)
    const lateN = data.tasks.filter(t => t.when === 'late').length
    const nowN = data.tasks.filter(t => t.when === 'now').length
    const SHIFTS = { anna: '12:00 to 20:00', somchai: '15:00 to 23:00', mia: '17:00 to 23:00' }
    const tonight = data.people.filter(p => SHIFTS[p.id])
    const SAY = [
      { key: 'soldout', say: 'sold out of sea bass' },
      { key: 'takings', say: 'what did we take today' },
      { key: 'rota', say: 'who is on tonight' },
      { key: 'fridge', say: 'walk-in fridge is four point two' },
      { key: 'delete', say: 'delete customer John Smith' },
    ]
    const state = { mode: 'own', actor: me, say: SAY[0], review: venue.review, small: 0, reader: 0 }

    const first = n => String(n).split(' ')[0]
    const initials = n => String(n).split(/\s+/).map(w => w.charAt(0)).join('').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
    const fmt = n => String(Math.round(n * 10) / 10)
    const src = (url, name) => '(<a href="' + url + '" target="_blank" rel="noopener">' + name + '</a>)'
    const mtl = '<span class="tag low">Medium to low confidence</span>'

    // ── What the words mean (a few key words; no model) ─────────
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
    function spokenNumber(t) {
      const d = t.match(/-?\d+(?:[.,]\d+)?/)
      if (d) return parseFloat(d[0].replace(',', '.'))
      const w = WORDS.join('|')
      const m = t.match(new RegExp('\\b(minus )?(' + w + ')(?: point (' + w + '))?\\b'))
      if (!m) return null
      const n = m[3] ? Number(WORDS.indexOf(m[2]) + '.' + WORDS.indexOf(m[3])) : WORDS.indexOf(m[2])
      return m[1] ? -n : n
    }
    function dishKeys(d) {
      const n = d.name.toLowerCase()
      const w = n.split(' ')
      const keys = [n]
      if (w.length > 2) keys.push(w.slice(1).join(' '), w.slice(0, -1).join(' '))
      return keys.concat(keys.map(k => k.replace(/s$/, '')))
    }
    const OTHER_DAY = /yesterday|tomorrow|last|week|month|year|\b(mon|tues|wednes|thurs|fri|satur)day\b/
    function understand(text) {
      const t = String(text).toLowerCase().replace(/\s+/g, ' ').trim()
      if (!t) return null
      if (/\b(delete|erase)\b/.test(t) && /\b(customer|john|smith)\b/.test(t)) return { key: 'delete' }
      if (/fridge|walk[ -]?in/.test(t)) {
        if (/\b(prep|bar|freezer)\b/.test(t)) return null
        return { key: 'fridge', temp: spokenNumber(t.replace(/walk[ -]?in/, '')) }
      }
      const dish = data.dishes.find(d => dishKeys(d).some(k => t.indexOf(k) !== -1))
      if (dish && /sold ?out|out of|\b86\b|r[au]n out|none left|no more/.test(t)) return { key: 'soldout', dish }
      if (/\b(take|took|taken|takings|sales)\b/.test(t) && !OTHER_DAY.test(t)) return { key: 'takings' }
      if (/\bwho\b.*\b(on|in|working)\b|\bwho'?s\b|\brota\b|\btonight\b/.test(t) && !OTHER_DAY.test(t)) return { key: 'rota' }
      return null
    }

    const css = `
      #view-phone .ph-work { gap: 16px; grid-template-columns: minmax(0, 380px) minmax(0, 1fr); grid-template-areas: "ctl ctl" "phone side"; align-items: start; }
      #view-phone .ph-ctl { grid-area: ctl; }
      #view-phone .ph-phone { grid-area: phone; min-width: 0; }
      #view-phone .ph-side { grid-area: side; min-width: 0; align-content: start; }
      @media (max-width: 1180px) {
        #view-phone .ph-work { grid-template-columns: minmax(0, 1fr); grid-template-areas: "ctl" "phone" "side"; }
      }
      #view-phone .ph-grow { flex: 1 1 0; min-width: 0; }
      #view-phone .ph-why { flex: 1 1 240px; min-width: 0; }
      #view-phone .ph-chips .btn { min-height: 48px; }
      #view-phone .callcount { flex-wrap: wrap; }
      #view-phone .ph-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

      #view-phone .ph-body { height: 836px; }
      #view-phone .m-cardlet > header svg, #view-phone .m-diff svg, #view-phone .m-msg svg, #view-phone .m-head svg,
      #view-phone .m-understood svg, #view-phone .ph-chev svg { width: 16px; height: 16px; flex: none; }
      #view-phone .ph-top { display: flex; align-items: center; gap: 10px; padding: 6px 14px 10px; background: var(--m-surface); border-bottom: 1px solid var(--m-line); min-height: 64px; }
      #view-phone .ph-top .what, #view-phone .ph-review .what, #view-phone .ph-rota .what, #view-phone .ph-pinhead .what { flex: 1; min-width: 0; display: grid; gap: 1px; }
      #view-phone .ph-top .what b { font-size: 16px; font-weight: 650; }
      #view-phone .ph-top .what span, #view-phone .ph-review .what span, #view-phone .ph-rota .what span, #view-phone .ph-pinhead .what span { font-size: 12.5px; color: var(--m-muted); }
      #view-phone .ph-av { width: 38px; height: 38px; flex: none; border-radius: 50%; background: var(--m-accent-soft); border: 1px solid var(--m-accent); color: var(--m-primary); font-weight: 700; font-size: 12.5px; display: flex; align-items: center; justify-content: center; }
      #view-phone .ph-main { flex: 1 1 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; grid-auto-rows: max-content; }
      #view-phone .ph-task { width: 100%; background: transparent; border-width: 1px 0 0; border-style: solid; text-align: left; color: var(--m-ink); font-size: 14px; touch-action: manipulation; }
      #view-phone .ph-task:first-child { border-top-width: 0; }
      #view-phone .ph-task:hover, #view-phone .ph-review:hover { background: var(--m-hover); }
      #view-phone .ph-tsub { font-size: 12.5px; color: var(--m-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
      #view-phone em.m-pill { font-style: normal; }
      #view-phone .ph-review { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 60px; padding: 8px 12px; text-align: left; color: var(--m-ink); font-size: 14px; touch-action: manipulation; }
      #view-phone .ph-review .what b { font-weight: 600; }

      #view-phone .ph-thread { display: grid; gap: 8px; }
      #view-phone .ph-thread:empty { display: none; }
      #view-phone .ph-said { justify-self: end; display: grid; justify-items: end; gap: 2px; max-width: 92%; }
      #view-phone .ph-said .m-msg { max-width: 100%; display: flex; align-items: center; gap: 6px; }
      #view-phone .ph-cap { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--m-muted); }
      #view-phone .ph-by { font-size: 12px; color: var(--m-muted); }
      #view-phone .ph-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
      #view-phone .ph-line > b { font-size: 15px; }
      #view-phone .ph-fig { font-size: 30px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      #view-phone .m-understood .m-pill { white-space: normal; height: auto; min-height: 20px; padding-block: 2px; }
      #view-phone .ph-rota { display: grid; }
      #view-phone .ph-rota > div { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-top: 1px solid var(--m-line); }
      #view-phone .ph-rota > div:first-child { border-top: 0; }
      #view-phone .ph-rota .t { font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
      #view-phone .m-cardlet > footer .m-btn { flex: 1 1 auto; }

      #view-phone .ph-shot-in { display: flex; grid-template-columns: none; align-items: center; gap: 14px; overflow: hidden; }
      #view-phone .ph-shot-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
      #view-phone .ph-shot-txt span { font-size: 12.5px; color: var(--m-muted); }
      #view-phone .ph-inv { width: 62px; flex: none; background: var(--m-surface); border: 1px solid var(--m-muted); border-radius: 4px; padding: 8px 7px 10px; display: grid; gap: 5px; transform: rotate(-4deg); animation: ph-drop 0.55s ease-out both; }
      #view-phone .ph-inv i { display: block; height: 3px; border-radius: 2px; background: var(--m-line); }
      #view-phone .ph-inv i.h { height: 6px; width: 62%; background: var(--m-primary); margin-bottom: 2px; }
      #view-phone .ph-inv i.s { width: 70%; }
      #view-phone .ph-inv i.t { width: 44%; margin-left: auto; margin-top: 2px; background: var(--m-ink); }
      @keyframes ph-drop { from { transform: translateY(-64px) rotate(-16deg); opacity: 0; } }
      @keyframes ph-pulse { 50% { opacity: 0.3; } }
      @keyframes ph-nudge { 30% { transform: translateX(-3px); } 60% { transform: translateX(3px); } }

      #view-phone .m-bottom { grid-template-columns: minmax(0, 1fr); }
      #view-phone .ph-askrow { display: flex; align-items: center; gap: 8px; margin: 0; min-width: 0; }
      #view-phone .ph-ask { flex: 1; min-width: 0; }
      #view-phone .ph-ask input { font-size: 16px; min-height: 48px; }
      #view-phone .ph-ask .m-iconbtn, #view-phone .ph-cam { width: 48px; height: 48px; touch-action: manipulation; }
      #view-phone .ph-cam { border: 1px solid var(--m-line); background: var(--m-surface); border-radius: 10px; color: var(--m-ink); }
      #view-phone .ph-rec { display: none; flex: 1; min-width: 0; align-items: center; gap: 8px; min-height: 48px; font-size: 13px; font-weight: 600; line-height: 1.2; color: var(--m-bad); }
      #view-phone .ph-rec i { width: 9px; height: 9px; flex: none; border-radius: 50%; background: var(--m-bad); animation: ph-pulse 1s ease-in-out infinite; }
      #view-phone .ph-ask.rec { border-color: var(--m-bad); }
      #view-phone .ph-ask.rec input, #view-phone .ph-ask.rec .m-iconbtn { display: none; }
      #view-phone .ph-ask.rec .ph-rec { display: flex; }
      #view-phone .m-hold { -webkit-touch-callout: none; }
      #view-phone .ph-tip { position: absolute; right: 10px; bottom: calc(100% + 8px); background: var(--m-ink); color: var(--m-surface); font-size: 13px; font-weight: 600; padding: 7px 11px; border-radius: 8px; white-space: nowrap; animation: ph-nudge 0.3s ease-out; }
      #view-phone .ph-tip::after { content: ""; position: absolute; right: 22px; top: 100%; border: 6px solid transparent; border-top-color: var(--m-ink); }
      #view-phone .mock.phone > .m-toast { bottom: 88px; }
      #view-phone .m-sheet > header .m-iconbtn { width: 48px; height: 48px; }

      #view-phone .ph-switch { position: absolute; inset: 0; z-index: 25; background: var(--m-page); display: flex; flex-direction: column; overflow-y: auto; }
      #view-phone .ph-switch-in { padding: 14px; display: grid; gap: 12px; align-content: start; }
      #view-phone .ph-h { font-size: 18px; font-weight: 650; letter-spacing: -0.01em; }
      #view-phone .ph-sub { color: var(--m-muted); font-size: 13px; }
      #view-phone .ph-pinhead { display: flex; align-items: center; gap: 10px; }
      #view-phone .ph-pinhead .what b { font-size: 16px; font-weight: 650; }
      #view-phone .ph-dots { display: flex; gap: 14px; justify-content: center; padding: 4px 0; }
      #view-phone .ph-dots i { width: 15px; height: 15px; border-radius: 50%; border: 2px solid var(--m-muted); display: block; }
      #view-phone .ph-dots i.on { background: var(--m-primary); border-color: var(--m-primary); }
      #view-phone .ph-pad { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; width: min(100%, 270px); margin-inline: auto; }
      #view-phone .ph-pad .m-btn { min-height: 56px; padding: 0 4px; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
      #view-phone .ph-pad .m-btn.ph-del { font-size: 13px; }
    `

    const understood = pairs => '<div class="m-understood"><span>Understood</span>' + pairs.map(p => '<span class="m-pill">' + esc(p[0]) + ': ' + esc(p[1]) + '</span>').join('') + '</div>'

    root.innerHTML = `
      <style>${css}</style>
      <div class="view-head">
        <span class="eyebrow">Mock-up</span>
        <h1>The phone: short answers, hold to talk, capture</h1>
        <p class="lede">During service a phone is for one figure, who is on, a dish that has run out or a check to log. Home is one column with the ask bar at the bottom, within thumb reach. Voice, typing and the camera are three ways in, and each ends in a card or a form that a person checks.</p>
      </div>

      <div class="stage">
        ${App.brief({
          what: 'The phone app keeps its tiles and gains the same Home in one column. The ask bar sits at the bottom. Speech, typing and a photo all end in a short card or a real form, and nothing changes until a person taps.',
          tryThis: [
            'Press and hold the round button, then let go. The transcript shows first, then the card. Tap <b>Confirm sold out</b>, then <b>Undo</b>.',
            'Pick another example above the phone and hold again. A fridge reading opens the form with the number shown back. A delete is refused.',
            'Type <span class="mono">who is on tonight</span> and press Send. Typing gets the same card.',
            'Tap the camera. The invoice goes to For review.',
            'Choose <b>Shared tablet</b>, tap a name and key any four digits. The header then shows who is acting.',
          ],
          why: [
            { text: 'In one US vendor\'s 2026 assistant logs, 54% of prompts came from phones and 53% arrived during peak lunch or dinner service, against 15% at nightly close. The vendor published no method ' + src('https://pos.toasttab.com/blog/data/q1-2026-restaurant-ai-pos-trends', 'Toast') + '.', confidence: 'low' },
            { text: 'McDonald\'s ended its drive-through voice ordering test and went back to a conventional route ' + src('https://www.nbcnews.com/business/business-news/mcdonalds-end-ai-drive-test-ibm-rcna157603', 'NBC News') + '. Always-listening voice is on the do not build list.', confidence: 'medium' },
            { text: 'Kitchens are loud: one hospital kitchen averaged about 81 dB(A) at peak ' + src('https://jest.utm.my/index.php/jest/article/download/182/111', 'JEST') + '. No independent measurement of speech recognition in a working kitchen was found. Hold to talk is kept to small entries a person can check. ' + mtl },
            { text: 'Menu vocabulary is the main failure point in restaurant speech, on a speech vendor\'s own account ' + src('https://deepgram.com/learn/ai-drive-thru-voice-ai-order-taking', 'Deepgram') + '. So the venue\'s own dish, supplier and staff names go to the step that corrects the transcript. ' + mtl },
          ],
          status: [
            { kind: 'built', text: 'The phone app with its tiles, hold to talk, dictation, and a spoken yes for four check tools, which is off by default.' },
            { kind: 'target', text: 'The same Home in one column, and capture from the camera to For review.' },
            { kind: 'target', text: 'The venue\'s own names for speech correction, the PIN person switch on shared tablets, and Undo after a change.' },
          ],
          calls: 'One short turn on the small model for a spoken or typed request. None for the feed. A photographed invoice is one reader call on the main model.',
        })}

        <div class="stack ph-work">
          <div class="card ph-ctl">
            <div class="row">
              <div class="seg" id="ph-mode" role="group" aria-label="Which device">
                <button type="button" data-mode="own" aria-pressed="true">Own phone</button>
                <button type="button" data-mode="shared" aria-pressed="false">Shared tablet: person switch</button>
              </div>
              <span class="small muted ph-why">On a shared tablet a tap on a name and a short PIN come before any change. The audit trail then names a person, not a device.</span>
            </div>
            <div class="stack" style="gap:6px">
              <span class="eyebrow" id="ph-chips-label">What the next hold to talk hears</span>
              <div class="row ph-chips" id="ph-chips" role="group" aria-labelledby="ph-chips-label">
                ${SAY.map((s, i) => `<button type="button" class="btn" data-k="${s.key}" aria-pressed="${i === 0}">${icon('mic')}${esc(s.say)}</button>`).join('')}
              </div>
            </div>
          </div>

          <div class="ph-phone">
            <div class="mock phone" id="ph-mock">
              <div class="mock-body ph-body">
                <div class="m-status"><span>${NOW}</span><span>4G · 82%</span></div>
                <div class="ph-top">
                  <div class="what"><b id="ph-hello"></b><span id="ph-where"></span></div>
                  <span id="ph-acting"></span>
                </div>
                <div class="m-main ph-main" id="ph-main">
                  <div class="m-card">
                    <div class="m-head">${icon('clock')}Today<span class="count">${lateN} late · ${nowN} now</span></div>
                    <div class="m-list" id="ph-feed">
                      ${feed.map(t => `
                        <button type="button" class="m-task ph-task" data-task="${esc(t.id)}">
                          <span class="m-ico">${icon(t.icon)}</span>
                          <span class="what"><b>${esc(t.title)}</b><span class="ph-tsub"><em class="m-pill ${t.when}">${t.when === 'late' ? 'Late' : 'Now'}</em>${esc(t.sub)}</span></span>
                          ${icon('right')}
                        </button>`).join('')}
                    </div>
                  </div>
                  <button type="button" class="m-card ph-review" id="ph-review">
                    <span class="m-ico">${icon('list')}</span>
                    <span class="what"><b>For review</b><span>Drafts and photos to check</span></span>
                    <em class="m-pill info" id="ph-review-n"></em>
                    <span class="ph-chev">${icon('right')}</span>
                  </button>
                  <div class="ph-thread" id="ph-thread" aria-live="polite"></div>
                </div>
                <div class="m-bottom">
                  <div class="ph-tip" id="ph-tip" hidden>Hold to talk</div>
                  <form class="ph-askrow" id="ph-form" autocomplete="off">
                    <div class="m-ask ph-ask" id="ph-ask">
                      <input type="text" id="ph-text" placeholder="Ask Pepper" aria-label="Ask Pepper" enterkeyhint="send">
                      <span class="ph-rec"><i></i>Recording: let go to send</span>
                      <button type="submit" class="m-iconbtn" aria-label="Send">${icon('send')}</button>
                    </div>
                    <button type="button" class="m-iconbtn ph-cam" id="ph-cam" aria-label="Photograph an invoice">${icon('camera')}</button>
                    <button type="button" class="m-hold" id="ph-hold" aria-label="Hold to talk">${icon('mic')}</button>
                  </form>
                  <span class="ph-sr" id="ph-live" role="status"></span>
                </div>
                <div class="ph-switch" id="ph-switch" role="dialog" aria-label="Who is making this change?" hidden>
                  <div class="m-head">${icon('lock')}Shared tablet · ${esc(venue.name)}<span class="count">Target, not built</span></div>
                  <div class="ph-switch-in" id="ph-switch-in"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="stack ph-side">
            <div class="card">
              <h3>Voice rules</h3>
              <ul class="list">
                <li>Hold to talk only. It is never always listening.</li>
                <li>The transcript shows before anything happens.</li>
                <li>Numbers are shown back before they are saved.</li>
                <li>Destructive actions cannot be confirmed by voice.</li>
                <li>Typing and tapping always work.</li>
              </ul>
            </div>
            <div class="card">
              <h3>What belongs on the phone</h3>
              <ul class="list">
                <li>A quick figure, who is on, a small staffing change, a dish sold out, a check logged.</li>
                <li>Menu builds and set-up stay on a large screen.</li>
                <li>The cash-up at close is a guided, filled form.</li>
              </ul>
            </div>
            <div class="card">
              <h3>What these asks would cost</h3>
              <div class="callcount"><span>Short turns, small model</span><b id="ph-c-small">0</b><span>Reader calls, main model</span><b id="ph-c-reader">0</b></div>
              <p class="small muted">The feed, the tasks and the person switch use no model call.</p>
            </div>
            <p class="note">Example data: ${esc(data.group)}, ${esc(venue.name)}, ${esc(data.today)}. The speech and the photo are scripted. This page uses no microphone and no camera.</p>
          </div>
        </div>
      </div>`

    const $ = s => root.querySelector(s)
    const mock = $('#ph-mock')
    const main = $('#ph-main')
    const thread = $('#ph-thread')
    const askEl = $('#ph-ask')
    const input = $('#ph-text')
    const hold = $('#ph-hold')
    const tip = $('#ph-tip')
    const live = $('#ph-live')
    const sw = $('#ph-switch')
    const swIn = $('#ph-switch-in')
    let timer = 0
    let tipTimer = 0

    const scrollEnd = () => { main.scrollTop = main.scrollHeight }
    const drawCounts = () => {
      $('#ph-c-small').textContent = state.small
      $('#ph-c-reader').textContent = state.reader
      $('#ph-review-n').textContent = state.review + ' waiting'
    }
    function drawTop() {
      const shared = state.mode === 'shared'
      $('#ph-hello').textContent = !shared ? 'Good morning, ' + first(me.name) : state.actor ? 'Acting: ' + state.actor.name : 'Shared tablet'
      $('#ph-where').textContent = !shared ? venue.name + ' · ' + data.today : state.actor ? 'Shared tablet · ' + venue.name : venue.name + ' · nobody chosen yet'
      $('#ph-acting').innerHTML = shared
        ? '<button type="button" class="m-btn" id="ph-who">' + icon(state.actor ? 'users' : 'lock') + (state.actor ? 'Switch' : 'Choose person') + '</button>'
        : '<span class="ph-av" aria-hidden="true">' + esc(initials(me.name)) + '</span>'
    }
    function showTip(text) {
      clearTimeout(tipTimer)
      tip.textContent = text
      tip.hidden = false
      live.textContent = text
      tipTimer = setTimeout(() => { tip.hidden = true }, 2400)
    }

    // ── The person switch (shared tablet) ───────────────────────
    let pending = null      // the change that waits for a person
    let picked = null
    let pin = ''
    let locking = false
    function drawSwitch() {
      const why = '<p class="m-understood">' + icon('shield') + '<span>The audit trail then names a person, not a device.</span></p>'
      if (!picked) {
        swIn.innerHTML = `
          <div class="ph-h">Who is making this change?</div>
          <p class="ph-sub">Tap your name, then key your PIN. This comes before any change on a shared tablet.</p>
          <div class="m-card"><div class="m-list">
            ${data.people.map(p => `<button type="button" class="m-task ph-task" data-p="${esc(p.id)}"><span class="ph-av" aria-hidden="true">${esc(initials(p.name))}</span><span class="what"><b>${esc(p.name)}</b><span>${esc(p.role)} · ${esc(p.venue)}</span></span>${icon('right')}</button>`).join('')}
          </div></div>
          ${why}
          <p class="ph-by">A till PIN is enough to log checks and nothing else.</p>
          <button type="button" class="m-btn ghost" data-a="home">Back to Home</button>`
        return
      }
      pin = ''
      swIn.innerHTML = `
        <div class="ph-pinhead"><span class="ph-av" aria-hidden="true">${esc(initials(picked.name))}</span><div class="what"><b>${esc(picked.name)}</b><span>${esc(picked.role)}</span></div></div>
        <p class="ph-sub">Key your four-digit PIN. This mock-up accepts any four digits.</p>
        <div class="ph-dots" id="ph-dots" role="img" aria-label="0 of 4 digits keyed"><i></i><i></i><i></i><i></i></div>
        <div class="ph-pad" id="ph-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button type="button" class="m-btn" data-d="${d}">${d}</button>`).join('')}
          <span></span><button type="button" class="m-btn" data-d="0">0</button><button type="button" class="m-btn ph-del" data-d="del" aria-label="Delete the last digit">Delete</button>
        </div>
        ${why}
        <button type="button" class="m-btn ghost" data-a="names">Choose another name</button>`
    }
    function openSwitch(next) {
      pending = next || null
      picked = null
      locking = false
      drawSwitch()
      sw.hidden = false
      sw.scrollTop = 0
    }
    function closeSwitch() { pending = null; sw.hidden = true }
    function accept(person) {
      state.actor = person
      sw.hidden = true
      drawTop()
      App.toast(mock, 'Changes are now recorded as ' + person.name + '.')
      const next = pending
      pending = null
      if (next) next()
    }
    function keyPin(d) {
      if (!picked || locking || sw.hidden) return
      if (d === 'del') pin = pin.slice(0, -1)
      else if (pin.length < 4) pin += d
      const dots = swIn.querySelectorAll('#ph-dots i')
      dots.forEach((dot, i) => dot.classList.toggle('on', i < pin.length))
      const box = swIn.querySelector('#ph-dots')
      if (box) box.setAttribute('aria-label', pin.length + ' of 4 digits keyed')
      if (pin.length === 4) {
        locking = true
        const who = picked
        setTimeout(() => { locking = false; if (!sw.hidden && picked === who) accept(who) }, 260)
      }
    }
    /** Runs a change now, or after the person switch on a shared tablet. */
    function requireActor(next) {
      if (state.mode === 'shared' && !state.actor) openSwitch(next)
      else next()
    }
    sw.addEventListener('click', e => {
      const p = e.target.closest('[data-p]')
      const d = e.target.closest('[data-d]')
      const a = e.target.closest('[data-a]')
      if (p) {
        picked = data.people.find(x => x.id === p.dataset.p) || null
        drawSwitch()
        const one = swIn.querySelector('[data-d="1"]')
        if (one) one.focus({ preventScroll: true })
      } else if (d) keyPin(d.dataset.d)
      else if (a && a.dataset.a === 'names') { picked = null; drawSwitch() }
      else if (a) closeSwitch()
    })
    sw.addEventListener('keydown', e => {
      if (/^[0-9]$/.test(e.key)) keyPin(e.key)
      else if (e.key === 'Backspace') keyPin('del')
      else if (e.key === 'Escape') closeSwitch()
    })

    // ── The cards Pepper answers with (all scripted) ────────────
    function saidEl(via, text) {
      return el('<div class="ph-said"><span class="ph-cap">' + (via === 'voice' ? 'Transcript' : 'You typed') + '</span><div class="m-msg me">' + (via === 'voice' ? icon('mic') : '') + '<span>' + esc(text) + '</span></div></div>')
    }
    function soldOutCard(dish) {
      const card = el('<div class="m-cardlet"></div>')
      const where = 'till, online ordering, menu screens'
      const ask = () => {
        card.innerHTML = `
          <header>${icon('utensils')}<span class="ph-grow">Mark as sold out</span><span class="m-pill pepper">Waits for your tap</span></header>
          <div class="m-pad">
            <div class="ph-line"><b>${esc(dish.name)}</b><span class="m-diff"><s>On sale</s>${icon('right')}<b>Sold out</b></span></div>
            ${understood([['Dish', dish.name], ['Venue', venue.name], ['Applies to', where]])}
          </div>
          <footer><button type="button" class="m-btn primary" data-a="yes">Confirm sold out</button><button type="button" class="m-btn" data-a="no">Cancel</button></footer>`
      }
      const done = () => {
        card.innerHTML = `
          <header>${icon('check')}<span class="ph-grow">Done</span><span class="m-pill ok">Sold out</span></header>
          <div class="m-pad"><p><b>${esc(dish.name)}</b> is sold out at ${esc(venue.name)} on the till, online ordering and menu screens.</p><p class="ph-by">By ${esc(state.actor.name)} · ${NOW}</p></div>
          <footer><button type="button" class="m-btn" data-a="undo">${icon('undo')}Undo</button></footer>`
        scrollEnd()
      }
      const back = () => {
        card.innerHTML = `
          <header>${icon('undo')}<span class="ph-grow">Put back</span><span class="m-pill">On sale</span></header>
          <div class="m-pad"><p><b>${esc(dish.name)}</b> is on sale again at ${esc(venue.name)} on the till, online ordering and menu screens.</p><p class="ph-by">Undone by ${esc(state.actor.name)} · ${NOW}</p></div>`
      }
      card.addEventListener('click', e => {
        const b = e.target.closest('[data-a]')
        if (!b) return
        if (b.dataset.a === 'yes') requireActor(done)
        else if (b.dataset.a === 'undo') requireActor(back)
        else card.innerHTML = '<header>' + icon('x') + '<span class="ph-grow">Cancelled</span></header><div class="m-pad"><p>Nothing was changed.</p></div>'
      })
      ask()
      return card
    }
    function takingsCard() {
      const card = el(`<div class="m-cardlet">
        <header>${icon('chart')}<span class="ph-grow">Net sales today</span></header>
        <div class="m-pad"><div class="ph-fig">${money(21460)}</div>${understood([['Counted', 'net sales'], ['Venue', venue.name], ['When', 'today so far, to ' + NOW]])}</div>
        <footer><button type="button" class="m-btn">Open report${icon('right')}</button></footer></div>`)
      card.querySelector('footer .m-btn').addEventListener('click', () => App.toast(mock, 'Opens the sales report on today\'s rows. Not part of this mock-up.'))
      return card
    }
    function rotaCard() {
      const card = el(`<div class="m-cardlet">
        <header>${icon('users')}<span class="ph-grow">On tonight</span><span class="m-pill">${tonight.length} people</span></header>
        <div class="ph-rota">${tonight.map(p => `<div><span class="what"><b>${esc(p.name)}</b><span>${esc(p.role)}</span></span><span class="t">${SHIFTS[p.id]}</span></div>`).join('')}</div>
        <div class="m-pad">${understood([['Venue', venue.name], ['Day', data.today]])}</div>
        <footer><button type="button" class="m-btn">Open rota${icon('right')}</button></footer></div>`)
      card.querySelector('footer .m-btn').addEventListener('click', () => App.toast(mock, 'Opens the rota at ' + venue.name + ' on today. Not part of this mock-up.'))
      return card
    }
    function deleteCard(via) {
      const card = el(`<div class="m-cardlet">
        <header>${icon('lock')}<span class="ph-grow">${via === 'voice' ? 'Not done by voice' : 'Not done from the ask bar'}</span></header>
        <div class="m-pad"><p>${via === 'voice' ? 'Deleting a customer cannot be done by voice.' : 'Deleting a customer is not done from here.'} It removes a person's details for good, so it is done on its own screen and asked twice.</p>${understood([['Customer', 'John Smith'], ['Asked for', 'delete']])}</div>
        <footer><button type="button" class="m-btn">Open John Smith on screen${icon('right')}</button></footer></div>`)
      card.querySelector('footer .m-btn').addEventListener('click', () => App.toast(mock, 'Opens the customer\'s page. Not part of this mock-up.'))
      return card
    }
    function fridgeCard(via, temp) {
      const card = el('<div class="m-cardlet"></div>')
      const heard = temp == null ? '' : (via === 'voice' ? 'You said ' : 'You typed ') + fmt(temp) + ' °C'
      let saved = null
      const draw = () => {
        card.innerHTML = saved
          ? `<header>${icon('check')}<span class="ph-grow">Saved</span><span class="m-pill ${saved.ok ? 'ok' : 'late'}">${saved.ok ? 'In range' : 'Out of range'}</span></header>
             <div class="m-pad"><p><b>${esc(FRIDGE)}</b>: ${esc(fmt(saved.n))} °C</p>${saved.fix ? '<p>Action taken: ' + esc(saved.fix) + '</p>' : ''}<p class="ph-by">Saved by ${esc(saved.by)} · ${NOW}</p></div>`
          : `<header>${icon('thermometer')}<span class="ph-grow">Fridge check</span><span class="m-pill now">Not saved yet</span></header>
             <div class="m-pad"><p><b>${esc(FRIDGE)}</b>${heard ? ' · ' + esc(heard) : ''}</p>${via === 'tap' ? '' : understood([['Form', 'Fridge check'], ['Unit', FRIDGE], ['Venue', venue.name]])}</div>
             <footer><button type="button" class="m-btn primary" data-a="open">Open form</button></footer>`
      }
      const open = () => {
        const made = App.sheet(mock, {
          title: 'Fridge check',
          body: `
            ${heard ? '<div class="m-understood"><span class="m-pill pepper">' + esc(heard) + '</span><span>Check it against the display.</span></div>' : ''}
            <div class="m-field ${heard ? 'filled' : ''}">
              <label for="ph-fr-temp">${esc(FRIDGE)}: temperature in °C</label>
              <input class="m-input" id="ph-fr-temp" type="text" inputmode="decimal" autocomplete="off" value="${temp == null ? '' : esc(fmt(temp))}">
              <span class="help">This fridge should read ${RANGE[0]} to ${RANGE[1]} °C.</span>
              <span class="err" id="ph-fr-err" hidden>Type the temperature you read.</span>
            </div>
            <div class="m-field" id="ph-fr-fixwrap" hidden>
              <label for="ph-fr-fix">Out of range. What did you do about it?</label>
              <textarea class="m-textarea" id="ph-fr-fix"></textarea>
              <span class="err" id="ph-fr-fixerr" hidden>Say what you did before you save.</span>
            </div>
            <p class="ph-by">Nothing is saved until you tap Save check.</p>`,
          actions: [
            { label: 'Cancel', kind: 'ghost' },
            {
              label: 'Save check', kind: 'primary', onClick(sh, close) {
                const r = read(sh)
                sh.querySelector('#ph-fr-err').hidden = !isNaN(r.n)
                field(sh).classList.toggle('error', isNaN(r.n))
                if (isNaN(r.n)) { sh.querySelector('#ph-fr-temp').focus(); return }
                sh.querySelector('#ph-fr-fixwrap').hidden = r.ok
                const fix = sh.querySelector('#ph-fr-fix').value.trim()
                sh.querySelector('#ph-fr-fixerr').hidden = r.ok || !!fix
                if (!r.ok && !fix) { sh.querySelector('#ph-fr-fix').focus(); return }
                requireActor(() => { saved = { n: r.n, ok: r.ok, fix: r.ok ? '' : fix, by: state.actor.name }; close(); draw(); scrollEnd() })
              },
            },
          ],
        })
        const field = sh => sh.querySelector('.m-field')
        const read = sh => {
          const raw = sh.querySelector('#ph-fr-temp').value.trim().replace(',', '.')
          const n = raw === '' ? NaN : Number(raw)
          return { n, ok: !isNaN(n) && n >= RANGE[0] && n <= RANGE[1] }
        }
        made.sheet.querySelector('#ph-fr-temp').addEventListener('input', () => {
          const r = read(made.sheet)
          field(made.sheet).classList.remove('filled', 'error')   // the person has touched it
          made.sheet.querySelector('#ph-fr-err').hidden = true
          made.sheet.querySelector('#ph-fr-fixwrap').hidden = isNaN(r.n) || r.ok
        })
        if (temp != null && (temp < RANGE[0] || temp > RANGE[1])) made.sheet.querySelector('#ph-fr-fixwrap').hidden = false
      }
      card.addEventListener('click', e => { if (e.target.closest('[data-a="open"]')) open() })
      draw()
      return { card, open }
    }

    /** One ask, spoken or typed: the words first, then the card. */
    function respond(via, text, instant) {
      clearTimeout(timer)
      const u = understand(text)
      thread.innerHTML = ''
      thread.appendChild(saidEl(via, text))
      scrollEnd()
      const answer = () => {
        if (!u) {
          thread.appendChild(el('<div class="m-msg pepper">This mock-up only knows the examples above.</div>'))
          scrollEnd()
          return
        }
        state.small += 1
        drawCounts()
        const fridge = u.key === 'fridge' ? fridgeCard(via, u.temp) : null
        thread.appendChild(fridge ? fridge.card : u.key === 'soldout' ? soldOutCard(u.dish) : u.key === 'takings' ? takingsCard() : u.key === 'rota' ? rotaCard() : deleteCard(via))
        scrollEnd()
        if (fridge) fridge.open()
      }
      if (instant) answer()
      else timer = setTimeout(answer, 450)
    }
    function capture() {
      clearTimeout(timer)
      state.review += 1
      state.reader += 1
      drawCounts()
      thread.innerHTML = ''
      const card = el(`<div class="m-cardlet">
        <header>${icon('camera')}<span class="ph-grow">Photo taken</span><span class="m-pill info">For review</span></header>
        <div class="m-pad ph-shot-in">
          <div class="ph-inv" role="img" aria-label="A drawing of the photographed invoice"><i class="h"></i><i></i><i class="s"></i><i></i><i class="s"></i><i></i><i class="t"></i></div>
          <div class="ph-shot-txt"><b>Sent to For review</b><span>Invoice from ${esc(supplier.name)}. Its lines are read for a person to check. Nothing is saved until it is approved.</span></div>
        </div>
        <footer><button type="button" class="m-btn primary">Open For review${icon('right')}</button></footer></div>`)
      card.querySelector('footer .m-btn').addEventListener('click', () => App.go('review'))
      thread.appendChild(card)
      live.textContent = 'Photo taken. Sent to For review.'
      scrollEnd()
    }

    // ── Hold to talk: press, speak (scripted), let go ───────────
    let rec = false
    let t0 = 0
    let lastHold = 0
    function startRec() {
      if (rec) return
      rec = true
      t0 = lastHold = Date.now()
      clearTimeout(tipTimer)
      tip.hidden = true
      hold.classList.add('rec')
      askEl.classList.add('rec')
      live.textContent = 'Recording: let go to send'
    }
    function endRec(send) {
      if (!rec) return
      rec = false
      lastHold = Date.now()
      hold.classList.remove('rec')
      askEl.classList.remove('rec')
      live.textContent = ''
      if (!send) return
      if (lastHold - t0 < HOLD_MS) showTip('Hold to talk')
      else respond('voice', state.say.say)
    }
    const talkKey = e => e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter'
    hold.addEventListener('pointerdown', e => {
      if (e.button) return
      try { hold.setPointerCapture(e.pointerId) } catch (err) { /* an old browser: the hold still works */ }
      startRec()
    })
    hold.addEventListener('pointerup', () => endRec(true))
    hold.addEventListener('pointercancel', () => endRec(false))
    hold.addEventListener('contextmenu', e => e.preventDefault())
    hold.addEventListener('keydown', e => { if (talkKey(e)) { e.preventDefault(); if (!e.repeat) startRec() } })
    hold.addEventListener('keyup', e => { if (talkKey(e)) { e.preventDefault(); endRec(true) } })
    hold.addEventListener('blur', () => endRec(false))
    // A click with no press before it (a screen reader, a switch): it cannot hold, so say how.
    hold.addEventListener('click', () => { if (Date.now() - lastHold > 700) showTip('Hold to talk') })

    // ── Typing, the camera, the feed, the controls ──────────────
    $('#ph-form').addEventListener('submit', e => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) { input.focus(); return }
      input.value = ''
      respond('typed', text)
    })
    $('#ph-cam').addEventListener('click', capture)
    $('#ph-review').addEventListener('click', () => App.go('review'))
    $('#ph-feed').addEventListener('click', e => {
      const b = e.target.closest('[data-task]')
      if (!b) return
      const task = data.tasks.find(t => t.id === b.dataset.task)
      if (task && task.form === 'fridges') {
        clearTimeout(timer)
        thread.innerHTML = ''
        const fridge = fridgeCard('tap', null)
        thread.appendChild(fridge.card)
        scrollEnd()
        fridge.open()
      } else App.toast(mock, 'This task opens its form. The Home mock-up shows that.')
    })
    $('#ph-acting').addEventListener('click', e => { if (e.target.closest('#ph-who')) openSwitch(null) })
    $('#ph-chips').addEventListener('click', e => {
      const b = e.target.closest('button')
      if (!b) return
      state.say = SAY.find(s => s.key === b.dataset.k) || SAY[0]
      root.querySelectorAll('#ph-chips button').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
    })
    $('#ph-mode').addEventListener('click', e => {
      const b = e.target.closest('button')
      if (!b || b.dataset.mode === state.mode) return
      state.mode = b.dataset.mode
      state.actor = state.mode === 'own' ? me : null
      root.querySelectorAll('#ph-mode button').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
      drawTop()
      if (state.mode === 'shared') openSwitch(null)
      else closeSwitch()
    })

    // At rest: Home with the first example already heard and waiting for a tap.
    drawTop()
    respond('voice', SAY[0].say, true)
    main.scrollTop = 0
  },
})
