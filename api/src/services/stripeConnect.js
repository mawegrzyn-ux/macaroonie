// src/services/stripeConnect.js
//
// The group's own Stripe account, linked to the platform with Stripe
// Connect (migration 215). Standard accounts and direct charges: the group
// is the merchant of record and sees its payments, payouts and disputes in
// its own Stripe dashboard; the platform takes its online ordering fee
// (tenants.ordering_fee_percent) as an application fee. Every call is made
// with the platform's secret key and the group's account in the
// Stripe-Account header.
//
// Used by online ordering (paymentGateways/stripe.js) and by Stripe
// Terminal card machines on tills and kiosks whose card account is in
// connect mode (cardMachines/stripe.js, cardSvc.js machineFor()).
//
// The platform's keys: saved on the Platform page (platform_secrets
// 'stripe_secret_key' / 'stripe_publishable_key' / 'stripe_webhook_secret',
// sealed), else STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY /
// STRIPE_CONNECT_WEBHOOK_SECRET in api/.env. Each API process keeps them
// for KEYS_TTL_MS, like the Anthropic key (ai/apiKey.js).
//
// tenants: stripe_account_id (made by Connect Stripe here, or typed on the
// Platform page) and what Stripe last said about it (charges_enabled,
// details_submitted, account name, checked_at, the site's addresses
// registered for Apple Pay / Google Pay), kept fresh by refreshAccount()
// and the account.updated webhook.

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import { sql, systemSql } from '../config/db.js'
import { env } from '../config/env.js'
import { seal, unseal } from './vault.js'
import { formEncode, providerMessage } from './cardMachines/http.js'
import { httpError } from '../middleware/error.js'
import { officeOrigin } from './platformHost.js'

const VERSION     = '2024-06-20'
const TIMEOUT_MS  = 20_000
const KEYS_TTL_MS = 15_000
const SIGNATURE_TOLERANCE_S = 300

export const STRIPE_KEYS = {
  secret:      { name: 'stripe_secret_key',      env: 'STRIPE_SECRET_KEY',             label: 'Secret key' },
  publishable: { name: 'stripe_publishable_key', env: 'STRIPE_PUBLISHABLE_KEY',        label: 'Publishable key' },
  webhook:     { name: 'stripe_webhook_secret',  env: 'STRIPE_CONNECT_WEBHOOK_SECRET', label: 'Connect webhook signing secret' },
}

// ── The platform's keys ───────────────────────────────────────

let cached = null   // { keys: { secret, publishable, webhook }, source: {...}, at }

/** The platform's Stripe keys now (saved on the Platform page, else .env). */
export async function platformKeys() {
  if (cached && Date.now() - cached.at < KEYS_TTL_MS) return cached
  let rows = []
  try {
    rows = await sql`SELECT name, value FROM platform_secrets WHERE name IN ${sql(Object.values(STRIPE_KEYS).map(k => k.name))}`
  } catch { rows = [] }
  const saved = Object.fromEntries(rows.map(r => [r.name, r.value]))
  const keys = {}
  const source = {}
  for (const [k, def] of Object.entries(STRIPE_KEYS)) {
    const fromDb = saved[def.name] ? unseal(saved[def.name]) : null
    const fromEnv = env[def.env] || null
    keys[k] = fromDb || fromEnv
    source[k] = fromDb ? 'platform' : fromEnv ? 'env' : null
  }
  cached = { keys, source, at: Date.now() }
  return cached
}

export function forgetPlatformKeys() { cached = null }

const modeOf = key => /_test_/.test(key || '') ? 'test' : /_live_/.test(key || '') ? 'live' : null

/** Whether Connect can be used: a real-looking secret key and a publishable key of the same mode. */
export async function platformReady() {
  const { keys } = await platformKeys()
  return !!(keys.secret && keys.publishable && /^(sk|rk)_(test|live)_/.test(keys.secret) &&
    /^pk_(test|live)_/.test(keys.publishable) && modeOf(keys.secret) === modeOf(keys.publishable))
}

/** What the Platform page shows: where each key comes from and its last four, never a key. */
export async function platformKeysInfo() {
  const { keys, source } = await platformKeys()
  const [{ n } = { n: 0 }] = await sql`SELECT count(*)::int AS n FROM tenants WHERE stripe_account_id IS NOT NULL`
  const out = {}
  for (const [k, def] of Object.entries(STRIPE_KEYS)) {
    out[k] = { label: def.label, source: source[k], hint: keys[k] ? keys[k].slice(-4) : null, env_var: def.env }
  }
  return { keys: out, mode: modeOf(keys.secret), ready: await platformReady(), connected_groups: n, webhook_url: officeOrigin() + '/webhooks/payments/stripe' }
}

/** Saves or removes the platform's keys. `values` { secret?, publishable?, webhook? }: a string saves, null removes, missing leaves. */
export async function savePlatformKeys(values, by) {
  if (values.secret) {
    if (!/^(sk|rk)_(test|live)_/.test(values.secret)) throw httpError(400, 'A Stripe secret key starts with sk_test_ or sk_live_ (Developers, API keys)')
    // Ask Stripe whether it works before saving it.
    const r = await stripeCall('/v1/account', { key: values.secret })
    if (!r.ok) throw httpError(422, 'Stripe refused that key: ' + providerMessage(r.json, 'check it in Developers, API keys'))
  }
  if (values.publishable && !/^pk_(test|live)_/.test(values.publishable)) throw httpError(400, 'A Stripe publishable key starts with pk_test_ or pk_live_')
  if (values.webhook && !/^whsec_/.test(values.webhook)) throw httpError(400, 'A webhook signing secret starts with whsec_ (Developers, Webhooks, the endpoint, Signing secret)')
  const now = (await platformKeys()).keys
  const secret = values.secret === undefined ? now.secret : values.secret
  const publishable = values.publishable === undefined ? now.publishable : values.publishable
  if (secret && publishable && modeOf(secret) !== modeOf(publishable)) {
    throw httpError(422, 'The secret key and the publishable key must both be test keys or both live keys')
  }
  for (const [k, def] of Object.entries(STRIPE_KEYS)) {
    const v = values[k]
    if (v === undefined) continue
    if (v === null) await sql`DELETE FROM platform_secrets WHERE name = ${def.name}`
    else {
      await sql`
        INSERT INTO platform_secrets (name, value, hint, updated_by, updated_at)
        VALUES (${def.name}, ${seal(v)}, ${v.slice(-4)}, ${by || null}, now())
        ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, hint = EXCLUDED.hint,
               updated_by = EXCLUDED.updated_by, updated_at = now()
      `
    }
  }
  forgetPlatformKeys()
  return platformKeysInfo()
}

// ── Calls to Stripe ───────────────────────────────────────────

/**
 * One call to Stripe's API with the platform's key (or `key`), on the
 * group's account when `account` is given. Returns { status, ok, json }.
 * Network trouble and Stripe's 5xx throw a 502 the caller may retry.
 */
export async function stripeCall(path, { method = 'GET', form, query, account, idempotency, key } = {}) {
  const k = key || (await platformKeys()).keys.secret
  if (!k) throw httpError(503, 'Stripe isn\'t set up on this platform yet (Platform page, Payments)')
  const url = new URL(env.STRIPE_API_URL.replace(/\/+$/, '') + path)
  for (const [q, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(q, v)
  const headers = { Accept: 'application/json', Authorization: 'Bearer ' + k, 'Stripe-Version': VERSION }
  if (account) headers['Stripe-Account'] = account
  if (idempotency) headers['Idempotency-Key'] = idempotency
  let body
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = formEncode(form) }
  let res
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw httpError(502, 'Stripe can\'t be reached just now: try again')
  }
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (res.status >= 500) throw httpError(502, 'Stripe had a problem (' + res.status + '): try again')
  return { status: res.status, ok: res.ok, json }
}

/** A Stripe reply that must be good, else a 422 with Stripe's words. */
export function stripeMust(r, what) {
  if (r.ok) return r.json
  if (r.status === 401) throw httpError(422, 'Stripe refused the platform\'s key (Platform page, Payments)')
  throw httpError(422, providerMessage(r.json, 'Stripe refused ' + what + ' (' + r.status + ')'))
}

/**
 * Checks a webhook's Stripe-Signature header ("t=...,v1=...,v1=...") over
 * the exact bytes Stripe sent: HMAC-SHA256 of "t.body" with the endpoint's
 * signing secret, within five minutes. Returns the parsed event or throws.
 */
export function verifySignature(rawBody, header, secret, nowS = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('No webhook signing secret is set')
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''))
  const parts = String(header || '').split(',').map(p => p.trim().split('='))
  const t = Number(parts.find(([k]) => k === 't')?.[1])
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v || '')
  if (!Number.isFinite(t) || !sigs.length) throw new Error('No signature')
  if (Math.abs(nowS - t) > SIGNATURE_TOLERANCE_S) throw new Error('Signature too old')
  const want = createHmac('sha256', secret).update(t + '.').update(body).digest()
  const ok = sigs.some(s => {
    const got = Buffer.from(s, 'hex')
    return got.length === want.length && timingSafeEqual(got, want)
  })
  if (!ok) throw new Error('Bad signature')
  return JSON.parse(body.toString('utf8'))
}

/** A Stripe-Signature header for `body` (tests and stand-in servers). */
export function signPayload(body, secret, t = Math.floor(Date.now() / 1000)) {
  return 't=' + t + ',v1=' + createHmac('sha256', secret).update(t + '.' + body).digest('hex')
}

// ── The group's account ───────────────────────────────────────

const ACCOUNT_COLS = sql`id, name, stripe_account_id, stripe_charges_enabled, stripe_details_submitted,
  stripe_account_name, stripe_checked_at, stripe_domains, ordering_fee_percent`

export async function tenantStripe(tenantId) {
  const [t] = await systemSql`SELECT ${ACCOUNT_COLS} FROM tenants WHERE id = ${tenantId}`
  return t || null
}

/**
 * What the payment gateways and card machines need to know about the group
 * (paymentGateways/index.js checkoutGateways()): { tenant: { id,
 * stripe_account_id, stripe_ready } }. stripe_ready = connected, Stripe
 * says it can take payments, and the platform's keys are set.
 */
export async function paymentContext(tenantId) {
  const t = await tenantStripe(tenantId)
  const ready = !!(t?.stripe_account_id && t.stripe_charges_enabled && await platformReady())
  return { tenant: { id: tenantId, stripe_account_id: t?.stripe_account_id || null, stripe_ready: ready } }
}

/** What Ordering setup and Store tech show. */
export async function stripeView(t) {
  const keys = (await platformKeys()).keys
  const mode = modeOf(keys.secret)
  return {
    platform_ready: await platformReady(),
    mode,
    connected:         !!t?.stripe_account_id,
    account_id:        t?.stripe_account_id || null,
    account_name:      t?.stripe_account_name || null,
    charges_enabled:   !!t?.stripe_charges_enabled,
    details_submitted: !!t?.stripe_details_submitted,
    checked_at:        t?.stripe_checked_at || null,
    domains:           t?.stripe_domains || [],
    fee_percent:       t?.ordering_fee_percent != null ? Number(t.ordering_fee_percent) : 0,
    ready:             !!(t?.stripe_account_id && t.stripe_charges_enabled && await platformReady()),
    dashboard_url:     'https://dashboard.stripe.com/' + (mode === 'test' ? 'test/' : '') + 'payments',
  }
}

function nameOf(a) {
  return a?.business_profile?.name || a?.settings?.dashboard?.display_name || a?.email || null
}

/** Write what Stripe says about an account onto the group(s) using it. */
async function saveAccount(accountId, a) {
  await systemSql`
    UPDATE tenants
       SET stripe_charges_enabled = ${!!a.charges_enabled},
           stripe_details_submitted = ${!!a.details_submitted},
           stripe_account_name = ${nameOf(a)},
           stripe_checked_at = now()
     WHERE stripe_account_id = ${accountId}
  `
}

/** The account.updated webhook (and account.application.deauthorized: the group cut us off). */
export async function applyAccountEvent(type, account) {
  if (!account?.id) return
  if (type === 'account.application.deauthorized') {
    await systemSql`UPDATE tenants SET stripe_charges_enabled = false, stripe_checked_at = now() WHERE stripe_account_id = ${account.id}`
    return
  }
  await saveAccount(account.id, account)
}

/** The site's addresses, for Apple Pay / Google Pay on the Payment Element. */
async function siteDomains(tenantId) {
  const [s] = await systemSql`
    SELECT subdomain_slug, custom_domain, custom_domain_verified FROM tenant_site WHERE tenant_id = ${tenantId}
  `
  const out = []
  if (s?.subdomain_slug) out.push(s.subdomain_slug + '.' + env.PUBLIC_ROOT_DOMAIN)
  if (s?.custom_domain && s.custom_domain_verified) out.push(s.custom_domain)
  return out
}

/** Ask Stripe about the group's account again, and register the site's addresses once it can take payments. */
export async function refreshAccount(tenantId) {
  const t = await tenantStripe(tenantId)
  if (!t?.stripe_account_id) return stripeView(t)
  const r = await stripeCall('/v1/accounts/' + encodeURIComponent(t.stripe_account_id))
  if (r.status === 404 || r.status === 403) {
    await systemSql`UPDATE tenants SET stripe_charges_enabled = false, stripe_checked_at = now() WHERE id = ${tenantId}`
    throw httpError(422, 'Stripe doesn\'t know that account any more, or it has stopped the link to this platform. Connect Stripe again.')
  }
  const a = stripeMust(r, 'the account')
  await saveAccount(t.stripe_account_id, a)
  if (a.charges_enabled) {
    const have = new Set((t.stripe_domains || []).filter(d => d.ok).map(d => d.domain))
    const list = [...(t.stripe_domains || []).filter(d => d.ok)]
    for (const domain of await siteDomains(tenantId)) {
      if (have.has(domain)) continue
      try {
        const d = await stripeCall('/v1/payment_method_domains', { method: 'POST', account: t.stripe_account_id, form: { domain_name: domain } })
        list.push(d.ok ? { domain, id: d.json?.id || null, ok: true } : { domain, ok: false, error: providerMessage(d.json, 'Refused') })
      } catch (err) {
        list.push({ domain, ok: false, error: err.message })
      }
    }
    await systemSql`UPDATE tenants SET stripe_domains = ${systemSql.json(list)} WHERE id = ${tenantId}`
  }
  return stripeView(await tenantStripe(tenantId))
}

/**
 * Connect Stripe: makes the group a Standard account the first time, then a
 * one-use Stripe sign-up link (Stripe hosts the sign-up; the person comes
 * back to `returnUrl`, an expired link to `refreshUrl`).
 */
export async function onboardingLink(tenantId, { email, returnUrl, refreshUrl }) {
  if (!await platformReady()) throw httpError(503, 'Stripe isn\'t set up on this platform yet: a platform admin adds the keys on the Platform page, Payments')
  let t = await tenantStripe(tenantId)
  if (!t) throw httpError(404, 'Group not found')
  if (!t.stripe_account_id) {
    const a = stripeMust(await stripeCall('/v1/accounts', {
      method: 'POST',
      // A double click makes one account; connecting again later (after
      // Unlink) makes a new one (Stripe keeps a key's answer for 24 hours).
      idempotency: 'mcrn-account-' + tenantId + '-' + Math.floor(Date.now() / 60_000),
      form: {
        type: 'standard', country: 'GB', email: email || undefined,
        business_profile: { name: t.name },
        metadata: { tenant_id: tenantId },
      },
    }), 'a new account')
    await systemSql`
      UPDATE tenants SET stripe_account_id = ${a.id}, stripe_charges_enabled = ${!!a.charges_enabled},
             stripe_details_submitted = ${!!a.details_submitted}, stripe_account_name = ${nameOf(a) || t.name},
             stripe_checked_at = now(), stripe_domains = '[]'::jsonb
       WHERE id = ${tenantId} AND stripe_account_id IS NULL
    `
    t = await tenantStripe(tenantId)
  }
  const link = stripeMust(await stripeCall('/v1/account_links', {
    method: 'POST',
    idempotency: 'mcrn-link-' + randomUUID(),
    form: { account: t.stripe_account_id, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' },
  }), 'the sign-up link')
  return { url: link.url, expires_at: link.expires_at ? new Date(link.expires_at * 1000).toISOString() : null }
}

/** Unlink the group's account here (the account itself stays at Stripe). */
export async function forgetAccount(tenantId) {
  await systemSql`
    UPDATE tenants SET stripe_account_id = NULL, stripe_charges_enabled = false, stripe_details_submitted = false,
           stripe_account_name = NULL, stripe_checked_at = NULL, stripe_domains = '[]'::jsonb
     WHERE id = ${tenantId}
  `
  return stripeView(await tenantStripe(tenantId))
}

/**
 * The address Stripe sends the person back to after sign-up: it must be one
 * of ours (the office or ops site on the root domain), or a local admin
 * when not in production.
 */
export function safeReturnUrl(url) {
  let u
  try { u = new URL(url) } catch { return null }
  const root = env.PUBLIC_ROOT_DOMAIN
  const ours = u.protocol === 'https:' && (u.hostname === root || u.hostname.endsWith('.' + root))
  const local = env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)
  return ours || local ? u.toString() : null
}
