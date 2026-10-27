// The app opens the device apps on {pos|kitchen|kiosk}.<root domain>.
// MACAROONIE_ROOT_DOMAIN builds a copy pointed at another address (a test
// server); MACAROONIE_WEB_DEBUG=1 lets Chrome's remote inspector see the
// WebView (chrome://inspect). Both are read when the app is built.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    rootDomain: process.env.MACAROONIE_ROOT_DOMAIN || 'macaroonie.com',
    webDebug: process.env.MACAROONIE_WEB_DEBUG === '1',
  },
})
