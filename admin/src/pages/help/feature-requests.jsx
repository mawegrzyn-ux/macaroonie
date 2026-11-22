// src/pages/help/feature-requests.jsx
// The Help page's "Feature Requests" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, DataTable } from './parts.jsx'

export const id = 'feature-requests'
export const label = 'Feature Requests'
export const order = 510

export function Section() {
  return (
    <section id="feature-requests" data-help="">
      <H2>Feature Requests</H2>
      <P>
        The Feature Requests page (<strong>sidebar nav</strong>) is a shared wishlist across all
        tenants. Submit requests, upvote existing ones, and track progress as platform admin moves
        items through their lifecycle.
      </P>
      <H3>Upvoting</H3>
      <P>
        Click the upvote button on any request to add your vote. Click again to remove it. Your
        votes are tied to your account. The upvote count is visible to all tenants — popular
        requests get prioritised.
      </P>
      <H3>Lifecycle statuses</H3>
      <DataTable
        head={['Status', 'Meaning']}
        rows={[
          ['Submitted', 'Received, not yet reviewed.'],
          ['Under review', 'Platform admin is evaluating feasibility.'],
          ['Planned', 'Accepted, will be built in a future sprint.'],
          ['In progress', 'Currently being built.'],
          ['Shipped', 'Deployed and available.'],
          ['Declined', 'Not going ahead — see admin notes for reason.'],
        ]}
      />
    </section>
  )
}
