// src/lib/hosts.js
//
// The admin build is served on two hosts (api/src/services/platformHost.js):
//   office.<domain>  the admin portal
//   ops.<domain>     the same build, opened on /mobile, so the phone app
//                    installs as its own app on Android (install identity is
//                    per origin)
//   installer.<domain>  the same build, opened on /install: the phone app for
//                    linking tills, kitchen screens, kiosks and menu screens
//                    (pages/installer, migration 184); served by the API
// Anywhere else (localhost, a preview host) both work in one origin, as before.

const hostname = typeof window !== 'undefined' ? window.location.hostname : ''

export const IS_OPS_HOST = hostname.startsWith('ops.')
export const IS_OFFICE_HOST = hostname.startsWith('office.')
export const IS_INSTALLER_HOST = hostname.startsWith('installer.')

function onSibling(sub, path) {
  const { protocol, port } = window.location
  return `${protocol}//${sub}${hostname.slice(hostname.indexOf('.'))}${port ? ':' + port : ''}${path}`
}

/** Full URL of the phone app when it lives on another host, else null (use the router). */
export function mobileHref(path = '/mobile') {
  return IS_OFFICE_HOST ? onSibling('ops', path) : null
}

/** Full URL of the admin portal when it lives on another host, else null (use the router). */
export function standardHref(path = '/') {
  return IS_OPS_HOST ? onSibling('office', path) : null
}

/** Full URL of the installer app when it lives on another host, else null (use the router: /install). */
export function installerHref(path = '/install') {
  return IS_OFFICE_HOST || IS_OPS_HOST ? onSibling('installer', path) : null
}
