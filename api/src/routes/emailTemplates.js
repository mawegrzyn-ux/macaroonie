// src/routes/emailTemplates.js
//
// Admin CRUD for email templates + venue email settings.
// Mounted at /api/email-templates in app.js.

import { z }  from 'zod'
import { withTenant } from '../config/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { httpError } from '../middleware/error.js'
import { sendEmail, renderTemplate, MERGE_FIELDS, buildMergeFields } from '../services/emailSvc.js'
import { DEFAULT_TEMPLATES } from '../services/emailTemplateDefaults.js'
import { env } from '../config/env.js'

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
  email_provider:        z.enum(['sendgrid', 'mailgun', 'ses', 'smtp']).optional(),
  from_name:             z.string().max(200).nullable().optional(),
  from_email:            z.string().email().nullable().optional(),
  reply_to:              z.string().email().nullable().optional(),
  provider_api_key:      z.string().nullable().optional(),
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

export default async function emailTemplateRoutes(app) {
  app.addHook('preHandler', requireAuth)

  // ── Merge fields (for the admin editor) ─────────────────
  app.get('/merge-fields', async () => MERGE_FIELDS)

  // ── Default templates (for the admin editor preview) ─────
  app.get('/defaults', async () => DEFAULT_TEMPLATES)

  // ── GET /email-templates?venue_id=X ─────────────────────
  app.get('/', async (req) => {
    const venueId = req.query.venue_id || null
    return withTenant(req.tenantId, tx => tx`
      SELECT * FROM email_templates
       WHERE tenant_id = ${req.tenantId}
         AND (${!venueId} OR venue_id = ${venueId} OR venue_id IS NULL)
       ORDER BY venue_id NULLS LAST, type
    `)
  })

  // ── POST /email-templates ───────────────────────────────
  app.post('/', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
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
  app.patch('/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
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
  app.delete('/:id', { preHandler: requireRole('admin', 'owner') }, async (req) => {
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
  app.post('/preview', { preHandler: requireRole('admin', 'owner') }, async (req) => {
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
  app.post('/send-test', { preHandler: requireRole('admin', 'owner') }, async (req) => {
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

    const provider = settings?.email_provider || 'sendgrid'
    const credentials = {}
    if (provider === 'sendgrid') {
      credentials.apiKey = settings?.provider_api_key || env.SENDGRID_API_KEY
    } else if (provider === 'mailgun') {
      credentials.apiKey = settings?.provider_api_key
      credentials.domain = settings?.provider_domain
    } else if (provider === 'ses') {
      credentials.region          = settings?.provider_region
      credentials.accessKeyId     = settings?.provider_api_key
      credentials.secretAccessKey = settings?.provider_domain
    } else if (provider === 'smtp') {
      credentials.host   = settings?.smtp_host
      credentials.port   = settings?.smtp_port
      credentials.user   = settings?.smtp_user
      credentials.pass   = settings?.smtp_pass
      credentials.secure = settings?.smtp_secure
    }

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
  app.get('/log', async (req) => {
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

  app.get('/settings/:venueId', async (req) => {
    const [row] = await withTenant(req.tenantId, tx => tx`
      SELECT * FROM venue_email_settings
       WHERE venue_id = ${req.params.venueId}
         AND tenant_id = ${req.tenantId}
    `)
    return row ?? {}
  })

  app.post('/settings/:venueId', { preHandler: requireRole('admin', 'owner') }, async (req, reply) => {
    const body = EmailSettingsBody.parse(req.body)
    const [row] = await withTenant(req.tenantId, async tx => {
      const [venue] = await tx`
        SELECT id FROM venues WHERE id = ${req.params.venueId} AND tenant_id = ${req.tenantId}
      `
      if (!venue) throw httpError(404, 'Venue not found')

      return tx`
        INSERT INTO venue_email_settings (tenant_id, venue_id, email_provider)
        VALUES (${req.tenantId}, ${req.params.venueId}, ${body.email_provider || 'sendgrid'})
        ON CONFLICT (venue_id) DO UPDATE
          SET updated_at = now()
        RETURNING *
      `
    })
    return reply.code(201).send(row)
  })

  app.patch('/settings/:venueId', { preHandler: requireRole('admin', 'owner') }, async (req) => {
    const body   = EmailSettingsBody.parse(req.body)
    const fields = Object.keys(body)
    if (!fields.length) throw httpError(400, 'No fields to update')
    const [row] = await withTenant(req.tenantId, tx => tx`
      UPDATE venue_email_settings
         SET ${tx(body, ...fields)}, updated_at = now()
       WHERE venue_id = ${req.params.venueId}
         AND tenant_id = ${req.tenantId}
      RETURNING *
    `)
    if (!row) throw httpError(404, 'Email settings not found — POST to create first')
    return row
  })
}
