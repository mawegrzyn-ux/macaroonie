// src/ai/tools/forms.js
//
// open_form (OUTSTANDING 44 item 3, docs/PEPPER_FIRST.md 4.2 and phase 2):
// "do today's cash-up", "log the fridge temps", "who's on Saturday": Pepper
// opens the form itself in the chat, as a card with an Open button, for the
// person to fill in. The model only picks the form, the venue and the day;
// it never writes a form's fields, and the card is built here from what the
// server found (form_card), never from the model's text.
//
// The forms (shared/forms.js, the same list the sheet in
// components/forms/FormSheet.jsx opens): the six
// Today forms (fridge and freezer, hot and cold hold, cooking checks, a
// checklist, the cash-up, the week's wages) and four more: delivery checks,
// the day's expenses with receipts, sold out dishes, and the rota for a day.
// Each needs View on its module: the form shows read only below the level
// that changes it, as on its page.
//
// In the staff chat the card opens the form; through the staff connector
// (another AI app) the answer is a link to the page.

import { z } from 'zod'
import { ToolError, isStaff, callApi, staffPermissionLevel, levelAtLeast } from '../context.js'
import { officeOrigin } from '../../services/platformHost.js'
import { MODULES } from '../../config/modules.js'
import { DateStr, VenueText, venueFor, venueToday, mondayOf, longDate, pickByName } from './util.js'
import { FORMS, FORM_KEYS } from '../../../../shared/forms.js'

// The forms, one list with the admin's sheet (shared/forms.js): each one's
// title, module, the level that changes it, its page and its day or week.
export const OPEN_FORMS = FORMS
const MODULE_LABEL = Object.fromEntries(MODULES.map(m => [m.key, m.label]))

/** The card's title: the form, and its day or week. */
function cardTitle(key, f, { date, monday, template }) {
  if (key === 'checklist') return template.name
  if (key === 'wages') return 'Wages, week of ' + longDate(monday)
  if (key === 'sold_out') return 'Sold out dishes'
  if (key === 'cash_up') return 'Cash-up for ' + longDate(date)
  if (key === 'rota_day') return 'Rota for ' + longDate(date)
  return f.title + ', ' + longDate(date)
}

// What Pepper is told about this file's tools, gathered by tools/index.js:
// the place in the list (order, then the file name), the areas the tools
// belong to, and the file's lines in the system prompt (prompts.js).
export { formTools as tools }
export const order = 150
// The file's line(s) in the list of what Pepper can do.
export const promptLines = [
  'open_form opens a form in the chat for the person to fill in ("do today\'s cash-up", "log the fridge temps", ' +
    '"open the closing checklist", "add an expense", "mark the pad thai sold out myself", "who\'s on Saturday"): ' +
    'fridge and freezer, hold, cooking and delivery checks, a checklist, the cash-up, the week\'s wages, the day\'s ' +
    'expenses, sold out dishes, the rota for a day. Use it rather than asking for figures one by one when they ' +
    'want to do the job themselves; you never fill the form\'s fields.',
]

export const formTools = [
  {
    name: 'open_form',
    core: true,
    section: 'general',
    title: 'Open a form',
    description:
      'Opens a form in the chat for the staff member to fill in themselves (a card with an Open button; you never fill its ' +
      'fields). form: temps (fridge and freezer temperature checks), holds (hot and cold hold checks), cooking (cooking ' +
      'checks), delivery (delivery checks: temperatures and condition on arrival), checklist (a checklist, by name in ' +
      'checklist; left out = the one due), cash_up (a day\'s cash-up), wages (a week\'s wages; any date in the week), ' +
      'expense (a day\'s petty cash expenses, with receipt photos), sold_out (mark dishes sold out), rota_day (who is on ' +
      'and the rota for a day). Use it when they ask to do one of these ("do today\'s cash-up", "log the fridge temps", ' +
      '"open the closing checklist"). date defaults to today at the venue. Reply in one short line; the card says the rest.',
    input: z.object({
      form:      z.enum(FORM_KEYS),
      venue:     VenueText,
      date:      DateStr.optional().describe('The day (or any day of the week for wages). Defaults to today at the venue.'),
      checklist: z.string().trim().max(120).optional().describe('For form checklist: its name. Left out = the one due.'),
    }),
    readOnly: true,
    async run(ctx, input) {
      if (!isStaff(ctx)) throw new ToolError('Not available here', 403)
      const f = OPEN_FORMS[input.form]
      const level = await staffPermissionLevel(ctx, f.module)
      if (!levelAtLeast(level, 'view')) {
        throw new ToolError('You don\'t have access to ' + (MODULE_LABEL[f.module] || f.module) + ', so that form can\'t open. Ask an owner or admin.', 403)
      }
      const venue = await venueFor(ctx, input.venue)
      const date = input.date || venueToday(venue)
      const monday = mondayOf(date)
      let template = null
      if (input.form === 'checklist') {
        const due = await callApi(ctx, 'GET', `/api/checklists/due?venue_id=${venue.id}&date=${date}`)
        const open = due.filter(d => !d.not_required)
        if (!open.length) throw new ToolError('No checklist is due at ' + venue.name + ' on ' + longDate(date) + '.', 404)
        const pick = input.checklist
          ? pickByName(open, input.checklist, d => d.template.name, 'checklist due', 'No checklist is due that day.')
          : (open.filter(d => d.instance?.status !== 'completed').length === 1
            ? open.find(d => d.instance?.status !== 'completed')
            : null)
        if (!pick) throw new ToolError('Which checklist? Due: ' + open.map(d => d.template.name).join(', ') + '.', 422)
        template = pick.template
      }
      const ref = f.by === 'week' ? { week: monday } : f.by === 'date' ? { date } : {}
      if (template) ref.template = template
      const title = cardTitle(input.form, f, { date, monday, template })
      const readOnly = !levelAtLeast(level, f.edit)
      if (ctx.channel !== 'staff_chat') {
        return { form: title, venue: venue.name, url: officeOrigin() + f.path, message: 'Open the page to fill it in.' }
      }
      return {
        form_card: { form: input.form, title, venue_id: venue.id, venue: venue.name, date, ref, read_only: readOnly },
        message: 'A card for "' + title + '" with an Open button is in the chat' + (readOnly ? ' (read only for this person)' : '') + '.',
      }
    },
    // The chat's card (chat.js): from the result the server made, never the model's words.
    display(out) {
      const c = out?.form_card
      return c && OPEN_FORMS[c.form] ? { type: 'form', form: c } : null
    },
  },
]
