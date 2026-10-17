// src/services/reconFill.js
//
// Writes figures from a till system into a Cash Recon day: income sources,
// payment channels (takings) and service charge sources. Used by the
// Loyverse fill (routes/loyverse.js), the GloriaFood fill
// (routes/gloriafood.js) and the Macaroonie till's Z report
// (services/posSvc.js), so all fill a day the same way:
//   - the day's report row is created if missing; a submitted day is skipped
//   - each mapped field's entry is replaced, keeping its notes
//   - income is split into net and VAT like the day view does
//   - the day records who filled it and when (<source>_filled_at / _by)

const round2 = n => Math.round(n * 100) / 100

/** An income amount (gross, pounds) split into net and VAT like the day
 *  view: { gross, vat, net }. source: { vat_rate, vat_inclusive }. */
export function splitIncome(amount, source) {
  const gross = round2(Number(amount) || 0)
  const rate = Number(source?.vat_rate || 0) / 100
  let vat = 0, net = gross
  if (rate > 0) {
    if (source?.vat_inclusive) { net = gross / (1 + rate); vat = gross - net }
    else vat = gross * rate
  }
  return { gross, vat: round2(vat), net: round2(net) }
}

const STAMPS = {
  loyverse:   ['loyverse_filled_at', 'loyverse_filled_by'],
  pos:        ['pos_filled_at', 'pos_filled_by'],
  gloriafood: ['gloriafood_filled_at', 'gloriafood_filled_by'],
}

/**
 * fields: [{ group: 'income' | 'takings' | 'sc', id, amount (pounds),
 *            source: { vat_rate, vat_inclusive } for income }]
 * Returns { filled: true } or { skipped: 'submitted' }.
 */
export async function fillReconDay(tx, { tenantId, venueId, date, fields, source, by }) {
  await tx`
    INSERT INTO cash_daily_reports (tenant_id, venue_id, report_date)
    VALUES (${tenantId}, ${venueId}, ${date}::date)
    ON CONFLICT (tenant_id, venue_id, report_date) DO NOTHING
  `
  const [report] = await tx`
    SELECT id, status FROM cash_daily_reports
     WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND report_date = ${date}::date
     FOR UPDATE
  `
  if (report.status === 'submitted') return { skipped: 'submitted' }

  for (const f of fields) {
    const amount = round2(Number(f.amount) || 0)
    if (f.group === 'income') {
      const { vat, net } = splitIncome(amount, f.source)
      const [old] = await tx`
        DELETE FROM cash_income_entries
         WHERE tenant_id = ${tenantId} AND report_id = ${report.id} AND source_id = ${f.id}
        RETURNING notes`
      await tx`
        INSERT INTO cash_income_entries (tenant_id, report_id, source_id, gross_amount, vat_amount, net_amount, notes)
        VALUES (${tenantId}, ${report.id}, ${f.id}, ${amount}, ${vat}, ${net}, ${old?.notes ?? null})`
    } else if (f.group === 'takings') {
      const [old] = await tx`
        DELETE FROM cash_takings_entries
         WHERE tenant_id = ${tenantId} AND report_id = ${report.id} AND channel_id = ${f.id}
        RETURNING notes`
      await tx`
        INSERT INTO cash_takings_entries (tenant_id, report_id, channel_id, amount, notes)
        VALUES (${tenantId}, ${report.id}, ${f.id}, ${amount}, ${old?.notes ?? null})`
    } else if (f.group === 'sc') {
      const [old] = await tx`
        DELETE FROM cash_sc_entries
         WHERE tenant_id = ${tenantId} AND report_id = ${report.id} AND source_id = ${f.id}
        RETURNING notes`
      await tx`
        INSERT INTO cash_sc_entries (tenant_id, report_id, source_id, amount, notes)
        VALUES (${tenantId}, ${report.id}, ${f.id}, ${amount}, ${old?.notes ?? null})`
    }
  }

  const [atCol, byCol] = STAMPS[source] || STAMPS.loyverse
  await tx`
    UPDATE cash_daily_reports
       SET ${tx(atCol)} = now(), ${tx(byCol)} = ${by ?? null}, updated_at = now()
     WHERE id = ${report.id} AND tenant_id = ${tenantId}
  `
  return { filled: true }
}

/** A venue's active Cash Recon fields: { income, sc, takings }. */
export async function reconFields(tx, tenantId, venueId) {
  const [income, sc, takings] = await Promise.all([
    tx`SELECT id, name, vat_rate::float8 AS vat_rate, vat_inclusive FROM cash_income_sources
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active = true ORDER BY sort_order, name`,
    tx`SELECT id, name FROM cash_sc_sources
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active = true ORDER BY sort_order, name`,
    tx`SELECT id, name FROM cash_payment_channels
        WHERE tenant_id = ${tenantId} AND venue_id = ${venueId} AND is_active = true ORDER BY sort_order, name`,
  ])
  return { income, sc, takings }
}
