// src/routes/emailTemplates.js
//
// Admin CRUD for email templates + venue email settings.
// Mounted at /api/email-templates in app.js.

import { z }  from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requirePermission, permissionLevel } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { sendEmail, renderTemplate, MERGE_FIELDS, buildMergeFields, emailCredentials } from '../services/emailSvc.js'
import { seal, unseal } from '../services/vault.js'
import { DEFAULT_TEMPLATES } from '../services/emailTemplateDefaults.js'
import { env } from '../config/env.js'

// Booking emails permission: view reads (secrets hidden), manage changes.
const PERM = {
  view:   requirePermission('email_templates', 'view'),
  manage: requirePermission('email_templates', 'manage'),
}

const TemplateBody = z.object({
  venue_id:  z.string().uuid().nullable().optional(),
  type:      z.enum(['confirmation', 'reminder', 'modification', 'cancellation']),
  subject:   z.string().max(500),
  body_html: z.string(),
  is_active: z.boolean().default(true),
})

const TemplatePatch = z.object({
  subject:   z.string().max(500).optional(),
  body_html: z.string().optional(),
  is_active: z.boolean().optional(),
})

const EmailSettingsBody = z.object({
  email_provider:        z.enum(['sendgrid', 'postmark', 'mailgun', 'ses', 'smtp']).optional(),
  from_name:             z.string().max(200).nullable().optional(),
  from_email:            z.string().email().nullable().optional(),
  reply_to:              z.string().email().nullable().optional(),
  // Keys: a string replaces the saved one (stored sealed, migration 179),
  // null removes it, left out (or empty) keeps it.
  provider_api_key:      z.string().nullable().optional(),
  provider_secret:       z.string().nullable().optional(),   // SES secret access key
  provider_domain:       z.string().nullable().optional(),
  provider_region:       z.string().nullable().optional(),
  smtp_host:             z.string().nullable().optional(),
  smtp_port:             z.coerce.number().int().nullable().optional(),
  smtp_user:             z.string().nullable().optional(),
  smtp_pass:             z.string().nullable().optional(),
  smtp_secure:           z.boolean().optional(),
  reminder_enabled:      z.boolean().optional(),
  reminder_hours_before: z.coerce.number().int().min(1).max(168).optional(),
  allow_guest_modify:    z.boolean().optional(),
  allow_guest_cancel:    z.boolean().optional(),
  cancel_cutoff_hours:   z.coerce.number().int().min(0).optional(),
})

// Provider keys are never sent back, sealed or not: people who can change
// the settings see the last four characters, others nothing.
const SECRET_FIELDS = ['provider_api_key', 'provider_secret', 'smtp_pass']
function settingsView(row, manage) {
  const out = { ...row }
  for (const k of SECRET_FIELDS) {
    out[k] = null
    if (!manage || !row[k]) continue
    try { out[k + '_hint'] = unseal(row[k]).slice(-4) } catch { out[k + '_hint'] = '????' }
  }
  if (!manage) out.secrets_hidden = true
  return out
}

export default async function emailTemplateRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Merge fields (for the admin editor) ─────────────────
  app.get('/merge-fields', async () => MERGE_FIELDS)

  // ── Default templates (for the admin editor preview) ─────
  app.get('/defaults', async () => DEFAULT_TEMPLATES)

  // ── GET /email-templates?venue_id=X ─────────────────────
  app.get('/', { preHandler: PERM.view }, async (req) => {
    const venueId = req.query.venue_id || null
    return withTenant(req.tenantId, tx => tx`
      SELECT * FROM email_templates
       WHERE tenant_id = ${req.tenantId}
         AND (${!venueId} OR venue_id = ${venueId} OR venue_id IS NULL)
       ORDER BY venue_id NULLS LAST, type
    `)
  })

  // ── POST /email-templates ───────────────────────────────
  app.post('/', { preHandler: PERM.manage}, async (req, reply) => {
    const body = TemplateBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, tx => tx`
      INSERT INTO email_templates
        (tenant_id, venue_id, type, subject, body_html, is_active)
      VALUES
        (${req.tenantId}, ${body.venue_id ?? null}, ${body.type},
         ${body.subject}, ${body.body_html}, ${body.is_active})
      ON CONFLICT (tenant_id, venue_id, type) DO UPDATE
        SET subject   = EXCLUDED.subject,
            body_html = EXCLUDED.body_html,
            is_active = EXCLUDED.is_active,
            updated_at = now()
      RETURNING *
    `)
    return reply.code(201).send(row)
  })

  // ── PATCH /email-templates/:id ──────────────────────────
  app.patch('/:id', { preHandler: PERM.manage}, async (req) => {
    const body   = TemplatePatch.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE email_templates
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE id = ${req.params.id}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Template not found')
    return row
  })

  // ── DELETE /email-templates/:id ─────────────────────────
  app.delete('/:id', { preHandler: PERM.manage}, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      DELETE FROM email_templates
       WHERE id = ${req.params.id} AND tenant_id = ${req.tenantId}
      RETURNING id
    `)
    if (!row) throw httpError(404, 'Template not found')
    return { ok: true }
  })

  // ── POST /email-templates/preview ───────────────────────
  // Renders a template with sample data for the admin preview.
  app.post('/preview', { preHandler: PERM.view}, async (req) => {
    const { subject, body_html } = z.object({
      subject:   z.string(),
      body_html: z.string(),
    }).parse(req.body)

    const sampleFields = {}
    for (const f of MERGE_FIELDS) {
      sampleFields[f.key] = f.example
    }

    return {
      subject: renderTemplate(subject,   sampleFields),
      html:    renderTemplate(body_html, sampleFields),
    }
  })

  // ── POST /email-templates/send-test ─────────────────────
  // Send a real test email through the venue's configured provider.
  // Resolves the active template (custom → built-in default) and renders
  // with sample merge fields. Logs to email_log with booking_id NULL so
  // it's distinguishable from real bookings.
  //
  // Body: { venue_id, type: 'confirmation'|'reminder'|'modification'|'cancellation', to: string }
  // Used by the Widget Test page and the Email Templates settings tab.
  app.post('/send-test', { preHandler: PERM.manage}, async (req) => {
    const body = z.object({
      venue_id: z.string().uuid(),
      type:     z.enum(['confirmation', 'reminder', 'modification', 'cancellation']),
      to:       z.string().email(),
    }).parse(req.body)

    const data = await withTenant(req.tenantId, async tx => {
      const [venue] = await tx`
        SELECT v.*, wc.phone AS site_phone, wc.email AS site_email,
               wc.address_line1, wc.city, wc.postcode
          FROM venues v
          LEFT JOIN website_config wc ON wc.venue_id = v.id
         WHERE v.id = ${body.venue_id}
      `
      if (!venue) return null

      const [tpl] = await tx`
        SELECT * FROM email_templates
         WHERE tenant_id = ${req.tenantId}
           AND type = ${body.type}
           AND is_active = true
           AND (venue_id = ${body.venue_id} OR venue_id IS NULL)
         ORDER BY venue_id NULLS LAST
         LIMIT 1
      `
      const [settings] = await tx`
        SELECT * FROM venue_email_settings
         WHERE venue_id = ${body.venue_id}
           AND tenant_id = ${req.tenantId}
      `
      return { venue, tpl, settings }
    })

    if (!data) throw httpError(404, 'Venue not found')
    const { venue, tpl, settings } = data

    // Sample merge fields (matches the preview endpoint shape)
    const sampleFields = Object.fromEntries(MERGE_FIELDS.map(f => [f.key, f.example]))
    sampleFields.guest_email = body.to
    sampleFields.venue_name  = venue.name
    sampleFields.manage_link = `${env.PUBLIC_SITE_SCHEME}://${env.PUBLIC_ROOT_DOMAIN}/manage/00000000-0000-0000-0000-000000000000`

    const template = tpl
      ? { subject: tpl.subject, body_html: tpl.body_html }
      : DEFAULT_TEMPLATES[body.type]
    if (!template) throw httpError(400, `No template for type '${body.type}'`)

    const subject = '[TEST] ' + renderTemplate(template.subject, sampleFields)
    const html    = renderTemplate(template.body_html, sampleFields)

    const { provider, credentials } = emailCredentials(settings, env)

    const fromName  = settings?.from_name  || venue.name || 'Macaroonie'
    const fromEmail = settings?.from_email || env.EMAIL_FROM
    const replyTo   = settings?.reply_to   || null

    let result
    try {
      result = await sendEmail({
        provider, credentials,
        from: { name: fromName, email: fromEmail },
        to:   body.to,
        replyTo, subject, html,
      })
    } catch (err) {
      // Log the failure
      await withTenant(req.tenantId, tx => tx`
        INSERT INTO email_log
          (tenant_id, booking_id, template_type, recipient, subject,
           provider, provider_id, status, error, sent_at)
        VALUES
          (${req.tenantId}, NULL, ${body.type + '_test'}, ${body.to}, ${subject},
           ${provider}, NULL, 'failed', ${err.message}, NULL)
      `).catch(() => {})
      throw httpError(422, `Test email failed: ${err.message}`)
    }

    // Log success
    await withTenant(req.tenantId, tx => tx`
      INSERT INTO email_log
        (tenant_id, booking_id, template_type, recipient, subject,
         provider, provider_id, status, error, sent_at)
      VALUES
        (${req.tenantId}, NULL, ${body.type + '_test'}, ${body.to}, ${subject},
         ${result.provider}, ${result.providerId}, 'sent', NULL, now())
    `).catch(() => {})

    return {
      ok:        true,
      provider:  result.provider,
      messageId: result.providerId,
      to:        body.to,
      subject,
    }
  })

  // ── GET /email-templates/log?venue_id=X&limit=50 ────────
  app.get('/log', { preHandler: PERM.view }, async (req) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    return withTenant(req.tenantId, tx => tx`
      SELECT el.*, b.guest_name, b.covers, b.starts_at
        FROM email_log el
        LEFT JOIN bookings b ON b.id = el.booking_id
       WHERE el.tenant_id = ${req.tenantId}
       ORDER BY el.created_at DESC
       LIMIT ${limit}
    `)
  })

  // ── Venue email settings ────────────────────────────────

  app.get('/settings/:venueId', { preHandler: PERM.view }, async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      SELECT * FROM venue_email_settings
       WHERE venue_id = ${req.params.venueId}
         AND tenant_id = ${req.tenantId}
    `)
    if (!row) return {}
    return settingsView(row, await permissionLevel(req, 'email_templates') === 'manage')
  })

  // POST + PATCH are aliases — both upsert the venue_email_settings row
  // with whatever body fields are supplied. Originally POST ignored the
  // body (only persisted email_provider) which silently dropped credentials
  // on the first save. Now both go through the same upsert.
  const upsertSettings = async (req, reply, statusCode) => {
    const body = EmailSettingsBody.parse(req.body)
    for (const k of SECRET_FIELDS) {
      if (body[k] === '' || body[k] === undefined) delete body[k]
      else if (body[k] !== null) body[k] = seal(body[k])
    }
    const fields = Object.keys(body)

    const [row] = await withTenant(req.tenantId, async tx => {
      const [venue] = await tx`
        SELECT id FROM venues WHERE id = ${req.params.venueId} AND tenant_id = ${req.tenantId}
      `
      if (!venue) throw httpError(404, 'Venue not found')

      // Ensure a row exists, then dynamically UPDATE the supplied fields.
      // Two-step (rather than INSERT...ON CONFLICT DO UPDATE SET ...) so we
      // don't have to enumerate every column twice.
      await tx`
        INSERT INTO venue_email_settings (tenant_id, venue_id, email_provider)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${body.email_provider || 'sendgrid'})
        ON CONFLICT (venue_id) DO NOTHING
      `

      if (fields.length) {
        return tx`
          UPDATE venue_email_settings
             SET ${tx(body, ...fields)}, updated_at = now()
           WHERE venue_id = ${req.params.venueId}
             AND tenant_id = ${req.tenantId}
          RETURNING *
        `
      } else {
        return tx`
          SELECT * FROM venue_email_settings
           WHERE venue_id = ${req.params.venueId} AND tenant_id = ${req.tenantId}
        `
      }
    })

    return reply.code(statusCode).send(settingsView(row, true))
  }

  app.post('/settings/:venueId',  { preHandler: PERM.manage},
    (req, reply) => upsertSettings(req, reply, 201))

  app.patch('/settings/:venueId', { preHandler: PERM.manage},
    (req, reply) => upsertSettings(req, reply, 200))
}
