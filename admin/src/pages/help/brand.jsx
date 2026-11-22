// src/pages/help/brand.jsx
// The Help page's "Brand & Theme" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox } from './parts.jsx'

export const id = 'brand'
export const label = 'Brand & Theme'
export const order = 290

// ── BRAND & THEME ───────────────────────────────
export function Section() {
  return (
    <section id="brand" data-help="">
      <H2>Brand &amp; Theme</H2>
      <P>
        <strong>Brand &amp; theme</strong> (under Brand &amp; web in the menu) holds your restaurant
        group&apos;s brand: the brand name, tagline, logo and browser icon, the colours and the fonts. It is
        more than the website: every designer offers it (kiosk designs, menu screen boards, printed menus),
        the admin&apos;s card headers use its accent colour, and the colour swatches in every builder start
        with it. Changing it needs Manage on Website; everyone else sees it read only.
      </P>

      <H3>Setting the brand</H3>
      <P>
        The <strong>Brand</strong> card takes the name, tagline, logo and browser icon; the{' '}
        <strong>Colours</strong> and <strong>Fonts</strong> cards set the seven colours and the heading and
        text fonts. <strong>Theme ideas</strong> makes a theme from your logo or a photo and a few words (see
        Website Builder, Make a theme from a picture) or starts from a ready-made one. Each card has its own
        Save. The website shows brand changes once it is published (Website &gt; Publish); the designers and
        the admin use them straight away.
      </P>

      <H3>Putting the brand on other designs</H3>
      <P>
        <strong>Use the brand on other designs</strong> lists your kiosk designs, menu screen boards and printed
        menu designs (the ones your role can change). Tick the ones that should take the brand, check the before
        and after preview, tap <strong>Use the brand on the ticked designs</strong>, then{' '}
        <strong>Yes, use the brand</strong>. Each design takes the brand&apos;s colours and
        fonts and keeps everything else: its layout, pictures and words. Each one says when it is done, or why
        it couldn&apos;t be saved.
      </P>
      <P>
        In the kiosk designer, the menu screen designer and the printed menu designer, the theme maker&apos;s
        button has <strong>Use the brand</strong> beside it: it fills that design&apos;s colours and fonts from
        the brand, and nothing is saved until you save the design. The theme maker also shows{' '}
        <strong>Your brand</strong> as the first theme.
      </P>
      <InfoBox type="info">
        The website&apos;s own settings stay on the Website page: the template, the layout (Look &amp; layout),
        the header and footer, the site name and the picture shared on social media, and a location&apos;s own
        look (see Website Builder, Give a location its own look).
      </InfoBox>
    </section>
  )
}
