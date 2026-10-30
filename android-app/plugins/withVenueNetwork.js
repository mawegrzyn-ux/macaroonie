// Hub first (docs/POS.md section 11): at a location with a venue hub the
// till, kiosk, kitchen screen and order ready board call the hub on the venue
// network, http://<hub>:9181, so the venue keeps trading with the internet
// down. Android blocks plain http by default (and the WebView with it), so
// the app allows it. The pages themselves stay https; only their calls to the
// hub are plain http, which the WebView's mixedContentMode="always" lets
// through (App.js). Applied by app.json's plugins when the app is built.
const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withVenueNetwork(config) {
  return withAndroidManifest(config, cfg => {
    const app = cfg.modResults.manifest.application[0]
    app.$['android:usesCleartextTraffic'] = 'true'
    return cfg
  })
}
