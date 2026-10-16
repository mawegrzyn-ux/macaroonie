// src/services/platformHost.js
//
// The platform's own hosts on PUBLIC_ROOT_DOMAIN (macaroonie.com):
//   apex  macaroonie.com (and www.)  the public platform page with the
//                                    register-interest form (routes/platformSite.js)
//   office office.macaroonie.com     the admin portal (nginx serves admin/dist)
//   ops    ops.macaroonie.com        the same admin build, opened on /mobile, so the
//                                    phone app installs as its own app on Android
//   pos    pos.macaroonie.com        the till app (pos/ build, served by routes/posSite.js)
//   screens screens.macaroonie.com   the menu screens' player (screen/, served by
//                                    routes/screenSite.js)
// Tenant sites live on every other subdomain (routes/siteRenderer.js), which
// is why office and ops are in RESERVED_SUBDOMAINS.

import { env } from '../config/env.js'

export const OFFICE_SUBDOMAIN = 'office'
export const OPS_SUBDOMAIN = 'ops'
export const POS_SUBDOMAIN = 'pos'
export const SCREENS_SUBDOMAIN = 'screens'

const root = () => env.PUBLIC_ROOT_DOMAIN.toLowerCase()

/** 'apex' | 'office' | 'ops' | 'pos' | 'screens' | null for a Host header. */
export function platformHostKind(host) {
  if (!host) return null
  const h = String(host).split(':')[0].toLowerCase()
  if (h === root() || h === 'www.' + root()) return 'apex'
  if (h === OFFICE_SUBDOMAIN + '.' + root()) return 'office'
  if (h === OPS_SUBDOMAIN + '.' + root()) return 'ops'
  if (h === POS_SUBDOMAIN + '.' + root()) return 'pos'
  if (h === SCREENS_SUBDOMAIN + '.' + root()) return 'screens'
  return null
}

export function officeOrigin() {
  return `${env.PUBLIC_SITE_SCHEME}://${OFFICE_SUBDOMAIN}.${root()}`
}

export function posOrigin() {
  return `${env.PUBLIC_SITE_SCHEME}://${POS_SUBDOMAIN}.${root()}`
}

export function screensOrigin() {
  return `${env.PUBLIC_SITE_SCHEME}://${SCREENS_SUBDOMAIN}.${root()}`
}

export function opsOrigin() {
  return `${env.PUBLIC_SITE_SCHEME}://${OPS_SUBDOMAIN}.${root()}`
}
