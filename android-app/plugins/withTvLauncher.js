// Lists the app on an Android TV's home screen as well as a tablet's, so a TV
// box or a smart TV can run a menu screen (or a kitchen screen) from it:
// the main activity also answers LEANBACK_LAUNCHER, the TV home screen shows
// assets/tv-banner.png, and a touchscreen, a camera and the TV feature itself
// aren't required (so the same APK installs on tablets and TV boxes alike).
// Applied by app.json's plugins when the app is built (expo prebuild / EAS).
const fs = require('fs')
const path = require('path')
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')

const BANNER = 'tv_banner'
const NOT_REQUIRED = ['android.software.leanback', 'android.hardware.touchscreen', 'android.hardware.camera', 'android.hardware.camera.autofocus']

function withTvManifest(config) {
  return withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest
    manifest['uses-feature'] = manifest['uses-feature'] || []
    for (const name of NOT_REQUIRED) {
      const has = manifest['uses-feature'].find(f => f.$['android:name'] === name)
      if (has) has.$['android:required'] = 'false'
      else manifest['uses-feature'].push({ $: { 'android:name': name, 'android:required': 'false' } })
    }
    const app = manifest.application[0]
    app.$['android:banner'] = '@drawable/' + BANNER
    const main = (app.activity || []).find(a => a.$['android:name'] === '.MainActivity') || app.activity?.[0]
    if (main) {
      const launcher = (main['intent-filter'] || []).find(f =>
        (f.category || []).some(c => c.$['android:name'] === 'android.intent.category.LAUNCHER'))
      if (launcher && !launcher.category.some(c => c.$['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER')) {
        launcher.category.push({ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } })
      }
    }
    return cfg
  })
}

function withTvBanner(config) {
  return withDangerousMod(config, ['android', async cfg => {
    const src = path.join(cfg.modRequest.projectRoot, 'assets', 'tv-banner.png')
    const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable-xhdpi')
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(src, path.join(dir, BANNER + '.png'))
    return cfg
  }])
}

module.exports = config => withTvBanner(withTvManifest(config))
