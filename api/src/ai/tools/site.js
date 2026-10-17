// src/ai/tools/site.js
//
// Website, promotions, reviews, menu screens, booking emails and support
// for Pepper (staff assistant and staff MCP). Permissions are the pages':
//
//   website_status       site address, live or not, publish status and
//                        what is waiting to be published, the banner        website, view
//   publish_website      publish the site now                                website, manage
//   set_website_banner   the emergency banner on every page (on / off)       website, manage
//   list_promotions      promotions with what they give, when, uses          promotions, view
//   switch_promotion     turn a promotion on or off                          promotions, manage
//   list_reviews         recent reviews, rating, approved / featured         website, view
//   moderate_review      approve, hide, feature, unfeature, reply            website, manage
//   screens_status       menu screens: online, what they show, last seen     screens, view
//   reload_screen        make a screen load again                            screens, manage
//   email_log            booking emails sent, failed or waiting              email_templates, view
//   report_issue         log a problem with the app (issue log)              issue_log, manage
//   list_issues          the restaurant's logged issues                      issue_log, view
//   request_feature      ask for something new (feature requests)            feature_requests, manage
//
// Reads and writes go through the admin routes (callApi).

import { z } from 'zod'
import { ToolError, callApi, requireStaffPermission } from '../context.js'
import { env } from '../../config/env.js'
import { promoSummary, promoTerms, promoRunning } from '../../../../shared/promotions.js'
import { localParts, shortDate, plural, pickByName, audited, venueFor, venueToday, VenueText, tenantVenueList } from './util.js'

const when = (ts, tz) => {
  if (!ts) return null
  const p = localParts(ts, tz)
  return shortDate(p.date) + ' ' + p.time
}
async function tzOf(ctx) {
  const venues = await tenantVenueList(ctx)
  return venues[0]?.timezone || 'Europe/London'
}

const SEVERITY = { info: 'information', warn: 'warning', alert: 'urgent' }
const PRIORITY = { p1: 'P1 (critical)', p2: 'P2 (high)', p3: 'P3 (medium)', p4: 'P4 (low)' }

async function reviewPick(ctx, input) {
  const list = await callApi(ctx, 'GET', '/api/reviews?limit=200&sort=newest')
  const raw = input.review.trim()
  const byId = list.find(r => r.id === raw)
  if (byId) return byId
  const hits = list.filter(r => (r.reviewer_name || '').toLowerCase().includes(raw.toLowerCase()) ||
    (r.review_text || '').toLowerCase().includes(raw.toLowerCase()))
  if (hits.length === 1) return hits[0]
  if (!hits.length) throw new ToolError('No review matches "' + raw + '".', 404)
  throw new ToolError('More than one review matches "' + raw + '": ' +
    hits.slice(0, 8).map(r => (r.reviewer_name || 'Anonymous') + ' (' + r.rating + ' stars, ' + (r.review_date ? String(r.review_date).slice(0, 10) : 'no date') + ')').join('; ') + '. Which one?', 409)
}

const MODERATE = {
  approve: { is_approved: true }, hide: { is_approved: false },
  feature: { is_featured: true, is_approved: true }, unfeature: { is_featured: false },
}

export const siteTools = [
  {
    name: 'website_status',
    section: 'website',
    title: 'Website status',
    description:
      'The restaurant\'s website: its address (and custom domain), whether it is live, when it was last published, what is ' +
      'changed but not published yet, a scheduled publish, and the emergency banner.',
    input: z.object({}),
    readOnly: true,
    async run(ctx) {
      await requireStaffPermission(ctx, 'website', 'view')
      const [site, status] = await Promise.all([
        callApi(ctx, 'GET', '/api/website/tenant-site'),
        callApi(ctx, 'GET', '/api/website/tenant-site/publish-status'),
      ])
      const tz = await tzOf(ctx)
      return {
        address: site.subdomain_slug ? site.subdomain_slug + '.' + env.PUBLIC_ROOT_DOMAIN : null,
        ...(site.custom_domain ? { custom_domain: site.custom_domain + (site.custom_domain_verified ? '' : ' (not verified yet)') } : {}),
        live: site.is_published ? 'yes' : 'no (the site is switched off)',
        published: status.never_published ? 'never published' : when(status.published_at, tz),
        ...(status.scheduled_publish_at ? { scheduled_publish: when(status.scheduled_publish_at, tz) } : {}),
        waiting_to_publish: status.in_sync ? 'nothing: the live site matches' : (status.changes || []).map(c => c.label + (c.kind && c.kind !== 'changed' ? ' (' + c.kind + ')' : '')),
        banner: site.banner_enabled ? SEVERITY[site.banner_severity || 'info'] + ': ' + (site.banner_text || '') : 'off',
      }
    },
  },

  {
    name: 'publish_website',
    section: 'website',
    title: 'Publish the website',
    description: 'Publishes every saved website change now (the card lists them). Replaces a scheduled publish.',
    input: z.object({}),
    confirm: true,
    async describe(ctx) {
      await requireStaffPermission(ctx, 'website', 'manage')
      const status = await callApi(ctx, 'GET', '/api/website/tenant-site/publish-status')
      if (status.in_sync) throw new ToolError('Nothing to publish: the live site already matches.', 422)
      const tz = await tzOf(ctx)
      return {
        title: 'Publish the website?',
        lines: status.never_published ? ['First publish: the whole site goes live'] : (status.changes || []).map(c => c.label),
        ...(status.scheduled_publish_at ? { warningTitle: 'Check', warnings: ['The publish scheduled for ' + when(status.scheduled_publish_at, tz) + ' is replaced.'] } : {}),
        confirmLabel: 'Publish',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'website', 'manage')
      return audited(ctx, 'publish_website', input, async () => {
        await callApi(ctx, 'POST', '/api/website/tenant-site/publish', { body: {} })
        return { message: 'Published.' }
      })
    },
  },

  {
    name: 'set_website_banner',
    section: 'website',
    title: 'Website banner',
    description:
      'Turns the emergency banner on every page of the website on (with text, how urgent, an optional link) or off, ' +
      'e.g. "Closed today due to a power cut". It shows straight away, no publish needed.',
    input: z.object({
      on: z.boolean(),
      text: z.string().trim().max(500).optional(),
      severity: z.enum(['info', 'warn', 'alert']).optional(),
      link_url: z.string().trim().max(500).optional(),
      link_text: z.string().trim().max(100).optional(),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'website', 'manage')
      const site = await callApi(ctx, 'GET', '/api/website/tenant-site')
      if (input.on && !(input.text || site.banner_text)) throw new ToolError('What should the banner say?', 422)
      return {
        title: input.on ? 'Show this banner?' : 'Turn the banner off?',
        lines: input.on
          ? [SEVERITY[input.severity || site.banner_severity || 'info'] + ': ' + (input.text || site.banner_text),
            ...(input.link_url ? ['Link: ' + (input.link_text || input.link_url) + ' (' + input.link_url + ')'] : [])]
          : ['Now: ' + (site.banner_enabled ? site.banner_text : 'already off')],
        confirmLabel: input.on ? 'Show banner' : 'Turn off',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'website', 'manage')
      return audited(ctx, 'set_website_banner', input, async () => {
        const body = { banner_enabled: input.on }
        if (input.text !== undefined) body.banner_text = input.text
        if (input.severity) body.banner_severity = input.severity
        if (input.link_url !== undefined) body.banner_link_url = input.link_url || null
        if (input.link_text !== undefined) body.banner_link_text = input.link_text || null
        await callApi(ctx, 'PATCH', '/api/website/tenant-site', { body })
        return { banner: input.on ? 'on' : 'off', message: 'Saved.' }
      })
    },
  },

  {
    name: 'list_promotions',
    section: 'website',
    title: 'Promotions',
    description: 'Promotions for online ordering and the till: what each gives, how it applies (automatic, button, code), when, on or off, uses and discount given.',
    input: z.object({ only_running: z.boolean().default(false) }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'promotions', 'view')
      const list = await callApi(ctx, 'GET', '/api/promotions')
      const venues = await tenantVenueList(ctx)
      const today = venues[0] ? venueToday(venues[0]) : new Date().toISOString().slice(0, 10)
      const rows = list.filter(p => !input.only_running || promoRunning(p, today))
      return {
        promotions: rows.map(p => ({
          name: p.name,
          gives: promoSummary(p),
          ...(promoTerms(p) ? { terms: promoTerms(p) } : {}),
          applies: p.apply_mode === 'code' ? 'with the code ' + p.code : p.apply_mode === 'manual' ? 'when the guest taps it' : 'automatically',
          status: !p.is_active ? 'off' : promoRunning(p, today) ? 'running' : 'on, not running now (dates or uses)',
          uses: p.uses + (p.max_uses ? ' of ' + p.max_uses : ''),
          discount_given: '£' + (Number(p.discount_given_pence || 0) / 100).toFixed(2),
        })),
      }
    },
  },

  {
    name: 'switch_promotion',
    section: 'website',
    title: 'Turn a promotion on or off',
    description: 'Turns a promotion on or off (it keeps its settings).',
    input: z.object({ promotion: z.string().trim().min(1).max(200), on: z.boolean() }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'promotions', 'manage')
      const p = await promoPick(ctx, input)
      if (!!p.is_active === input.on) throw new ToolError(p.name + ' is already ' + (input.on ? 'on' : 'off') + '.', 422)
      return { title: (input.on ? 'Turn on ' : 'Turn off ') + p.name + '?', lines: [promoSummary(p)], confirmLabel: input.on ? 'Turn on' : 'Turn off' }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'promotions', 'manage')
      return audited(ctx, 'switch_promotion', input, async () => {
        const p = await promoPick(ctx, input)
        await callApi(ctx, 'PATCH', `/api/promotions/${p.id}/active`, { body: { is_active: input.on } })
        return { promotion: p.name, on: input.on, message: 'Saved.' }
      })
    },
  },

  {
    name: 'list_reviews',
    section: 'website',
    title: 'Reviews',
    description: 'Recent customer reviews (Google and others): rating, who, what they said, approved for the website or not, featured, the reply; plus the average and counts.',
    input: z.object({
      venue: VenueText,
      only: z.enum(['all', 'pending', 'approved', 'featured', 'low']).default('all').describe('low = 3 stars or fewer'),
      limit: z.number().int().min(1).max(50).default(15),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'website', 'view')
      const venue = input.venue ? await venueFor(ctx, input.venue) : null
      const q = ['limit=' + (input.only === 'low' ? 200 : input.limit), 'sort=newest']
      if (venue) q.push('venue_id=' + venue.id)
      if (input.only === 'pending') q.push('is_approved=false')
      if (input.only === 'approved') q.push('is_approved=true')
      if (input.only === 'featured') q.push('is_featured=true')
      const [list, stats] = await Promise.all([
        callApi(ctx, 'GET', '/api/reviews?' + q.join('&')),
        callApi(ctx, 'GET', '/api/reviews/stats' + (venue ? '?venue_id=' + venue.id : '')),
      ])
      const rows = (input.only === 'low' ? list.filter(r => r.rating <= 3) : list).slice(0, input.limit)
      return {
        average: stats.avg_rating ? stats.avg_rating + ' stars from ' + stats.total : 'no reviews yet',
        pending_approval: Number(stats.pending || 0),
        reviews: rows.map(r => ({
          review_id: r.id,
          who: r.reviewer_name || 'Anonymous', rating: r.rating + ' stars', platform: r.platform,
          ...(r.review_date ? { date: String(r.review_date instanceof Date ? r.review_date.toISOString() : r.review_date).slice(0, 10) } : {}),
          ...(r.venue_name ? { venue: r.venue_name } : {}),
          text: r.review_text ? String(r.review_text).slice(0, 600) : null,
          on_website: r.is_approved ? (r.is_featured ? 'featured' : 'approved') : 'not approved',
          ...(r.reply_text ? { reply: r.reply_text } : {}),
        })),
      }
    },
  },

  {
    name: 'moderate_review',
    section: 'website',
    title: 'Approve or feature a review',
    description:
      'Approves a review for the website, hides it, features it (approved and highlighted) or unfeatures it, and/or saves a reply. ' +
      'The review is named by its id or by the reviewer\'s name or words from it.',
    input: z.object({
      review: z.string().trim().min(1).max(200),
      action: z.enum(['approve', 'hide', 'feature', 'unfeature']).optional(),
      reply: z.string().max(4000).optional().describe('Saved with the review (shown on the website with it)'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'website', 'manage')
      if (!input.action && input.reply === undefined) throw new ToolError('Say what to do: approve, hide, feature, unfeature, or a reply.', 422)
      const r = await reviewPick(ctx, input)
      return {
        title: 'Change this review?',
        lines: [(r.reviewer_name || 'Anonymous') + ', ' + r.rating + ' stars: ' + String(r.review_text || '').slice(0, 160),
          ...(input.action ? ['Website: ' + { approve: 'approve', hide: 'hide', feature: 'feature', unfeature: 'stop featuring' }[input.action]] : []),
          ...(input.reply !== undefined ? ['Reply: ' + (input.reply || '(none)')] : [])],
        confirmLabel: 'Save',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'website', 'manage')
      return audited(ctx, 'moderate_review', input, async () => {
        const r = await reviewPick(ctx, input)
        const body = { ...(input.action ? MODERATE[input.action] : {}), ...(input.reply !== undefined ? { reply_text: input.reply || null } : {}) }
        const row = await callApi(ctx, 'PATCH', '/api/reviews/' + r.id, { body })
        return { review_id: row.id, approved: row.is_approved, featured: row.is_featured, message: 'Saved.' }
      })
    },
  },

  {
    name: 'screens_status',
    section: 'website',
    title: 'Menu screens',
    description: 'The menu screens: venue, online or not, what each shows (board or playlist, or its wall), when it was last seen.',
    input: z.object({ venue: VenueText }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'screens', 'view')
      const venue = input.venue ? await venueFor(ctx, input.venue) : null
      const res = await callApi(ctx, 'GET', '/api/screens/screens')
      const tz = await tzOf(ctx)
      const list = res.screens.filter(s => !venue || s.venue_id === venue.id)
      return {
        screens: list.map(s => ({
          screen: s.name + ' (' + s.short_code + ')', venue: s.venue_name,
          status: !s.paired ? 'not paired yet' : s.online ? 'online' : 'offline',
          shows: s.wall ? 'wall ' + s.wall.name + (s.shows ? ': ' + s.shows.kind + ' ' + (s.shows.name || '') : '') : s.shows ? s.shows.kind + ' ' + (s.shows.name || '') : 'nothing picked',
          ...(s.last_seen_at ? { last_seen: when(s.last_seen_at, tz) } : {}),
        })),
        ...(list.some(s => s.paired && !s.online) ? { note: 'An offline screen keeps showing what it had; check its power and Wi-Fi.' } : {}),
      }
    },
  },

  {
    name: 'reload_screen',
    section: 'website',
    title: 'Reload a menu screen',
    description: 'Makes a menu screen load its page again (when it looks stuck). It must be online to hear it.',
    input: z.object({ screen: z.string().trim().min(1).max(100).describe('Screen name or its code (S1)') }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'screens', 'manage')
      const s = await screenPick(ctx, input.screen)
      return {
        title: 'Reload ' + s.name + '?',
        lines: [s.name + ' (' + s.short_code + '), ' + s.venue_name],
        ...(!s.online ? { warningTitle: 'Offline', warnings: ['The screen is offline, so it won\'t hear this until it is back.'] } : {}),
        confirmLabel: 'Reload',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'screens', 'manage')
      return audited(ctx, 'reload_screen', input, async () => {
        const s = await screenPick(ctx, input.screen)
        await callApi(ctx, 'POST', `/api/screens/screens/${s.id}/reload`, { body: {} })
        return { screen: s.name, message: 'Sent.' }
      })
    },
  },

  {
    name: 'email_log',
    section: 'website',
    title: 'Booking emails sent',
    description:
      'Recent booking emails (confirmations, reminders, changes, cancellations; the latest 200): who to, subject, sent, failed (with why) or waiting. ' +
      'search narrows to a guest\'s name or email.',
    input: z.object({
      search: z.string().trim().min(2).max(200).optional().describe('Guest name or email'),
      only_failed: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'email_templates', 'view')
      const rows = await callApi(ctx, 'GET', '/api/email-templates/log?limit=200')
      const tz = await tzOf(ctx)
      const q = input.search?.toLowerCase()
      const list = rows
        .filter(r => !input.only_failed || r.status === 'failed')
        .filter(r => !q || [r.recipient, r.guest_name].some(v => v && String(v).toLowerCase().includes(q)))
        .slice(0, input.limit)
      return {
        emails: list.map(e => ({
          type: e.template_type, to: e.recipient, subject: e.subject, status: e.status,
          ...(e.error ? { error: e.error } : {}),
          when: when(e.sent_at || e.created_at, tz),
          ...(e.guest_name ? { booking: e.guest_name + (e.covers ? ', ' + plural(e.covers, 'guest') : '') } : {}),
        })),
        failed_recently: rows.filter(r => r.status === 'failed').length,
      }
    },
  },

  {
    name: 'report_issue',
    section: 'support',
    title: 'Report an issue',
    description:
      'Logs a problem with the app in the issue log for the platform team: what happened, how many people it affects (impact) ' +
      'and how soon it needs fixing (urgency); its priority (P1-P4) follows from those.',
    input: z.object({
      title: z.string().trim().min(1).max(300),
      description: z.string().max(5000).optional(),
      category: z.enum(['incident', 'problem', 'change_request', 'service_request']).default('incident'),
      impact: z.enum(['critical', 'high', 'medium', 'low']).default('low'),
      urgency: z.enum(['critical', 'high', 'medium', 'low']).default('low'),
    }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'issue_log', 'manage')
      return {
        title: 'Log this issue?',
        lines: [input.title, ...(input.description ? [input.description.slice(0, 300)] : []),
          'Impact ' + input.impact + ', urgency ' + input.urgency + ', ' + input.category.replace('_', ' ')],
        confirmLabel: 'Log issue',
      }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'issue_log', 'manage')
      return audited(ctx, 'report_issue', input, async () => {
        const row = await callApi(ctx, 'POST', '/api/issues', { body: input })
        return { issue_id: row.id, priority: PRIORITY[row.priority] || row.priority, message: 'Logged. The platform team sees it in the issue log.' }
      })
    },
  },

  {
    name: 'list_issues',
    section: 'support',
    title: 'Logged issues',
    description: 'The restaurant\'s logged issues: title, priority, status and the resolution notes.',
    input: z.object({ open_only: z.boolean().default(true) }),
    readOnly: true,
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'issue_log', 'view')
      const rows = await callApi(ctx, 'GET', '/api/issues')
      // A platform admin's list covers every tenant: keep this restaurant's only.
      const list = rows.filter(i => i.tenant_id === ctx.tenantId && (!input.open_only || !['resolved', 'closed'].includes(i.status)))
      return {
        issues: list.slice(0, 50).map(i => ({
          title: i.title, priority: PRIORITY[i.priority] || i.priority, status: i.status,
          logged: new Date(i.created_at).toISOString().slice(0, 10), ...(i.resolution_notes ? { resolution: i.resolution_notes } : {}),
        })),
      }
    },
  },

  {
    name: 'request_feature',
    section: 'support',
    title: 'Request a feature',
    description: 'Adds a feature request to the shared wishlist the platform team works from (other restaurants can vote for it).',
    input: z.object({ title: z.string().trim().min(1).max(300), description: z.string().max(5000).optional() }),
    confirm: true,
    async describe(ctx, input) {
      await requireStaffPermission(ctx, 'feature_requests', 'manage')
      return { title: 'Send this feature request?', lines: [input.title, ...(input.description ? [input.description.slice(0, 300)] : [])], confirmLabel: 'Send' }
    },
    async run(ctx, input) {
      await requireStaffPermission(ctx, 'feature_requests', 'manage')
      return audited(ctx, 'request_feature', input, async () => {
        const row = await callApi(ctx, 'POST', '/api/feature-requests', { body: input })
        return { request_id: row.id, message: 'Sent.' }
      })
    },
  },
]

async function promoPick(ctx, input) {
  const list = await callApi(ctx, 'GET', '/api/promotions')
  return pickByName(list, input.promotion, p => p.name, 'promotion', 'There are no promotions yet.')
}

async function screenPick(ctx, text) {
  const res = await callApi(ctx, 'GET', '/api/screens/screens')
  const raw = String(text).trim()
  const byCode = res.screens.find(s => s.short_code.toLowerCase() === raw.toLowerCase())
  return byCode || pickByName(res.screens, raw, s => s.name, 'screen', 'There are no menu screens yet.')
}
