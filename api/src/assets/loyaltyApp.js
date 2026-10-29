// api/src/assets/loyaltyApp.js, served as /loyalty-api/app.js
//
// The loyalty card for guests: join or sign in with an emailed code, the QR
// card with points, stamp cards, rewards, history, wallet buttons and the
// member's own settings (GDPR download, new card code, leave). One copy for
// every place a guest sees their card:
//   - the loyalty web app (views/site/loyalty.eta, loyalty.<domain>/<slug>)
//   - the website's Loyalty card block (views/site/blocks/loyalty_card.eta),
//     on the built-in /loyalty page or any other page
// It talks to /loyalty-api/t/<slug> on whatever host it is on and keeps the
// sign-in in localStorage (mcrn_loyalty_<slug>), shared with the ordering
// page's loyalty box (views/site/shared/ordering.eta).
//
// Plain browser JavaScript, no build step. Styles are scoped to .mloy and
// coloured by CSS variables the host page sets on an ancestor:
//   --mloy-primary --mloy-on-primary --mloy-bg --mloy-surface --mloy-text
//   --mloy-muted --mloy-border --mloy-card-bg --mloy-card-text --mloy-card-accent
//   (and optionally --mloy-title-font, --mloy-title-size)

import { qrSvg } from './qr.js'

export const LOYALTY_CSS = `
.mloy { color: var(--mloy-text, #1f2937); font-size: 16px; line-height: 1.45; text-align: left; }
.mloy *, .mloy *::before, .mloy *::after { box-sizing: border-box; }
.mloy .mloy-title { font-size: var(--mloy-title-size, 26px); margin: 12px 0 6px; line-height: 1.15; color: inherit; font-family: var(--mloy-title-font, inherit); text-transform: none; letter-spacing: 0; }
.mloy .mloy-h2 { font-size: 17px; margin: 0 0 10px; line-height: 1.3; color: inherit; font-family: inherit; font-weight: 700; text-transform: none; letter-spacing: 0; }
.mloy .mloy-p { line-height: 1.45; margin: 0 0 12px; }
.mloy .mloy-muted { color: var(--mloy-muted, #6b7280); font-size: 14px; }
.mloy .mloy-how { margin: 0 0 12px; padding-left: 20px; }
.mloy .mloy-how li { margin: 2px 0; }
.mloy .mloy-box { background: var(--mloy-surface, #fff); color: var(--mloy-text, #1f2937); border: 1px solid var(--mloy-border, #e5e7eb); border-radius: 14px; padding: 16px; margin: 14px 0; }
.mloy .mloy-label { display: block; font-size: 14px; font-weight: 600; margin: 12px 0 6px; color: inherit; }
.mloy .mloy-input {
  display: block; width: 100%; min-height: 48px; font-size: 16px; padding: 10px 12px; border: 1px solid var(--mloy-border, #e5e7eb);
  border-radius: 10px; background: #fff; color: #111; font-family: inherit; margin: 0;
}
.mloy .mloy-input.mloy-code { letter-spacing: 8px; font-size: 26px; text-align: center; font-variant-numeric: tabular-nums; }
.mloy .mloy-check { display: flex; gap: 10px; align-items: flex-start; margin: 12px 0; font-size: 14px; line-height: 1.4; font-weight: 400; cursor: pointer; }
.mloy .mloy-check input { width: 22px; height: 22px; margin: 0; flex: 0 0 auto; }
.mloy .mloy-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 0 18px;
  font-size: 15px; font-weight: 600; border-radius: 10px; border: 0; cursor: pointer; touch-action: manipulation; font-family: inherit;
  background: var(--mloy-primary, #630812); color: var(--mloy-on-primary, #fff); text-decoration: none; width: 100%; margin: 14px 0 0;
  text-transform: none; letter-spacing: 0; line-height: 1.2; box-shadow: none;
}
.mloy .mloy-btn.mloy-ghost { background: transparent; color: inherit; border: 1px solid var(--mloy-border, #e5e7eb); }
.mloy .mloy-btn.mloy-danger { background: #b91c1c; color: #fff; }
.mloy .mloy-btn[disabled] { opacity: .5; cursor: default; }
.mloy .mloy-err { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 10px 12px; font-size: 14px; margin: 12px 0 0; }
.mloy .mloy-ok { color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 10px 12px; font-size: 14px; margin: 12px 0 0; }
.mloy .mloy-card { background: var(--mloy-card-bg, #1f2937); color: var(--mloy-card-text, #fff); border-radius: 18px; padding: 18px; margin: 14px 0; box-shadow: 0 6px 22px rgba(0,0,0,.12); }
.mloy .mloy-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.mloy .mloy-card-label { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--mloy-card-accent, currentColor); font-weight: 700; }
.mloy .mloy-pts { font-size: 34px; font-weight: 800; line-height: 1.05; }
.mloy .mloy-name { font-size: 18px; font-weight: 700; }
.mloy .mloy-qr { background: #fff; border-radius: 12px; padding: 10px; margin: 16px auto 6px; width: min(240px, 70vw); }
.mloy .mloy-qr svg { display: block; width: 100%; height: auto; }
.mloy .mloy-no { text-align: center; font-variant-numeric: tabular-nums; letter-spacing: 2px; font-size: 15px; opacity: .9; }
.mloy .mloy-wallets { display: flex; gap: 10px; flex-wrap: wrap; }
.mloy .mloy-wallets .mloy-btn { flex: 1 1 160px; background: #000; color: #fff; width: auto; }
.mloy .mloy-stamps { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 4px; }
.mloy .mloy-stamp { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--mloy-primary, #630812); }
.mloy .mloy-stamp.mloy-on { background: var(--mloy-primary, #630812); }
.mloy .mloy-reward { display: flex; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--mloy-border, #e5e7eb); }
.mloy .mloy-reward:first-of-type { border-top: 0; }
.mloy .mloy-reward img { width: 52px; height: 52px; object-fit: cover; border-radius: 10px; }
.mloy .mloy-r-name { font-weight: 600; }
.mloy .mloy-pill { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; background: var(--mloy-bg, #f5f5f4); border: 1px solid var(--mloy-border, #e5e7eb); white-space: nowrap; }
.mloy .mloy-pill.mloy-ready { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
.mloy .mloy-hist { list-style: none; padding: 0; margin: 0; }
.mloy .mloy-hist li { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-top: 1px solid var(--mloy-border, #e5e7eb); font-size: 14px; }
.mloy .mloy-hist li:first-child { border-top: 0; }
.mloy .mloy-plus { color: #047857; font-weight: 700; } .mloy .mloy-minus { color: #b91c1c; font-weight: 700; }
.mloy .mloy-tabs { display: flex; gap: 6px; margin: 14px 0 0; }
.mloy .mloy-tabs .mloy-btn { margin: 0; background: transparent; color: inherit; border: 1px solid var(--mloy-border, #e5e7eb); }
.mloy .mloy-tabs .mloy-btn[aria-pressed="true"] { background: var(--mloy-primary, #630812); color: var(--mloy-on-primary, #fff); border-color: var(--mloy-primary, #630812); }
.mloy .mloy-hidden { display: none !important; }
`

const EVT = 'mcrn-loyalty-session'
let mounted = 0

function injectCss() {
  if (document.getElementById('mloy-css')) return
  const s = document.createElement('style')
  s.id = 'mloy-css'
  s.textContent = LOYALTY_CSS
  document.head.appendChild(s)
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const money = p => '£' + ((Number(p) || 0) / 100).toFixed(2).replace(/\.00$/, '')
const memberNo = n => String(n || '').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')

/**
 * Draw the loyalty card into `root`.
 *   opts.slug       the website slug (required)
 *   opts.api        '/loyalty-api'
 *   opts.titleTag   'h1' | 'h2'
 *   opts.title      the heading; blank = the programme's name
 *   opts.alwaysTitle  show the heading when signed in too
 *   opts.intro      words above the sign-in; blank = how points and stamps are earned
 *   opts.parts      { how, stamps, rewards, history, settings, wallet } (each on unless false)
 *   opts.autofocus  focus the email box straight away (the web app; not a block)
 */
export function mountLoyalty(root, opts = {}) {
  injectCss()
  root.classList.add('mloy')
  const id = ++mounted
  const slug = String(opts.slug || '')
  const API = (opts.api || '/loyalty-api') + '/t/' + encodeURIComponent(slug)
  const KEY = 'mcrn_loyalty_' + slug
  const parts = { how: true, stamps: true, rewards: true, history: true, settings: true, wallet: true, ...(opts.parts || {}) }
  const tag = opts.titleTag === 'h2' ? 'h2' : 'h1'
  let info = null
  let me = null
  let tab = 'card'
  let pendingEmail = ''
  let joinTicket = null
  // Focus the first box only after the guest did something (a block lower
  // down a page must not pull the page to it while it loads).
  let acted = false
  root.addEventListener('click', () => { acted = true })
  root.addEventListener('submit', () => { acted = true })

  const session = () => { try { return localStorage.getItem(KEY) } catch { return null } }
  function setSession(s) {
    try { s ? localStorage.setItem(KEY, s) : localStorage.removeItem(KEY) } catch {}
    window.dispatchEvent(new CustomEvent(EVT, { detail: { slug, from: id } }))
  }

  async function call(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const s = session()
    if (auth && s) headers.authorization = 'Loyalty ' + s
    const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
    const data = res.status === 204 ? null : await res.json().catch(() => null)
    if (res.status === 401 && auth) { setSession(null); me = null }
    if (!res.ok) { const e = new Error(data?.error || 'Something went wrong'); e.status = res.status; throw e }
    return data
  }

  const pointsWord = () => info.points?.label || 'points'
  const titleText = () => String(opts.title || '').trim() || info.name
  const titleHtml = () => '<' + tag + ' class="mloy-title" data-testid="loy-title">' + esc(titleText()) + '</' + tag + '>'

  function renderSignedOut(step = 'email', msg = '') {
    const intro = String(opts.intro || '').trim()
    const howBits = []
    if (info.points) howBits.push('<li>' + esc(info.how) + '</li>')
    for (const c of info.stamp_cards) howBits.push('<li>' + esc(c.name) + ': ' + c.stamps_needed + ' stamps fill a card' + (c.description ? ' (' + esc(c.description) + ')' : '') + '.</li>')
    if (info.rewards.length) howBits.push('<li>Swap ' + esc(pointsWord()) + ' for rewards like ' + info.rewards.slice(0, 3).map(r => esc(r.name)).join(', ') + '.</li>')
    let body = ''
    if (step === 'email') {
      body = `<form data-form="email" class="mloy-box">
        <h2 class="mloy-h2">Join or sign in</h2>
        <p class="mloy-p mloy-muted">We'll email you a 6-digit code. No password needed.</p>
        <label class="mloy-label" for="mloy-email-${id}">Email</label>
        <input class="mloy-input" id="mloy-email-${id}" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(pendingEmail)}" data-testid="loy-email" />
        <button type="submit" class="mloy-btn" data-testid="loy-send-code">Send me a code</button>
        ${msg ? '<p class="mloy-err">' + esc(msg) + '</p>' : ''}
      </form>`
    } else if (step === 'code') {
      body = `<form data-form="code" class="mloy-box">
        <h2 class="mloy-h2">Check your email</h2>
        <p class="mloy-p mloy-muted">We sent a code to ${esc(pendingEmail)}. It works for 15 minutes.</p>
        <label class="mloy-label" for="mloy-code-${id}">Code</label>
        <input class="mloy-input mloy-code" id="mloy-code-${id}" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required data-testid="loy-code" />
        <button type="submit" class="mloy-btn" data-testid="loy-verify">Continue</button>
        <button type="button" class="mloy-btn mloy-ghost" data-act="back-email">Use another email</button>
        ${msg ? '<p class="mloy-err">' + esc(msg) + '</p>' : ''}
      </form>`
    } else {
      body = `<form data-form="join" class="mloy-box">
        <h2 class="mloy-h2">Join ${esc(info.name)}</h2>
        <p class="mloy-p mloy-muted">${esc(pendingEmail)}</p>
        <label class="mloy-label" for="mloy-name-${id}">Your name</label>
        <input class="mloy-input" id="mloy-name-${id}" name="name" type="text" autocomplete="name" required maxlength="120" data-testid="loy-name" />
        ${info.signup.ask_phone ? '<label class="mloy-label" for="mloy-phone-' + id + '">Phone (optional)</label><input class="mloy-input" id="mloy-phone-' + id + '" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="30" />' : ''}
        <label class="mloy-check"><input type="checkbox" name="agreed" required data-testid="loy-agree" /> <span>${esc(info.signup.terms_text)}</span></label>
        <label class="mloy-check"><input type="checkbox" name="marketing" data-testid="loy-marketing" /> <span>${esc(info.signup.marketing_text)}</span></label>
        <button type="submit" class="mloy-btn" data-testid="loy-join">Join</button>
        ${msg ? '<p class="mloy-err">' + esc(msg) + '</p>' : ''}
      </form>`
    }
    root.innerHTML = titleHtml() +
      (intro ? '<p class="mloy-p mloy-muted" data-testid="loy-intro">' + esc(intro) + '</p>'
        : parts.how && howBits.length ? '<ul class="mloy-how mloy-muted" data-testid="loy-how">' + howBits.join('') + '</ul>' : '') +
      body
    const f = root.querySelector('form')
    f.addEventListener('submit', async e => {
      e.preventDefault()
      const btn = f.querySelector('button[type=submit]')
      btn.disabled = true
      try {
        if (step === 'email') {
          pendingEmail = f.email.value.trim()
          await call('/code', { method: 'POST', body: { email: pendingEmail }, auth: false })
          renderSignedOut('code')
        } else if (step === 'code') {
          const out = await call('/verify', { method: 'POST', body: { email: pendingEmail, code: f.code.value.trim() }, auth: false })
          if (out.join_ticket) { joinTicket = out.join_ticket; renderSignedOut('join') }
          else { me = out.member; setSession(out.session); render() }
        } else {
          const out = await call('/join', { method: 'POST', auth: false, body: {
            join_ticket: joinTicket, email: pendingEmail, name: f.name.value.trim(),
            phone: f.phone ? f.phone.value.trim() || null : null, agreed: f.agreed.checked, marketing: f.marketing.checked,
          } })
          me = out.member; tab = 'card'; setSession(out.session); render(info.signup.welcome_text || 'Welcome! Your card is ready.')
        }
      } catch (err) { renderSignedOut(step, err.message) }
    })
    root.querySelector('[data-act=back-email]')?.addEventListener('click', () => renderSignedOut('email'))
    if (acted || opts.autofocus) root.querySelector('input')?.focus()
  }

  function stampsHtml() {
    if (!parts.stamps || !me.stamps.length) return ''
    return '<div class="mloy-box"><h2 class="mloy-h2">Stamp cards</h2>' + me.stamps.map(s => `
      <div data-testid="loy-stamps" data-count="${s.count}">
        <strong>${esc(s.name)}</strong> <span class="mloy-muted">${s.count} of ${s.needed}</span>
        <div class="mloy-stamps">${Array.from({ length: s.needed }, (_, i) => '<span class="mloy-stamp' + (i < s.count ? ' mloy-on' : '') + '"></span>').join('')}</div>
      </div>`).join('') + '</div>'
  }

  function rewardsHtml() {
    if (!parts.rewards) return ''
    const held = me.rewards.filter(r => r.member_reward_id)
    const offer = me.rewards.filter(r => !r.member_reward_id)
    if (!held.length && !offer.length) return ''
    const row = r => `<div class="mloy-reward" data-testid="loy-reward">
        ${r.image_url ? '<img src="' + esc(r.image_url) + '" alt="" />' : ''}
        <div style="flex:1">
          <div class="mloy-r-name">${esc(r.name)}</div>
          <div class="mloy-muted">${esc(r.description || r.summary)}${r.min_spend_pence ? ' · spend ' + money(r.min_spend_pence) : ''}${r.expires_at ? ' · use by ' + new Date(r.expires_at).toLocaleDateString('en-GB') : ''}</div>
        </div>
        ${r.member_reward_id ? '<span class="mloy-pill mloy-ready">Ready</span>'
          : r.can_afford ? '<span class="mloy-pill mloy-ready">' + r.points_cost + ' ' + esc(pointsWord()) + '</span>'
          : '<span class="mloy-pill">' + (r.points_cost - me.points) + ' more</span>'}
      </div>`
    return `<div class="mloy-box"><h2 class="mloy-h2">Rewards</h2>
      <p class="mloy-p mloy-muted">Show your card at the till or kiosk, or sign in when you order online, to use one.</p>
      ${held.map(row).join('')}${offer.map(row).join('')}</div>`
  }

  function historyHtml() {
    if (!me.history.length) return '<div class="mloy-box" data-testid="loy-history"><p class="mloy-p mloy-muted">Nothing yet: your points and stamps show here.</p></div>'
    const label = h => h.note || ({ earn: 'Visit', welcome: 'Welcome', redeem: 'Reward', release: 'Reward put back', adjust: 'Adjustment', expire: 'Expired', stamps: 'Stamps', card_full: 'Card full' })[h.kind] || h.kind
    return '<div class="mloy-box" data-testid="loy-history"><h2 class="mloy-h2">History</h2><ul class="mloy-hist">' + me.history.map(h => `<li>
        <span>${esc(label(h))}${h.venue_name ? ' <span class="mloy-muted">· ' + esc(h.venue_name) + '</span>' : ''}<br><span class="mloy-muted">${new Date(h.created_at).toLocaleDateString('en-GB')}</span></span>
        <span>${h.points ? '<span class="' + (h.points > 0 ? 'mloy-plus' : 'mloy-minus') + '">' + (h.points > 0 ? '+' : '') + h.points + '</span>' : ''}
              ${h.stamps ? '<span class="' + (h.stamps > 0 ? 'mloy-plus' : 'mloy-minus') + '">' + (h.stamps > 0 ? '+' : '') + h.stamps + ' ' + (Math.abs(h.stamps) === 1 ? 'stamp' : 'stamps') + '</span>' : ''}</span>
      </li>`).join('') + '</ul></div>'
  }

  function settingsHtml(msg = '') {
    return `<form data-form="me" class="mloy-box">
        <h2 class="mloy-h2">Your details</h2>
        <label class="mloy-label" for="mloy-s-name-${id}">Name</label>
        <input class="mloy-input" id="mloy-s-name-${id}" name="s_name" type="text" value="${esc(me.name)}" maxlength="120" required />
        <label class="mloy-label" for="mloy-s-phone-${id}">Phone</label>
        <input class="mloy-input" id="mloy-s-phone-${id}" name="s_phone" type="tel" inputmode="tel" value="${esc(me.phone || '')}" maxlength="30" />
        <label class="mloy-check"><input type="checkbox" name="s_marketing" ${me.marketing_opt_in ? 'checked' : ''} data-testid="loy-s-marketing" /> <span>${esc(info.signup.marketing_text)}</span></label>
        <button type="submit" class="mloy-btn" data-testid="loy-save">Save</button>
        ${msg ? '<p class="mloy-ok">' + esc(msg) + '</p>' : ''}
      </form>
      <div class="mloy-box">
        <h2 class="mloy-h2">Your card and your data</h2>
        <button type="button" class="mloy-btn mloy-ghost" data-act="new-card" data-testid="loy-new-card">Get a new card code</button>
        <p class="mloy-p mloy-muted" style="margin-top:6px">The old QR code stops working: use it if someone else has a photo of yours.</p>
        <button type="button" class="mloy-btn mloy-ghost" data-act="export" data-testid="loy-export">Download my data</button>
        <button type="button" class="mloy-btn mloy-ghost" data-act="signout" data-testid="loy-signout">Sign out</button>
        <button type="button" class="mloy-btn mloy-danger" data-act="delete" data-testid="loy-delete">Leave and delete my account</button>
        <div data-del-confirm class="mloy-hidden">
          <p class="mloy-err">This deletes your card, points, stamps and rewards for good. Type DELETE to confirm.</p>
          <input class="mloy-input" name="del_text" type="text" autocomplete="off" data-testid="loy-delete-text" />
          <button type="button" class="mloy-btn mloy-danger" data-act="del-go" data-testid="loy-delete-go">Delete my account</button>
        </div>
      </div>`
  }

  function render(msg = '') {
    if (!info) return
    if (!me) return renderSignedOut('email')
    const tabs = [['card', 'My card'], ...(parts.history ? [['history', 'History']] : []), ...(parts.settings ? [['me', 'Settings']] : [])]
    if (!tabs.some(t => t[0] === tab)) tab = 'card'
    const walletBtns = parts.wallet && (info.wallet.apple || info.wallet.google) ? `<div class="mloy-wallets">
        ${info.wallet.apple ? '<button type="button" class="mloy-btn" data-act="apple" data-testid="loy-apple">Add to Apple Wallet</button>' : ''}
        ${info.wallet.google ? '<button type="button" class="mloy-btn" data-act="google" data-testid="loy-google">Add to Google Wallet</button>' : ''}
      </div>` : ''
    const card = `<div class="mloy-card" data-testid="loy-card">
        <div class="mloy-card-top">
          <div><div class="mloy-card-label">Member</div><div class="mloy-name">${esc(me.name)}</div></div>
          ${info.points ? '<div style="text-align:right"><div class="mloy-card-label">' + esc(info.points.label) + '</div><div class="mloy-pts" data-testid="loy-points">' + me.points + '</div></div>' : ''}
        </div>
        <div class="mloy-qr" data-testid="loy-qr">${qrSvg(me.card_code, { margin: 2, title: 'Your loyalty card' })}</div>
        <div class="mloy-no">${memberNo(me.member_no)}</div>
      </div>`
    root.innerHTML = (opts.alwaysTitle ? titleHtml() : '') +
      (msg ? '<p class="mloy-ok">' + esc(msg) + '</p>' : '') +
      (tabs.length > 1 ? '<div class="mloy-tabs" role="group">' + tabs.map(([k, l]) =>
        '<button type="button" class="mloy-btn" data-tab="' + k + '" aria-pressed="' + (tab === k) + '" data-testid="loy-tab-' + k + '">' + l + '</button>').join('') + '</div>' : '') +
      (tab === 'card' ? card + walletBtns + stampsHtml() + rewardsHtml() : tab === 'history' ? historyHtml() : settingsHtml())
    root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render() }))
    const act = (name, fn) => root.querySelector('[data-act="' + name + '"]')?.addEventListener('click', fn)
    act('apple', async () => { try { const r = await call('/me/wallet/apple', { method: 'POST' }); location.href = r.url } catch (e) { render(e.message) } })
    act('google', async () => { try { const r = await call('/me/wallet/google', { method: 'POST' }); location.href = r.url } catch (e) { render(e.message) } })
    const fm = root.querySelector('[data-form=me]')
    if (fm) {
      fm.addEventListener('submit', async e => {
        e.preventDefault()
        me = await call('/me', { method: 'PATCH', body: { name: fm.s_name.value.trim(), phone: fm.s_phone.value.trim() || null, marketing: fm.s_marketing.checked } })
        render('Saved')
      })
      act('new-card', async () => { me = await call('/me/new-card', { method: 'POST' }); tab = 'card'; render('Your card has a new code') })
      act('export', async () => {
        const data = await call('/me/export')
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
        a.download = 'my-loyalty-data.json'
        a.click()
      })
      act('signout', async () => { await call('/me/signout', { method: 'POST' }).catch(() => {}); me = null; setSession(null); render() })
      act('delete', () => root.querySelector('[data-del-confirm]').classList.remove('mloy-hidden'))
      act('del-go', async () => {
        try {
          await call('/me/delete', { method: 'POST', body: { confirm: root.querySelector('[name=del_text]').value.trim() } })
          me = null; setSession(null); renderSignedOut('email')
          root.insertAdjacentHTML('afterbegin', '<p class="mloy-ok">Your account has been deleted.</p>')
        } catch (e) { root.querySelector('[data-del-confirm]')?.insertAdjacentHTML('beforeend', '<p class="mloy-err">' + esc(e.message) + '</p>') }
      })
    }
  }

  // Another copy on this page (or another tab) signed in or out.
  async function refresh() {
    if (!info) return
    if (session()) { try { me = await call('/me') } catch { me = null } } else me = null
    render()
  }
  window.addEventListener(EVT, e => { if (e.detail?.slug === slug && e.detail.from !== id) refresh() })
  window.addEventListener('storage', e => { if (e.key === KEY) refresh() })

  async function start() {
    root.innerHTML = '<p class="mloy-p mloy-muted">Loading…</p>'
    try { info = await call('', { auth: false }) } catch (e) { root.innerHTML = '<div class="mloy-box"><p class="mloy-p">' + esc(e.message) + '</p></div>'; return }
    if (session()) { try { me = await call('/me') } catch { me = null } }
    render()
  }
  start()
  return { refresh }
}
