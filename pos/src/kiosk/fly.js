// Add to order: the dish's picture flies into the order and shrinks away as
// it goes (the button with the bag on the menu, Checkout on the order page:
// whichever carries data-fly-target="basket"), and the button bounces when
// it lands. A copy of the picture does the flying, fixed on top of the kiosk,
// so the dish's page can close at once. The copy stays inside .k-root, so the
// design's picture style (round, oval, hexagon, no frame) and its colours
// still apply to it. Off with the design's layout.fly_to_order, or when the
// screen asks for less motion.

export const FLY_MS = 700

const lessMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The order button showing now (the menu's, or Checkout on the order page). */
function basketButton(root) {
  for (const el of root.querySelectorAll('[data-fly-target="basket"]')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

function bump(el) {
  if (!el?.animate) return
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 450, easing: 'ease' })
}

/**
 * Flies a copy of `from` (a dish's picture) into the order button. True when
 * it flew: the caller then leaves the button's bounce to the landing.
 */
export function flyToBasket(from) {
  if (!from || lessMotion() || typeof from.animate !== 'function') return false
  const root = from.closest('.k-root')
  if (!root || root.dataset.flyToOrder === '0') return false
  const to = basketButton(root)
  if (!to) return false
  const a = from.getBoundingClientRect()
  const b = to.getBoundingClientRect()
  if (!a.width || !a.height) return false
  // A picture scrolled out of sight comes in from the edge it went out of.
  const top = Math.max(a.top, -a.height * 0.5)

  const ghost = from.cloneNode(true)
  for (const n of ghost.querySelectorAll('[data-testid]')) n.removeAttribute('data-testid')
  // A hexagon tile flies as its picture: no name band, marks or badges.
  for (const n of ghost.querySelectorAll('.k-hex-band, .k-hex-top, .k-fit-badge, .k-sold')) n.remove()
  ghost.removeAttribute('id')
  ghost.setAttribute('data-testid', 'k-fly')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.classList.add('k-fly')
  // Inline, so no class the picture brought along (absolute, inset, a
  // width in %) can move it.
  Object.assign(ghost.style, {
    position: 'fixed', left: a.left + 'px', top: top + 'px', right: 'auto', bottom: 'auto',
    width: a.width + 'px', height: a.height + 'px', maxWidth: 'none', maxHeight: 'none', margin: '0',
    zIndex: '75', pointerEvents: 'none', transformOrigin: '50% 50%',
  })
  root.appendChild(ghost)

  const dx = b.left + b.width / 2 - (a.left + a.width / 2)
  const dy = b.top + b.height / 2 - (top + a.height / 2)
  // Lands about the size of the button's icon.
  const end = Math.max(0.04, Math.min(0.3, (b.height * 0.75) / Math.max(a.width, a.height)))
  const lift = Math.min(28, a.height * 0.08)
  const anim = ghost.animate([
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1, easing: 'ease-out' },
    { transform: `translate(${dx * 0.06}px, ${dy * 0.06 - lift}px) scale(0.92)`, opacity: 1, offset: 0.2, easing: 'cubic-bezier(.55, 0, .8, .45)' },
    { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0.55 },
  ], { duration: FLY_MS, fill: 'forwards' })
  let landed = false
  const land = () => {
    if (landed) return
    landed = true
    ghost.remove()
    // The button may have been drawn again since: find it again.
    bump(basketButton(root))
  }
  anim.onfinish = land
  anim.oncancel = () => ghost.remove()
  // Animations wait while the page is hidden: never leave the copy behind.
  setTimeout(land, FLY_MS + 500)
  return true
}
