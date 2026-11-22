// src/pages/help/reviews.jsx
// The Help page's "Reviews" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, InfoBox, DataTable } from './parts.jsx'

export const id = 'reviews'
export const label = 'Reviews'
export const order = 490

// ── Reviews ─────────────────────────────────────
export function Section() {
  return (
    <section id="reviews" data-help="">
      <H2>Reviews</H2>
      <P>
        The Reviews page (<strong>sidebar nav</strong>) lets you collect, moderate, and showcase
        guest reviews from Google (via automated scraping) or add them manually.
      </P>
      <H3>Importing reviews</H3>
      <DataTable
        head={['Method', 'How']}
        rows={[
          ['Recorded by Claude in Chrome', 'Connect Claude to Macaroonie (Pepper page, Connect tab), open your venue\'s reviews page on Google, TripAdvisor, Deliveroo or Just Eat in Chrome, and ask Claude to record the latest reviews into Macaroonie. It reads what the page shows and records it — no scraping, and reviews already recorded are skipped, so asking again is always safe. New ones land in the To check inbox below.'],
          ['Google scrape', 'Enter a Google Place ID on the Venue settings page, then click Scrape Google Reviews on the Reviews page. The job runs in the background via Apify — results appear within a minute or two. Requires an APIFY_API_TOKEN to be configured on the server.'],
          ['Manual entry', 'Click Add review, fill in the reviewer name, rating, text, and date. Useful for reviews collected by phone or in person.'],
          ['CSV import', 'Upload a CSV with columns: reviewer_name, rating, review_text, review_date. Platform admin can provide a template.'],
        ]}
      />
      <H3>The To check inbox</H3>
      <P>
        Reviews that arrive by themselves (recorded, scraped or imported) wait in the
        <strong> To check</strong> list until someone looks at each one and decides:
        <strong> Show on the website</strong> puts it on your site&apos;s reviews, and
        <strong> Keep off the website</strong> leaves it stored but never shown. Either way the
        review is kept — that record is what stops the same review coming back into the inbox
        the next time the page is read. A recorded review carries a <strong>Recorded</strong> badge
        and, opened out, a link to the page it was read from so you can see it in place (only a
        web address, one starting with https://, is ever recorded or shown as a link).
      </P>
      <H3>Moderation</H3>
      <P>
        Reviews not yet approved stay off the website. Approved reviews can
        be shown in the Reviews Band block on your public site. Featured reviews are highlighted at
        the top of the block. Use <strong>Put all shown on the website</strong> to approve a whole
        list at once after a scrape or a recording session.
      </P>
      <InfoBox type="tip">
        The Reviews Band block on your site automatically pulls from your approved (and optionally
        featured) reviews — no copy-paste required.
      </InfoBox>
    </section>
  )
}
