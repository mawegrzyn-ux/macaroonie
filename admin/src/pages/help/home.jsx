// src/pages/help/home.jsx
// The Help page's "Home" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'home'
export const label = 'Home'
export const order = 15

export function Section() {
  return (
    <section id="home" data-help="">
      <H2>Home</H2>
      <H3>Your pins</H3>
      <P>
        Pins are your own shortcuts: the pages you open most, one tap away. Tap <strong>Pin a page</strong> (or{' '}
        <strong>Edit pins</strong> once you have some), then tap a page under <strong>Add a page</strong>; type a
        few letters in <strong>Find a page</strong> to narrow the list. You can pin up to 12 pages, and only pages
        in your own menu.
      </P>
      <P>
        A pin can open its page at one venue, and on pages with tabs at one tab: Rota at Ware, or Food safety on
        its Holds tab. Pick them in the pin&apos;s row; <strong>Any venue</strong> and <strong>First tab</strong>{' '}
        leave the page as it opens normally. Give a pin a name of your own in its <strong>Own name</strong> box, or
        leave it empty to use the page&apos;s name. Drag a row by its grip (the six dots) to change the order, and
        tap the cross to take a pin off. Nothing changes until you tap <strong>Save pins</strong>; Cancel leaves
        your pins as they were.
      </P>
      <InfoBox type="info">
        Pins are kept with your login, not in the browser, so the same pins show on the office computer, the
        tablet at the host stand and your phone&apos;s browser. Nobody else sees them, and nobody is told what
        you pinned. If your role loses a page, its pin stops showing.
      </InfoBox>
    </section>
  )
}
