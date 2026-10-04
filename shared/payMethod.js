// shared/payMethod.js
//
// How a staff member is paid (cash_staff.pay_method, migration 140):
//   cash   all cash in hand, from the till
//   bank   all by bank transfer
//   split  a fixed amount by bank transfer each week (cash_staff.bank_amount),
//          the rest cash in hand; a week that pays less than that amount
//          goes all to the bank
// splitPay() is the one place that rule lives. The Rota (rotaCalc.js) uses
// it for each person's bank / cash figures, fill-wages for the wage row's
// bank_amount, and the wages editor to fill Bank when a total is typed.

export const PAY_METHODS = [
  { value: 'cash',  label: 'Cash in hand' },
  { value: 'bank',  label: 'Bank transfer' },
  { value: 'split', label: 'Split' },
]

const round2 = n => Math.round(n * 100) / 100

/** { bank, cash } for a week's pay `total` under a pay method. */
export function splitPay(total, method = 'cash', bankAmount = 0) {
  const t = Math.max(0, round2(Number(total) || 0))
  let bank = 0
  if (method === 'bank') bank = t
  else if (method === 'split') bank = Math.min(t, Math.max(0, round2(Number(bankAmount) || 0)))
  return { bank, cash: round2(t - bank) }
}

/** Short label, e.g. "Bank transfer" or "£200.00 bank, rest cash". */
export function payMethodLabel(method, bankAmount) {
  if (method === 'bank') return 'Bank transfer'
  if (method === 'split') return `£${(Number(bankAmount) || 0).toFixed(2)} bank, rest cash`
  return 'Cash in hand'
}
