// What a build of Macaroonie Office points at, read when the app is built
// (EAS build profiles in eas.json, or the shell's environment):
//   MACAROONIE_ROOT_DOMAIN   the domain whose ops. host has the phone pages
//                            (default macaroonie.com; a test server's for a test build)
//   MACAROONIE_AUTH0_DOMAIN, MACAROONIE_AUTH0_CLIENT_ID, MACAROONIE_AUTH0_AUDIENCE
//                            the Auth0 tenant, the Native application made for
//                            this app (README.md), and the API's audience
//   MACAROONIE_EAS_PROJECT_ID  the EAS project (push tokens need it)
//   MACAROONIE_WEB_DEBUG=1   lets Chrome's remote inspector see the web view
//   GOOGLE_SERVICES_JSON     Firebase's google-services.json, which push
//                            (expo-notifications, FCM) needs at build time: an
//                            EAS environment variable of type File, whose value
//                            on the build machine is the file's path. A local
//                            build uses office-app/google-services.json instead
//                            (git-ignored). Without either the app builds, but
//                            can't get a push token.
// None of these is a secret: a client id and an audience are public by design.
const fs = require('fs')
const path = require('path')

const LOCAL_GOOGLE_SERVICES = './google-services.json'
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
  || (fs.existsSync(path.join(__dirname, LOCAL_GOOGLE_SERVICES)) ? LOCAL_GOOGLE_SERVICES : undefined)

// iPhone push (APNs): a build for people to use (every profile but
// development) asks Apple for the production push environment; the
// development profile for the sandbox. EAS sets EAS_BUILD_PROFILE.
const pushMode = process.env.EAS_BUILD_PROFILE === 'development' ? 'development' : 'production'
const withPushMode = plugins => (plugins || []).map(p => (
  Array.isArray(p) && p[0] === 'expo-notifications' ? [p[0], { ...p[1], mode: pushMode }] : p
))

// The iPhone is left out of `platforms` until the owner's Apple developer
// account is set up: Build from GitHub on expo.dev builds every platform
// listed, and an iPhone build fails without the account. OFFICE_IOS=1 adds it
// (CI's iPhone bundle check; set it on the EAS iOS builds, or add "ios" to
// app.json's platforms once the account is ready).
const withIos = platforms => (process.env.OFFICE_IOS === '1' && !platforms.includes('ios') ? [...platforms, 'ios'] : platforms)

module.exports = ({ config }) => ({
  ...config,
  platforms: withIos(config.platforms || ['android']),
  plugins: withPushMode(config.plugins),
  android: {
    ...config.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  extra: {
    ...config.extra,
    rootDomain: process.env.MACAROONIE_ROOT_DOMAIN || 'macaroonie.com',
    // The live Auth0 tenant (the API's AUTH0_DOMAIN, setup.sh).
    auth0Domain: process.env.MACAROONIE_AUTH0_DOMAIN || 'obscurekitty.uk.auth0.com',
    auth0ClientId: process.env.MACAROONIE_AUTH0_CLIENT_ID || '',
    auth0Audience: process.env.MACAROONIE_AUTH0_AUDIENCE || 'https://api.macaroonie.com',
    scheme: config.scheme || 'macaroonie-office',
    webDebug: process.env.MACAROONIE_WEB_DEBUG === '1',
    eas: { ...(config.extra?.eas || {}), projectId: process.env.MACAROONIE_EAS_PROJECT_ID || config.extra?.eas?.projectId || '' },
  },
})
