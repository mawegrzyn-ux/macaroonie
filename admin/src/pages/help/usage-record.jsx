// src/pages/help/usage-record.jsx
// The Help page's "Usage record" section: which pages people open and what they
// search for in the menu box (migration 270). Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, InfoBox, DataTable } from './parts.jsx'

export const id = 'usage-record'
export const label = 'Usage record'
export const order = 275

export function Section() {
  return (
    <section id="usage-record" data-help="">
      <H2>Usage record</H2>
      <P>
        Macaroonie keeps a short record of which pages each person opens and what they type in
        the <strong>ask bar</strong> (Search or ask), so the group can see which pages are used and
        how often a search is handed to Pepper. It is sent quietly in the background:
        nothing on a page waits for it, and if it can't be sent it is simply skipped.
      </P>
      <H3>What is recorded</H3>
      <DataTable
        head={['When', 'What is kept']}
        rows={[
          ['You open a page', 'The page (its address without anything after a ?, and with record numbers left out), and when.'],
          ['You search in the ask bar', 'The words you typed last, how many of the menu\'s own pages fitted them, whether you handed them to Pepper (Enter, the Ask button, the Ask Pepper row or an ask under the bar), and what you then opened from the bar: a page, a saved report, or nothing.'],
        ]}
      />
      <P>The record is kept for 90 days, then deleted.</P>
      <H3>Who sees what</H3>
      <P>
        Your own pages and searches are yours: in <strong>Reports</strong>, the subject
        <strong> My pages and searches</strong> (under Your group) shows only the person running it,
        whoever that is. An owner can't report on anyone else's.
      </P>
      <P>
        For the group as a whole there are two subjects with no names in them:
        <strong> Pages opened</strong> (times each page was opened, by day) and
        <strong> Menu searches</strong> (how many searches, how many were handed
        to Pepper and their share, how many opened something and how many found no menu match).
        They don't show who did what, or the words typed. They need View on <Mono>Navigation</Mono>
        (an owner's by default).
      </P>
      <InfoBox type="info">
        Pepper doesn't rank or score people from this record. When a guest asks to be
        forgotten, searches that named them are deleted along with the rest of their details.
      </InfoBox>
    </section>
  )
}
