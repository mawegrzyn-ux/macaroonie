// src/pages/help/changelog.jsx
// The Help page's "What is New" section. Help.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, P } from './parts.jsx'

export const id = 'changelog'
export const label = 'What is New'
export const order = 520

export function Section() {
  return (
    <section id="changelog" data-help="">
      <H2>What is new</H2>
      <P>
        The <strong>What is new</strong> page (<strong>sidebar nav</strong>) shows a timeline of
        platform updates, new features, and bug fixes published by the platform team. Each entry
        has a title, date, category (feature / fix / improvement / deprecation), and description.
      </P>
      <P>
        New entries are published by platform admin — they appear automatically for all tenants
        as soon as they are published. Unpublished drafts are only visible to platform admin.
      </P>
    </section>
  )
}
