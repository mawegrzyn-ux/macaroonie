// The iPhone build (Pepper-first step 6d): what differs from Android, kept in
// files Node can run (layout.js, scanCore.js, the bridge's platform), and the
// app's iOS settings (app.json, app.config.js, eas.json).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { pagePadding, keyboardEvents } from '../layout.js'
import { scannedCode } from '../scanCore.js'
import { bridgeScript } from '../bridge.js'

const require = createRequire(import.meta.url)
const appJson = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url)))
const eas = JSON.parse(fs.readFileSync(new URL('../eas.json', import.meta.url)))

test('the page sits clear of the bars and the keyboard on both phones', () => {
  const insets = { top: 47, bottom: 34 }
  assert.deepEqual(pagePadding({ os: 'ios', insets, keyboard: 0 }), { paddingTop: 47, paddingBottom: 34 })
  assert.deepEqual(pagePadding({ os: 'ios', insets, keyboard: 336 }), { paddingTop: 47, paddingBottom: 336 }, 'an iPhone\'s keyboard covers the home indicator already')
  assert.deepEqual(pagePadding({ os: 'android', insets: { top: 24, bottom: 48 }, keyboard: 280 }), { paddingTop: 24, paddingBottom: 328 }, 'Android\'s height is less the buttons')
  assert.deepEqual(keyboardEvents('ios'), { show: 'keyboardWillShow', hide: 'keyboardWillHide' })
  assert.deepEqual(keyboardEvents('android'), { show: 'keyboardDidShow', hide: 'keyboardDidHide' })
})

test('a UPC-A scans the same on an iPhone as on Android; other codes as read', () => {
  assert.equal(scannedCode({ type: 'ean13', data: '0012345678905' }, 'ios'), '012345678905')
  assert.equal(scannedCode({ type: 'upc_a', data: '012345678905' }, 'android'), '012345678905')
  assert.equal(scannedCode({ type: 'ean13', data: '5012345678900' }, 'ios'), '5012345678900')
  assert.equal(scannedCode({ type: 'ean13', data: '0012345678905' }, 'android'), '0012345678905', 'Android\'s EAN-13 is left as read')
  assert.equal(scannedCode({ type: 'qr', data: ' https://x.test ' }, 'ios'), 'https://x.test')
  assert.equal(scannedCode({ type: 'qr', data: '' }, 'ios'), null)
})

test('the page is told which phone it is on', () => {
  for (const [os, want] of [['ios', 'ios'], ['android', 'android'], ['web', 'android']]) {
    const window = { ReactNativeWebView: { postMessage() {} } }
    vm.runInContext(bridgeScript('3', os), vm.createContext({ window, Promise, setTimeout, JSON, Error }))
    assert.equal(window.MacaroonieOffice.platform, want)
  }
})

test('the iPhone settings: Android only until the Apple account is set up, a bundle id, a reason for every permission asked', () => {
  const e = appJson.expo
  assert.deepEqual(e.platforms, ['android'], 'ios is added by OFFICE_IOS=1 (app.config.js) until the Apple account is ready')
  assert.equal(e.ios.bundleIdentifier, 'com.macaroonie.office')
  for (const k of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription', 'NSPhotoLibraryUsageDescription']) {
    assert.ok(e.ios.infoPlist[k]?.length > 20, k)
  }
  assert.equal(e.ios.infoPlist.ITSAppUsesNonExemptEncryption, false)
  const camera = e.plugins.find(p => Array.isArray(p) && p[0] === 'expo-camera')[1]
  assert.equal(camera.microphonePermission, e.ios.infoPlist.NSMicrophoneUsageDescription, 'one microphone reason, whichever plugin writes it')
  for (const profile of ['development', 'preview', 'production']) assert.ok(eas.build[profile].ios, profile + ' builds for an iPhone')
  assert.equal(eas.build.production.distribution, 'store')
})

test('Android: production is the Google Play bundle, preview and development an APK to install by hand', () => {
  // expo.dev's Build from GitHub uses production, so it makes what Play takes: an app bundle (.aab),
  // its version code counted up by EAS (appVersionSource remote, autoIncrement).
  assert.equal(eas.build.production.android.buildType, 'app-bundle')
  assert.equal(eas.build.production.autoIncrement, true)
  assert.equal(eas.cli.appVersionSource, 'remote')
  for (const profile of ['development', 'preview']) {
    assert.equal(eas.build[profile].android.buildType, 'apk', profile + ' installs by hand')
    assert.equal(eas.build[profile].distribution, 'internal')
  }
  assert.deepEqual(Object.keys(eas.build).sort(), ['development', 'preview', 'production'], 'one store profile')
  // eas submit sends it to the internal testing track as a draft (a Play app never published takes
  // only drafts); the service account key is kept on expo.dev, never in the repository.
  assert.deepEqual(eas.submit.production.android, { track: 'internal', releaseStatus: 'draft' })
  assert.ok(!('serviceAccountKeyPath' in eas.submit.production.android))
})

test('push: the production environment except for development builds', () => {
  const make = require('../app.config.js')
  const mode = profile => {
    const before = process.env.EAS_BUILD_PROFILE
    if (profile) process.env.EAS_BUILD_PROFILE = profile
    else delete process.env.EAS_BUILD_PROFILE
    try {
      // app.config.js reads the profile when it is loaded: a fresh copy each time.
      delete require.cache[require.resolve('../app.config.js')]
      const out = require('../app.config.js')({ config: appJson.expo })
      return out.plugins.find(p => Array.isArray(p) && p[0] === 'expo-notifications')[1].mode
    } finally {
      if (before === undefined) delete process.env.EAS_BUILD_PROFILE
      else process.env.EAS_BUILD_PROFILE = before
    }
  }
  assert.equal(typeof make, 'function')
  assert.equal(mode('development'), 'development')
  assert.equal(mode('preview'), 'production')
  assert.equal(mode('app-store'), 'production')
  assert.equal(mode(null), 'production')
})
