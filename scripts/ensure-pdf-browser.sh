#!/usr/bin/env bash
# Makes sure the server has a browser to make report PDFs with
# (api/src/services/pdfBrowser.js, docs/REPORTS.md decision 3).
#
# Run by every deploy, as root. Does nothing when a browser is already where
# pdfBrowser.js looks. Otherwise installs Google Chrome's own package (amd64
# only): Ubuntu's chromium-browser is a snap, which can't write a PDF where it
# is told. Never fails the deploy: without a browser the app says PDFs can't
# be made yet, and every other format still works.
#
# Env for tests: PDF_BROWSER_CANDIDATES (space-separated paths to look for),
# NO_INSTALL=1 (say what would happen, change nothing).

set -u

CANDIDATES=${PDF_BROWSER_CANDIDATES:-"/usr/bin/google-chrome-stable /usr/bin/google-chrome /opt/google/chrome/chrome /usr/bin/chromium"}
for c in $CANDIDATES; do
  if [ -x "$c" ] && [ -f "$c" ]; then
    echo "PDF browser: $c"
    exit 0
  fi
done

ARCH=$(dpkg --print-architecture 2>/dev/null || echo unknown)
if [ "$ARCH" != "amd64" ]; then
  echo "WARN: no PDF browser, and Google Chrome's package is amd64 only (this machine: $ARCH). Set PDF_BROWSER_PATH in api/.env to a Chrome or Chromium that isn't a snap."
  exit 0
fi

if [ "${NO_INSTALL:-}" = "1" ]; then
  echo "Would install Google Chrome for report PDFs"
  exit 0
fi

echo "Installing Google Chrome for report PDFs..."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
DEB="$TMP/google-chrome-stable_current_amd64.deb"
if ! timeout 180 curl -fsSL --retry 2 -o "$DEB" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb; then
  echo "WARN: couldn't download Google Chrome; report PDFs stay off until the next deploy"
  exit 0
fi
if ! DEBIAN_FRONTEND=noninteractive timeout 600 apt-get install -y -q "$DEB" >"$TMP/apt.log" 2>&1; then
  echo "WARN: Google Chrome didn't install; report PDFs stay off until the next deploy"
  tail -15 "$TMP/apt.log" || true
  exit 0
fi
for c in $CANDIDATES; do
  if [ -x "$c" ] && [ -f "$c" ]; then
    echo "PDF browser installed: $c ($("$c" --version 2>/dev/null || echo 'version unknown'))"
    exit 0
  fi
done
echo "WARN: Google Chrome installed but not found where the app looks; set PDF_BROWSER_PATH in api/.env"
exit 0
