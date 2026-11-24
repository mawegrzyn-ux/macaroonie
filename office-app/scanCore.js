// What a scan gives the page, the same on both phones. Kept apart from
// Scanner.js (no React Native here) so the tests can check it in Node.
//
// An iPhone has no UPC-A of its own: it reads one as an EAN-13 with a leading
// 0 (expo-camera maps upc_a to AVFoundation's ean13). Android reads it as the
// 12-digit UPC-A. A 13-digit EAN beginning with 0 is a UPC-A by definition,
// so on an iPhone it is given back as the 12 digits, as Android does.

/** The code to hand the page for a scan result ({ type, data }) on `os`. */
export function scannedCode({ type, data } = {}, os = 'android') {
  const code = String(data ?? '').trim()
  if (!code) return null
  if (os === 'ios' && /ean13|ean-13|org\.gs1\.ean-13/i.test(String(type || '')) && /^0\d{12}$/.test(code)) return code.slice(1)
  return code
}
