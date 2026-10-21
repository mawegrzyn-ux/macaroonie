// src/services/receiptReadAi.js
//
// Pepper reads a petty cash receipt (a photo or a PDF) so the expense form
// fills itself: who it was from, what was bought, the date, the amount paid
// (with VAT), the VAT, whether it was paid by card, and the venue's expense
// category that fits best. Nothing is saved here: the form shows the values
// for the person to check, and saving the expense attaches the photo as its
// receipt as before.
//
//   readReceipt({ tenantId, person, file, categories, currency })
//     file:       { media_type, data (base64) }
//     categories: the venue's active expense categories [{ id, name }]
//     Returns { merchant, description, date, amount, vat_amount, paid_by_card,
//               category_id, notes } (null where the receipt didn't say).

import { askForJson, fileBlocks, obj, str, oneOf, clip, readAmount } from './aiJson.js'
import { readDate } from './invoiceReadAi.js'
import { ASSISTANT_NAME } from '../../../shared/assistant.js'
import { httpError } from '../middleware/error.js'

export const RECEIPT_SCHEMA = obj({
  merchant: str,
  description: str,
  date: str,
  total: str,
  vat: str,
  paid_by: oneOf(['card', 'cash', 'unknown']),
  category: str,
  notes: str,
})

export const SYSTEM_PROMPT = `You are ${ASSISTANT_NAME}, the assistant in Macaroonie, a platform restaurant groups run their restaurants on. Staff paid for something out of the restaurant's petty cash (or on a card) and photographed the receipt. You read it so the expense form fills itself; the person checks it before saving.

- merchant: the shop or company as printed.
- description: a short plain description of what was bought, a few words ("Milk and lemons", "Bin bags", "Taxi to the cash and carry"). Never a list of every line.
- date: the receipt's date as YYYY-MM-DD, else ''.
- total: the amount paid in total, including VAT, as a plain number ("12.50", no currency sign).
- vat: the total VAT on the receipt as a plain number when it is printed, '0.00' when it says no VAT or zero-rated, else ''. Never work VAT out yourself when it isn't printed.
- paid_by: card when the receipt shows a card payment (card type, last four digits, contactless, "card"), cash when it shows cash tendered or change, else unknown.
- category: the name from categories that fits best, exactly as given; '' when none fits or no categories are given.
- notes: one plain sentence when something wasn't clear (a faded total, two receipts in one photo), else ''.

Never invent amounts. Write in plain British English.`

export async function readReceipt({ tenantId, person, file, categories = [], currency = 'GBP' }) {
  const content = fileBlocks([file])
  content.push({
    type: 'text',
    text: 'The receipt is above.\n' + JSON.stringify({ currency, categories: categories.map(c => c.name) }),
  })
  const raw = await askForJson({ tenantId, person, system: SYSTEM_PROMPT, schema: RECEIPT_SCHEMA, content, maxTokens: 4000, effort: 'low', what: 'receipt' })
  const amount = readAmount(raw.total, { max: 100000 })
  const vat = readAmount(raw.vat, { max: 100000 })
  if (amount === undefined && !clip(raw.merchant, 200) && !clip(raw.description, 200)) {
    throw httpError(422, ASSISTANT_NAME + ' couldn\'t read a receipt in that. Try a clearer photo.')
  }
  const wanted = clip(raw.category, 100).toLowerCase()
  const cat = wanted ? categories.find(c => c.name.trim().toLowerCase() === wanted) : null
  const merchant = clip(raw.merchant, 200) || null
  const what = clip(raw.description, 300)
  return {
    merchant,
    description: (merchant && what ? merchant + ': ' + what : merchant || what || '').slice(0, 500) || null,
    date: readDate(raw.date),
    amount: amount ?? null,
    vat_amount: vat !== undefined && (amount === undefined || vat <= amount) ? vat : null,
    paid_by_card: raw.paid_by === 'card' ? true : raw.paid_by === 'cash' ? false : null,
    category_id: cat?.id ?? null,
    notes: clip(raw.notes, 400) || null,
  }
}
