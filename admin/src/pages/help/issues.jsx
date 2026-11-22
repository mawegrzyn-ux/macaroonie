// src/pages/help/issues.jsx
// The Help page's "Issue Log" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, DataTable } from './parts.jsx'

export const id = 'issues'
export const label = 'Issue Log'
export const order = 500

export function Section() {
  return (
    <section id="issues" data-help="">
      <H2>Issue Log</H2>
      <P>
        The Issue Log (<strong>sidebar nav</strong>) is your ITIL-style incident and service request
        tracker. Use it to report bugs, outages, change requests, or service needs. Platform admin
        can acknowledge, update, and resolve issues, and can promote them to the development backlog.
      </P>
      <P>
        Everyone sees the issues of the restaurant group they are in. A platform admin sees the
        same, plus an <strong>All restaurant groups</strong> button that lists every group&apos;s
        issues with the group&apos;s name on each.
      </P>
      <H3>Priority matrix</H3>
      <P>
        Priority is calculated automatically from <strong>Impact</strong> and <strong>Urgency</strong>:
      </P>
      <DataTable
        head={['Impact', 'Urgency', 'Priority']}
        rows={[
          ['Critical', 'Critical', 'P1 — Critical'],
          ['Critical / High', 'High / Critical', 'P2 — High'],
          ['Medium or mixed', 'Medium or mixed', 'P3 — Medium'],
          ['Low', 'Low', 'P4 — Low'],
        ]}
      />
      <H3>Categories</H3>
      <DataTable
        head={['Category', 'When to use']}
        rows={[
          ['Incident', 'Something is broken or degraded right now.'],
          ['Problem', 'Root cause investigation of recurring incidents.'],
          ['Change request', 'Planned modification to the system.'],
          ['Service request', 'Routine request (e.g. account changes, access).'],
        ]}
      />
      <H3>Lifecycle</H3>
      <P>
        Issues move through: <strong>New</strong> → <strong>Acknowledged</strong> → <strong>In
        progress</strong> → <strong>Resolved</strong> → <strong>Closed</strong>. Platform admin
        adds resolution notes when closing. Issues can be promoted to a backlog item if
        development work is needed.
      </P>
    </section>
  )
}
