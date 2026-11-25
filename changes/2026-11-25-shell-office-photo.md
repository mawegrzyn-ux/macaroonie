# The Photo buttons work in the Office app

25 Nov 2026, shell (with one-line changes in the Pepper, cash, menus, reports, purchasing and forms pages that take photos).

- Capture's Photo button, and every other "take a photo" button (Pepper's chat, receipts, expenses, invoices, menu import, report photos, plain forms, Cash Recon), did nothing inside the Macaroonie Office app on Android unless the barcode scanner had been opened once: Android refuses the camera to an app until it is granted.
- The app now asks for the camera when the phone pages load (once; Android remembers the answer), and the pages open the camera directly only once it is allowed. Until then, and in app builds made before this, a Photo button opens the phone's own picker (camera or gallery).
- Needs a new build of Macaroonie Office for the camera to open straight away; the picker works after the web deploy.
