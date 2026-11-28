# The Macaroonie Office app builds for Google Play

- A production build of the Office app (what expo.dev's Build from GitHub makes) is now an Android app bundle (.aab) for Google Play, with its version number counted up on every build. On an iPhone the same profile is for TestFlight and the App Store once the Apple account is set up.
- A preview build is still an APK to install on a phone by hand, for trying a build before it goes to Play.
- Sending a build to Play (`eas submit`) puts it on the internal testing track as a draft. The one-off Play steps, the first upload by hand, app signing and the service account key, are in `office-app/README.md` under Google Play.
