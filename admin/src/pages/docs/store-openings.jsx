// src/pages/docs/store-openings.jsx
// The Docs page's "New locations (store openings)" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'store-openings'
export const label = 'New locations (store openings)'
export const order = 380

export function Section() {
  return (
    <section id="store-openings" data-doc="">
      <H2>New locations (store openings)</H2>
      <P>
        Migration 186. The New venue page (<Mono>/new-location</Mono>, <Mono>pages/NewLocation.jsx</Mono>) and
        five Pepper tools (<Mono>ai/tools/locations.js</Mono>) set up a new venue and create it in one
        transaction. Since 20 Oct 2026 the page is a step-by-step wizard (below) and Pepper is optional; it
        replaced the Venues page's Add venue form. Pepper only plans: its answer is a structured JSON plan the
        server checks, and the venue is made by plain code from the checked plan.
      </P>
      <H3>The setup wizard</H3>
      <P>
        Steps (<Mono>STEPS</Mono> in <Mono>NewLocation.jsx</Mono>, current step in <Mono>?step=</Mono>): venue,
        brand, menu, hours, tables, rest, check; each step is a component in{' '}
        <Mono>components/venueSetup/steps.jsx</Mono> with its own Save (a PATCH of the opening). A step registers{' '}
        <Mono>{'{ dirty, save }'}</Mono> through <Mono>useGuard()</Mono>; moving to another step while dirty shows the
        pending bar (Save and go / Don&apos;t save / Stay here). Pepper's questions render with{' '}
        <Mono>QuestionsCard</Mono> (<Mono>questions.jsx</Mono>); shared buttons and <Mono>ModePick</Mono> are in{' '}
        <Mono>ui.jsx</Mono>.
      </P>
      <DataTable
        head={['Piece', 'What it does']}
        rows={[
          ['POST /wizard', '{ template_venue_id? } (venues manage): an opening with no description (title "New venue", input empty) and overrides.wizard = true. From scratch it also sets WIZARD_NEW (booking_rules, website, ordering, till, cash) to new; like a venue, normalisePlan() copies every area it can. No model call.'],
          ['POST /:id/describe', '{ input } (the planning permissions + Pepper on): stores the description and runs the scope step on a draft, questions or ready opening. Pepper fills only what the person hasn\'t set.'],
          ['PATCH /:id overrides.settings', 'Per-area settings the steps write, keyed by SETTING_KEYS (hours, tables, booking_rules, ordering, till, devices, food_safety, checklists, purchasing, staff, emails, menus, brand), up to 60 KB; a null value deletes one. normalisePlan()\'s pick() takes the override before Pepper\'s raw plan for each.'],
          ['overrides.modes null', 'A mode set to null deletes the person\'s choice, so the area goes back to its default (the venue step does this to WIZARD_NEW when the template changes).'],
          ['plan.menus', '{ ids, made, only_here }: ids go on the venue\'s online ordering (planMenus(): the tenant\'s menus with no venue or this one; added to copied menu_ids or set on a new ordering_settings row); with only_here, the menus made in the wizard (made) get venue_id = the new venue before the areas run (needs menus manage). A menus follow-up asks to check and publish them.'],
          ['plan.brand', '{ kit }: a theme kit for the venue\'s own web page. ownLook() (website area, copy or new) sets use_brand_override, the theme from websiteThemeFromKit(kit, tenant theme), the identity from tenant_site, primary_colour and font_family.'],
          ['create', 'Allowed for wizard drafts (not only ready openings). view() returns wizard.'],
        ]}
      />
      <H3>Pieces</H3>
      <DataTable
        head={['File', 'What it holds']}
        rows={[
          ['shared/storeOpening.js', 'OPENING_AREAS (key, label, icon, modules needed with Manage, admin flag, the ways allowed: copy / new / skip), normalisePlan(raw, overrides, { templates, today }) (never throws; the person\'s overrides win; copy without a location to copy from becomes new where allowed, else skip; new with nothing to set up becomes skip), planProblems(), previewPlan(plan, templateSummary) (one line per area), buildFollowups() (the Still to do list), AREA_LINKS, hoursText(), slugify(), MAX_ROUNDS (3).'],
          ['services/storeSetup.js', 'venueSummary() (what a location has, area by area: counts and words, used for the preview and for Pepper), tenantContext() (every location\'s summary and the company-wide lists Pepper reads), freeSlug(), createStore(tx, { tenantId, plan, by, allowed, allowedModule, today }).'],
          ['services/storeOpeningAi.js', 'askPepper(): one model call per step (AI_MODEL, output_config.format json_schema ANSWER_SCHEMA, streamed, cached system prompt and context block); the answer\'s questions trimmed and numbered r<round>-<id>; on a 400 about the schema it asks again for the same JSON as text. Counted in the AI allowance and the person\'s daily share (addUsage staff_chat).'],
          ['routes/storeOpenings.js', '/api/ai/store-openings (under /api/ai for the 5-minute proxy timeout). Reads need venues view; steps venues manage + ai_assistant view + Pepper on for the tenant; creating venues manage.'],
        ]}
      />
      <H3>API</H3>
      <DataTable
        head={['Route', 'What it does']}
        rows={[
          ['GET /', 'The openings (title, status, the location made, who, when, busy).'],
          ['GET /:id', 'One opening: the checked plan (venue.slug_final = the address it will get), area cards (mode, chosen by the person, Pepper\'s note, deep_dive, preview, can_set_up, result), questions, brief, problems, history, results, followups.'],
          ['POST /', '{ input, template_venue_id? }: makes the row and runs the scope step. A failed step keeps the draft (status draft) and returns it with error.'],
          ['POST /:id/scope', 'Runs the scope step again on a draft.'],
          ['POST /:id/answers', '{ answers: { id: text } } (empty = leave it to Pepper). A round: the last round (MAX_ROUNDS) always ends ready.'],
          ['POST /:id/deep-dive', '{ area }: questions about one area (not a round).'],
          ['POST /:id/change', '{ request }: Pepper changes the plan.'],
          ['PATCH /:id', '{ title?, overrides: { venue, location, opening_date, template_venue_id, modes } }: the person\'s own choices, merged into overrides.'],
          ['POST /:id/create', 'createStore() in one transaction with the row update (status created, venue_id, plan, results, followups). Any area failing rolls everything back (422 naming the area).'],
          ['PATCH /:id/followups/:key', '{ done }.'],
          ['DELETE /:id', 'A draft only.'],
        ]}
      />
      <H3>Copying a location</H3>
      <P>
        <Mono>copyTable()</Mono> copies whole rows of the location copied from: every column but its id,
        tenant, venue and timestamps. Ids are moved: uuid columns, uuid arrays and every uuid inside jsonb
        (values and keys) go to the copy's new id (<Mono>remapDeep()</Mono>); an id of something that belongs
        to the location copied from (<Mono>OWNED_TABLES</Mono>, plus its menus) but wasn't copied is dropped
        (null, or left out of its array or object); company-wide ids (menus, dishes, order types, tip pots,
        kiosk designs, suppliers) stay. Areas run in an order that lets later ones point at earlier ones
        (<Mono>AREA_ORDER</Mono>: tax, cash, till, tables, hours, booking rules, kitchen, devices, ordering,
        Deliveroo, website, emails, food safety, checklists, dashboards, purchasing, team). Never copied:
        the PIN salt (new), receipt address (the new one), printers' place in the floor plan is kept but
        their addresses need checking, supplier account numbers (blank), paired devices (copies are unpaired,
        ready for the installer; menu screens get new short codes), the location's address and map (from
        the plan), Loyverse / GloriaFood links, staff. Before the opening date a "Not open yet" closure
        covers today to the day before, and online ordering is off.
      </P>
      <H3>Pepper tools</H3>
      <P>
        <Mono>plan_new_location</Mono>, <Mono>answer_location_questions</Mono>,{' '}
        <Mono>change_location_plan</Mono> (direct overrides, a closer look, or a change in words),{' '}
        <Mono>location_openings</Mono> (read) and <Mono>create_location</Mono> (a card; its describe() shows the
        areas being set up and those the person can't). Section <Mono>locations</Mono>, module{' '}
        <Mono>venues</Mono>. They call the routes above with <Mono>callApi()</Mono>, so a planning step in a chat
        is a model call inside a tool call.
      </P>
    </section>
  )
}
