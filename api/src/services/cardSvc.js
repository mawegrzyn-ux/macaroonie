// src/services/cardSvc.js
//
// Card machine payments (migration 193): the one place an attempt is
// started, checked, cancelled or refunded. Providers are in
// services/cardMachines/; routes (posApi.js for devices, cardSetup.js for
// Store tech) only call in here. Provider calls never run inside a database
// transaction: a row is written first (pending), the provider is asked, and
// the answer is written back, so a slow card machine holds no locks and a
// crash leaves a pending row that the next check picks up.
//
// Whether a payment reaches a check is decided by the sequencer
// (shared/pos/cards.js) from these rows; this file only keeps them true.

import { withTenant, systemSql } from '../config/db.js'
import { httpError } from '../middleware/error.js'
import { unseal } from './vault.js'
import { provider, FINAL, CardMachineError } from './cardMachines/index.js'
import { checkTotals } from '../../../shared/pos/pricing.js'

// How often a waiting device may make us ask the provider again.
const CHECK_EVERY_MS = 1200
// A sale waiting this long is given up (the card machine timed out long ago).
const GIVE_UP_MS = 15 * 60_000

const ROW = `id, tenant_id, venue_id, reader_id, account_id, provider, kind, sale_id, device_id, staff_id, check_id, payment_id,
  reference, amount, tip, status, message, provider_ref, provider_ref2, card_brand, card_last4, refunded, used_event_id,
  used_at, checked_at, finished_at, created_at, updated_at`

/** What a device or Store tech sees of an attempt. */
export function paymentView(r) {
  if (!r) return null
  return {
    id: r.id, kind: r.kind, sale_id: r.sale_id, reader_id: r.reader_id, provider: r.provider,
    check_id: r.check_id, payment_id: r.payment_id, reference: r.reference,
    amount: r.amount, tip: r.tip, status: r.status, message: r.message,
    card_brand: r.card_brand, card_last4: r.card_last4, card_text: cardText(r),
    refunded: r.refunded, on_check: !!r.used_event_id, used_at: r.used_at,
    created_at: r.created_at, finished_at: r.finished_at,
    device_id: r.device_id, staff_id: r.staff_id,
  }
}

/** "Visa 1234", for the payment's ref on the check and the receipt. */
export function cardText(r) {
  if (r.provider === 'test') return 'Test card'
  return [r.card_brand, r.card_last4 ? '•••• ' + r.card_last4 : null].filter(Boolean).join(' ') || null
}

async function loadRow(tenantId, id) {
  const rows = await withTenant(tenantId, tx => tx`
    SELECT ${tx.unsafe(ROW)} FROM pos_card_payments WHERE id = ${id} AND tenant_id = ${tenantId}`)
  return rows[0] || null
}

/** The account (key unsealed) and reader an attempt uses. */
async function machineFor(tenantId, readerId) {
  return withTenant(tenantId, async tx => {
    const [reader] = await tx`
      SELECT r.*, a.provider AS account_provider, a.secret, a.settings AS account_settings, a.mode
        FROM pos_card_readers r
        LEFT JOIN pos_card_accounts a ON a.id = r.account_id AND a.tenant_id = r.tenant_id
       WHERE r.id = ${readerId} AND r.tenant_id = ${tenantId}`
    if (!reader) throw httpError(404, 'Card machine not found')
    if (reader.provider !== 'test' && !reader.secret) throw httpError(422, 'This card machine\'s account was removed: add it again in Store tech')
    const account = reader.provider === 'test'
      ? { provider: 'test', mode: 'test', settings: {} }
      : { provider: reader.provider, secret: unseal(reader.secret), settings: reader.account_settings || {}, mode: reader.mode }
    return { reader, account, adapter: provider(reader.provider) }
  })
}

async function writeResult(tenantId, id, res, { final = false } = {}) {
  const status = res.status || 'pending'
  const done = final || FINAL.includes(status)
  const rows = await withTenant(tenantId, tx => tx`
    UPDATE pos_card_payments
       SET status = CASE WHEN status IN ('approved', 'declined', 'cancelled', 'failed') THEN status ELSE ${status} END,
           message = COALESCE(${res.message ?? null}, CASE WHEN ${status} IN ('pending', 'signature') THEN NULL ELSE message END),
           provider_ref = COALESCE(${res.provider_ref ?? null}, provider_ref),
           provider_ref2 = COALESCE(${res.provider_ref2 ?? null}, provider_ref2),
           card_brand = COALESCE(${res.card_brand ?? null}, card_brand),
           card_last4 = COALESCE(${res.card_last4 ?? null}, card_last4),
           checked_at = now(),
           finished_at = CASE WHEN finished_at IS NULL AND ${done} THEN now() ELSE finished_at END,
           updated_at = now()
     WHERE id = ${id} AND tenant_id = ${tenantId}
     RETURNING ${tx.unsafe(ROW)}`)
  return rows[0]
}

/** The device's card machine, or a refusal. */
async function deviceReader(tx, device) {
  const id = device.settings?.card_reader
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw httpError(422, 'This ' + (device.kind === 'kiosk' ? 'kiosk' : 'till') + ' has no card machine: pick one in Store tech', { code: 'no_card_machine' })
  }
  const [reader] = await tx`
    SELECT id, name, provider FROM pos_card_readers
     WHERE id = ${id} AND tenant_id = ${device.tenant_id} AND venue_id = ${device.venue_id} AND removed_at IS NULL`
  if (!reader) throw httpError(422, 'This device\'s card machine was removed: pick another in Store tech', { code: 'no_card_machine' })
  return reader
}

/**
 * Start a sale on the device's card machine. Till: check_id (open, at this
 * venue, the amount no more than is left to pay on the server's copy, so
 * send the check's events first). Kiosk: no check yet (its order is sent
 * once paid), the amount is the order's total.
 */
export async function startSale(device, { check_id = null, payment_id, amount, tip = 0, staff_id = null, reference = null }) {
  const tenantId = device.tenant_id
  const reader = await withTenant(tenantId, async tx => {
    const reader = await deviceReader(tx, device)
    if (device.kind !== 'kiosk') {
      if (!check_id) throw httpError(422, 'Which check is this for?')
      const [c] = await tx`SELECT status, state FROM pos_checks WHERE id = ${check_id} AND tenant_id = ${tenantId} AND venue_id = ${device.venue_id}`
      if (!c) throw httpError(409, 'The check isn\'t on the server yet: wait for the till to send it and try again', { code: 'not_synced' })
      if (c.status !== 'open') throw httpError(409, 'This check is closed')
      const left = checkTotals(c.state).balance
      if (amount > left) throw httpError(409, 'That is more than is left to pay on the check (£' + (left / 100).toFixed(2) + '): wait for the till to send its changes', { code: 'not_synced' })
    } else if (check_id) {
      throw httpError(422, 'A kiosk pays before its order exists')
    }
    // One payment at a time per card machine.
    const busy = await tx`
      SELECT id, created_at FROM pos_card_payments
       WHERE reader_id = ${reader.id} AND tenant_id = ${tenantId} AND status IN ('pending', 'signature')
         AND created_at > now() - make_interval(secs => ${GIVE_UP_MS / 1000})`
    if (busy.length) throw httpError(409, 'The card machine is busy with another payment: finish or cancel it first', { code: 'busy', payment_id: busy[0].id })
    const [dup] = await tx`SELECT id FROM pos_card_payments WHERE venue_id = ${device.venue_id} AND payment_id = ${payment_id}`
    if (dup) throw httpError(409, 'This payment was already started', { code: 'duplicate', card_payment_id: dup.id })
    return reader
  })
  const [row] = await withTenant(tenantId, tx => tx`
    INSERT INTO pos_card_payments (tenant_id, venue_id, reader_id, account_id, provider, kind, device_id, staff_id, check_id,
                                   payment_id, reference, amount, tip)
    SELECT ${tenantId}, ${device.venue_id}, r.id, r.account_id, r.provider, 'sale', ${device.id}, ${staff_id}, ${check_id},
           ${payment_id}, ${reference}, ${amount}, ${tip}
      FROM pos_card_readers r WHERE r.id = ${reader.id} AND r.tenant_id = ${tenantId}
    RETURNING ${tx.unsafe(ROW)}`)
  let res
  try {
    const m = await machineFor(tenantId, reader.id)
    res = await m.adapter.startSale(m.account, m.reader, row)
  } catch (e) {
    // Unreachable: it may or may not have reached the machine; the next
    // check asks again (a payment intent without a reader action can't take money).
    if (e instanceof CardMachineError && e.retry) return paymentView(await writeResult(tenantId, row.id, { status: 'pending', message: e.message }))
    return paymentView(await writeResult(tenantId, row.id, { status: 'failed', message: e.message || 'The card machine couldn\'t be reached' }))
  }
  return paymentView(await writeResult(tenantId, row.id, res))
}

/** Ask the provider how a sale is going (at most every CHECK_EVERY_MS), and return it. */
export async function refreshPayment(tenantId, id, { force = false } = {}) {
  const row = await loadRow(tenantId, id)
  if (!row) return null
  if (FINAL.includes(row.status) || row.kind !== 'sale') return row
  if (!force && row.checked_at && Date.now() - new Date(row.checked_at).getTime() < CHECK_EVERY_MS) return row
  if (Date.now() - new Date(row.created_at).getTime() > GIVE_UP_MS && row.status !== 'signature') {
    const m = await machineFor(tenantId, row.reader_id).catch(() => null)
    if (m && row.provider_ref) {
      const late = await m.adapter.saleStatus(m.account, m.reader, row).catch(() => null)
      if (late && FINAL.includes(late.status)) return writeResult(tenantId, id, late)
      await m.adapter.cancelSale(m.account, m.reader, row).catch(() => {})
    }
    return writeResult(tenantId, id, { status: 'cancelled', message: 'The card machine timed out' })
  }
  if (!row.provider_ref && row.provider !== 'test') {
    // Never reached the provider: try to start it again.
    const m = await machineFor(tenantId, row.reader_id)
    try { return await writeResult(tenantId, id, await m.adapter.startSale(m.account, m.reader, row)) } catch (e) {
      return writeResult(tenantId, id, { status: e.retry ? 'pending' : 'failed', message: e.message })
    }
  }
  const m = await machineFor(tenantId, row.reader_id)
  try {
    return await writeResult(tenantId, id, await m.adapter.saleStatus(m.account, m.reader, row))
  } catch (e) {
    if (e instanceof CardMachineError && e.retry) return writeResult(tenantId, id, { status: row.status, message: e.message })
    throw httpError(e.status || 422, e.message)
  }
}

/** A device's own attempt (404 for any other device's). */
export async function devicePayment(device, id) {
  const row = await loadRow(device.tenant_id, id)
  if (!row || row.venue_id !== device.venue_id) throw httpError(404, 'Card payment not found')
  return row
}

export async function cancelSale(device, id) {
  const row = await devicePayment(device, id)
  if (FINAL.includes(row.status)) return paymentView(row)
  const m = await machineFor(device.tenant_id, row.reader_id)
  await m.adapter.cancelSale(m.account, m.reader, row).catch(() => {})
  // The provider has the last word: a card tapped just before the cancel
  // still counts. Give it a moment, then ask.
  if (row.provider === 'test') return paymentView(await writeResult(device.tenant_id, id, { status: 'cancelled', message: 'Cancelled on the till' }))
  const now = await m.adapter.saleStatus(m.account, m.reader, row).catch(() => null)
  if (now && FINAL.includes(now.status)) return paymentView(await writeResult(device.tenant_id, id, now))
  return paymentView(await writeResult(device.tenant_id, id, { status: 'pending', message: 'Cancelling on the card machine…' }))
}

export async function answerSignature(device, id, accepted) {
  const row = await devicePayment(device, id)
  if (row.status !== 'signature') throw httpError(409, 'The card machine isn\'t asking about a signature')
  const m = await machineFor(device.tenant_id, row.reader_id)
  if (!m.adapter.answerSignature) throw httpError(422, 'This card machine doesn\'t ask for signatures')
  try { await m.adapter.answerSignature(m.account, m.reader, row, accepted) } catch (e) { throw httpError(e.status || 422, e.message) }
  return paymentView(await writeResult(device.tenant_id, id, { status: 'pending' }))
}

/** The test card machine's Approve / Decline, or a Stripe test card. */
export async function simulateSale(device, id, result) {
  const row = await devicePayment(device, id)
  if (FINAL.includes(row.status)) return paymentView(row)
  const m = await machineFor(device.tenant_id, row.reader_id)
  if (row.provider === 'test') {
    return paymentView(await writeResult(device.tenant_id, id, result === 'approve'
      ? { status: 'approved', card_brand: 'Test', card_last4: '4242' }
      : { status: 'declined', message: 'Declined (test card)' }))
  }
  if (!m.adapter.simulate) throw httpError(422, 'Test cards only work on a test card machine')
  try { await m.adapter.simulate(m.account, m.reader, row, result) } catch (e) { throw httpError(e.status || 422, e.message) }
  return paymentView(await refreshPayment(device.tenant_id, id, { force: true }))
}

/**
 * Refund to the card: of a sale that is on this check (used), up to what is
 * left of it. The refund row is approved or failed when this returns; the
 * till then records refund.added (or payment.voided) naming it.
 */
export async function startRefund(device, { sale_id, check_id, amount, refund_id, staff_id = null }) {
  const tenantId = device.tenant_id
  const sale = await devicePayment(device, sale_id)
  if (sale.kind !== 'sale' || sale.status !== 'approved') throw httpError(422, 'Only an approved card payment can be refunded to the card')
  if (!sale.used_event_id || sale.check_id !== check_id) throw httpError(422, 'This card payment isn\'t on this check')
  const left = sale.amount + sale.tip - sale.refunded
  if (amount > left) throw httpError(422, 'That is more than is left of the card payment (£' + (left / 100).toFixed(2) + ')')
  const [row] = await withTenant(tenantId, async tx => {
    const [dup] = await tx`SELECT ${tx.unsafe(ROW)} FROM pos_card_payments WHERE venue_id = ${device.venue_id} AND payment_id = ${refund_id}`
    if (dup) return [dup]
    return tx`
      INSERT INTO pos_card_payments (tenant_id, venue_id, reader_id, account_id, provider, kind, sale_id, device_id, staff_id,
                                     check_id, payment_id, amount, reference)
      VALUES (${tenantId}, ${device.venue_id}, ${sale.reader_id}, ${sale.account_id}, ${sale.provider}, 'refund', ${sale.id},
              ${device.id}, ${staff_id}, ${check_id}, ${refund_id}, ${amount}, ${sale.reference})
      RETURNING ${tx.unsafe(ROW)}`
  })
  if (row.kind !== 'refund' || row.sale_id !== sale.id) throw httpError(409, 'This refund id is already used')
  if (FINAL.includes(row.status)) return paymentView(row)
  let res
  try {
    const m = await machineFor(tenantId, sale.reader_id)
    res = await m.adapter.refund(m.account, sale, { amount, refund_id: row.id })
  } catch (e) {
    res = { status: 'failed', message: e.message || 'The refund couldn\'t be sent' }
  }
  const done = await writeResult(tenantId, row.id, res, { final: true })
  if (done.status === 'approved') {
    await withTenant(tenantId, tx => tx`
      UPDATE pos_card_payments SET refunded = refunded + ${amount}, updated_at = now()
       WHERE id = ${sale.id} AND tenant_id = ${tenantId}`)
  }
  return paymentView(done)
}

/** A device's attempts for a check (resume after a reload), or its own recent ones. */
export async function devicePayments(device, { check_id = null } = {}) {
  return withTenant(device.tenant_id, async tx => {
    const rows = check_id
      ? await tx`SELECT ${tx.unsafe(ROW)} FROM pos_card_payments
                  WHERE tenant_id = ${device.tenant_id} AND venue_id = ${device.venue_id} AND check_id = ${check_id}
                  ORDER BY created_at DESC LIMIT 50`
      : await tx`SELECT ${tx.unsafe(ROW)} FROM pos_card_payments
                  WHERE tenant_id = ${device.tenant_id} AND device_id = ${device.id}
                    AND created_at > now() - interval '1 day'
                  ORDER BY created_at DESC LIMIT 20`
    return rows.map(paymentView)
  })
}

/** Sales left waiting by devices that went away: the minute sweep asks once more. */
export async function sweepPending() {
  const rows = await systemSql`
    SELECT id, tenant_id FROM pos_card_payments
     WHERE status IN ('pending', 'signature') AND kind = 'sale'
       AND (checked_at IS NULL OR checked_at < now() - interval '1 minute')
     ORDER BY created_at LIMIT 50`
  for (const r of rows) await refreshPayment(r.tenant_id, r.id, { force: true }).catch(() => {})
  return rows.length
}

/** What a till or kiosk knows about its card machine (config), or null. */
export async function cardMachineOf(tx, tenantId, venueId, readerId) {
  if (!readerId || !/^[0-9a-f-]{36}$/i.test(readerId)) return null
  const [r] = await tx`
    SELECT r.id, r.name, r.provider, a.mode
      FROM pos_card_readers r
      LEFT JOIN pos_card_accounts a ON a.id = r.account_id AND a.tenant_id = r.tenant_id
     WHERE r.id = ${readerId} AND r.tenant_id = ${tenantId} AND r.venue_id = ${venueId} AND r.removed_at IS NULL`
  if (!r) return null
  const p = provider(r.provider)
  return {
    id: r.id, name: r.name, provider: r.provider, provider_label: p.label,
    test: r.provider === 'test' || r.mode === 'test',
    // A test card can be presented from the till: the test machine, or a provider's test mode.
    can_simulate: r.provider === 'test' || (r.mode === 'test' && !!p.simulate),
    signature: !!p.signature,
  }
}
