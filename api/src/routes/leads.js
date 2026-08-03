// src/routes/leads.js
//
// Public "register interest" capture for the marketing site (apex domain,
// see /marketing/index.html). No auth — this runs before anyone is a
// tenant. Global rate limiting (app.js) covers abuse; a honeypot field
// catches basic bots.
//
// Mounted at /api/leads (see app.js).

import { z }           from 'zod'
import { sql }         from '../config/db.js'
import { env }         from '../config/env.js'
import { sendEmail }   from '../services/emailSvc.js'

const LeadBody = z.object({
  name:       z.string().min(1).max(200),
  email:      z.string().email(),
  venue_name: z.string().max(200).nullable().optional(),
  message:    z.string().max(2000).nullable().optional(),
  // Hidden field — real visitors never fill it in, bots often do.
  company:    z.string().max(0).optional().default(''),
})

export default async function leadsRoutes(app) {
  app.post('/', async (req, reply) => {
    const body = LeadBody.parse(req.body)

    const [lead] = await sql`
      INSERT INTO leads (name, email, venue_name, message)
      VALUES (${body.name}, ${body.email}, ${body.venue_name ?? null}, ${body.message ?? null})
      RETURNING id
    `

    if (env.LEADS_NOTIFY_EMAIL && env.SENDGRID_API_KEY) {
      sendEmail({
        provider: 'sendgrid',
        credentials: { apiKey: env.SENDGRID_API_KEY },
        from:    { name: 'Macaroonie', email: env.EMAIL_FROM },
        to:      env.LEADS_NOTIFY_EMAIL,
        subject: `New Macaroonie interest — ${body.name}`,
        html: `
          <p><strong>Name:</strong> ${escapeHtml(body.name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(body.email)}</p>
          ${body.venue_name ? `<p><strong>Venue:</strong> ${escapeHtml(body.venue_name)}</p>` : ''}
          ${body.message ? `<p><strong>Message:</strong><br>${escapeHtml(body.message).replace(/\n/g, '<br>')}</p>` : ''}
        `,
      }).catch(e => req.log.warn({ err: e }, 'lead notification email failed — lead was still saved'))
    }

    reply.code(201)
    return { id: lead.id }
  })
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
