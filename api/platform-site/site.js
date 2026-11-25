// The platform site on macaroonie.com (views/platform/, served at /site/site.js).
// Plain script, no build: the header menu, the feature tiles' drill-downs,
// the parts on a group's page, the architecture picture, the screenshot
// viewer and the register-interest form. Each part looks for its own markup
// and does nothing on a page without it.
(function () {
  'use strict'
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function byId(id) { return document.getElementById(id) }
  function each(list, fn) { Array.prototype.forEach.call(list, fn) }
  function bringIntoView(el) {
    var box = el.getBoundingClientRect()
    if (box.top < 70 || box.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' })
    }
  }

  // The header menu (below 1000 px).
  function menu() {
    var btn = document.querySelector('.menu-btn')
    var nav = byId('site-nav')
    if (!btn || !nav) return
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true'
      btn.setAttribute('aria-expanded', String(open))
      nav.classList.toggle('open', open)
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        btn.setAttribute('aria-expanded', 'false')
        nav.classList.remove('open')
        btn.focus()
      }
    })
  }

  // The feature tiles: one drill-down open at a time, under its row.
  function tiles() {
    each(document.querySelectorAll('[data-drill-group]'), function (group) {
      var buttons = group.querySelectorAll('.tile')
      function set(btn, open) {
        var panel = byId(btn.getAttribute('aria-controls'))
        btn.setAttribute('aria-expanded', String(open))
        if (panel) panel.classList.toggle('open', open)
      }
      each(buttons, function (btn) {
        btn.addEventListener('click', function () {
          var open = btn.getAttribute('aria-expanded') !== 'true'
          each(buttons, function (b) { if (b !== btn) set(b, false) })
          set(btn, open)
          if (open) bringIntoView(byId(btn.getAttribute('aria-controls')))
        })
      })
      each(group.querySelectorAll('.drill-close'), function (close) {
        close.addEventListener('click', function () {
          var btn = byId(close.getAttribute('data-close'))
          set(btn, false)
          btn.focus()
        })
      })
      group.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return
        var open = group.querySelector('.tile[aria-expanded="true"]')
        if (open) { set(open, false); open.focus() }
      })
    })
  }

  // A group's parts: each opens on its own; /features/<group>#<part> opens it.
  function parts() {
    each(document.querySelectorAll('[data-drill-list]'), function (list) {
      function set(btn, open) {
        btn.setAttribute('aria-expanded', String(open))
        var body = byId(btn.getAttribute('aria-controls'))
        if (body) body.classList.toggle('open', open)
      }
      each(list.querySelectorAll('button[aria-controls]'), function (btn) {
        btn.addEventListener('click', function () { set(btn, btn.getAttribute('aria-expanded') !== 'true') })
      })
      var id = decodeURIComponent(location.hash.slice(1))
      var target = id && byId(id)
      if (target && list.contains(target)) {
        var btn = target.querySelector('button[aria-controls]')
        if (btn) set(btn, true)
      }
    })
  }

  // The architecture picture: a part's button shows its detail; one at a time.
  function arch() {
    var root = document.querySelector('[data-arch]')
    if (!root) return
    var buttons = root.querySelectorAll('.part-btn')
    var panel = document.querySelector('.arch-detail')
    var wide = window.matchMedia('(min-width: 1000px)')
    function show(id, fromUser) {
      each(buttons, function (b) {
        var on = b.getAttribute('data-part') === id
        b.setAttribute('aria-expanded', String(on))
        var d = byId(b.getAttribute('aria-controls'))
        if (d) d.classList.toggle('open', on)
      })
      panel.classList.toggle('has-open', !!id)
      if (!id) return
      if (fromUser) {
        if (history.replaceState) history.replaceState(null, '', '#' + id)
        if (!wide.matches) bringIntoView(panel)
      }
    }
    each(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-part')
        show(btn.getAttribute('aria-expanded') === 'true' ? null : id, true)
      })
    })
    function fromHash() {
      var id = decodeURIComponent(location.hash.slice(1))
      if (id && root.querySelector('[data-part="' + id.replace(/[^a-z0-9-]/g, '') + '"]')) {
        show(id, false)
        var btn = byId('btn-' + id)
        if (btn) btn.scrollIntoView({ block: 'center', behavior: 'auto' })
      }
    }
    window.addEventListener('hashchange', fromHash)
    fromHash()
  }

  // The screenshots: a dialog with the large picture.
  function zoom() {
    var dialog = byId('lightbox')
    if (!dialog || typeof dialog.showModal !== 'function') return
    var img = byId('lightbox-img')
    var cap = byId('lightbox-cap')
    var opener = null
    each(document.querySelectorAll('[data-zoom]'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault()
        var small = a.querySelector('img')
        opener = a
        img.src = a.getAttribute('href')
        img.alt = small ? small.alt : ''
        var fig = a.closest('figure')
        var fc = fig && fig.querySelector('figcaption')
        cap.textContent = fc ? fc.textContent : ''
        dialog.showModal()
      })
    })
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close() })
    dialog.addEventListener('close', function () { if (opener) opener.focus() })
  }

  // The register-interest form (home).
  function interest() {
    var form = byId('interest-form')
    if (!form) return
    var msg = byId('interest-msg')
    var btn = byId('interest-submit')
    function show(text, ok) { msg.textContent = text; msg.className = 'msg ' + (ok ? 'ok' : 'err') }
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var data = {}
      new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() : v })
      data.consent = form.elements.consent.checked
      if (!data.name) return show('Please enter your name.')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email || '')) return show('Please enter a valid email address.')
      if (!data.consent) return show('Please tick the box so we can store your details.')
      btn.disabled = true
      btn.textContent = 'Sending…'
      fetch('/api/platform-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(function (res) {
        if (res.ok) {
          byId('interest-fields').hidden = true
          byId('interest-thanks').hidden = false
          return
        }
        throw new Error(res.status === 429 ? 'Too many tries. Please wait a few minutes and try again.' : 'Something went wrong. Please try again.')
      }).catch(function (err) {
        show(err.message || 'Something went wrong. Please try again.')
        btn.disabled = false
        btn.textContent = 'Register interest'
      })
    })
  }

  function start() { menu(); tiles(); parts(); arch(); zoom(); interest() }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
