// What a build of Macaroonie Office points at, read when the app is built
// (EAS build profiles in eas.json, or the shell's environment):
//   MACAROONIE_ROOT_DOMAIN   the domain whose ops. host has the phone pages
//                            (default macaroonie.com; a test server's for a test build)
//   MACAROONIE_AUTH0_DOMAIN, MACAROONIE_AUTH0_CLIENT_ID, MACAROONIE_AUTH0_AUDIENCE
//                            the Auth0 tenant, the Native application made for
//                            this app (README.md), and the API's audience
//   MACAROONIE_EAS_PROJECT_ID  the EAS project (push tokens need it)
//   MACAROONIE_WEB_DEBUG=1   lets Chrome's remote inspector see the web view
// None of these is a secret: a client id and an audience are public by design.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    rootDomain: process.env.MACAROONIE_ROOT_DOMAIN || 'macaroonie.com',
    auth0Domain: process.env.MACAROONIE_AUTH0_DOMAIN || 'macaroonie.eu.auth0.com',
    auth0ClientId: process.env.MACAROONIE_AUTH0_CLIENT_ID || '',
    auth0Audience: process.env.MACAROONIE_AUTH0_AUDIENCE || 'https://api.macaroonie.com',
    scheme: config.scheme || 'macaroonie-office',
    webDebug: process.env.MACAROONIE_WEB_DEBUG === '1',
    eas: { ...(config.extra?.eas || {}), projectId: process.env.MACAROONIE_EAS_PROJECT_ID || config.extra?.eas?.projectId || '' },
  },
})
