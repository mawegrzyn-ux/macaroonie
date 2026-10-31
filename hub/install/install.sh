#!/bin/sh
# Macaroonie venue hub: installer for a Linux mini PC (Ubuntu or Debian,
# x86-64 or ARM64). On the mini PC, with the internet on:
#
#   curl -fsSL __MACAROONIE_API__/pos-api/hub/install.sh | sudo sh
#
# It installs its own Node.js (in /opt/macaroonie-hub/node, the system's is
# left alone), downloads the hub from the cloud (checked against its sha256),
# makes a user for it (in the lp group, for USB printers), and runs it as a
# systemd service that starts with the computer and starts again if it
# stops. Then it shows the six-letter code: link it in Store tech ->
# Venue hub -> Link a hub, or scan the QR code on the hub's page
# (http://<this computer>:9180) with the installer app. The hub updates
# itself afterwards.
#
# Run again on a computer that is already a hub, it says which restaurant and
# venue the hub is linked to and asks: keep it (and update it), link it to
# another restaurant or venue (it sends what the old one hasn't had yet, leaves
# it and forgets its files, then shows a new code), or remove the hub.
#
#   ... | sudo sh -s -- --keep           keep the hub's link without asking
#   ... | sudo sh -s -- --switch         link it to another restaurant or venue
#   ... | sudo sh -s -- --uninstall      remove the hub (it leaves its venue first)
#   add --force to go ahead even with sales the cloud hasn't had yet (lost)
#
# Or download it as a file (pos.<domain>/hub, macaroonie-hub-setup.sh) and
# run `sh macaroonie-hub-setup.sh`: run from a file, it asks for sudo itself.
#
# Settings for testing (environment): MACAROONIE_API, MACAROONIE_HUB_HOME,
# MACAROONIE_HUB_USER, MACAROONIE_NODE_DIST, MACAROONIE_SYSTEMD_DIR,
# MACAROONIE_SYSTEMCTL, MACAROONIE_HUB_HTTP_PORT, MACAROONIE_WAIT_SECONDS.

set -eu

API="${MACAROONIE_API:-__MACAROONIE_API__}"
HUB_HOME="${MACAROONIE_HUB_HOME:-/opt/macaroonie-hub}"
HUB_USER="${MACAROONIE_HUB_USER:-macaroonie-hub}"
NODE_MAJOR=22
NODE_DIST="${MACAROONIE_NODE_DIST:-https://nodejs.org/dist/latest-v22.x}"
SYSTEMD_DIR="${MACAROONIE_SYSTEMD_DIR:-/etc/systemd/system}"
SYSTEMCTL="${MACAROONIE_SYSTEMCTL:-systemctl}"
HTTP_PORT="${MACAROONIE_HUB_HTTP_PORT:-9180}"
# Hub first: the port the tills, kiosks and kitchen screens on the venue network use.
LAN_PORT="${MACAROONIE_HUB_LAN_PORT:-9181}"
WAIT_SECONDS="${MACAROONIE_WAIT_SECONDS:-40}"
SERVICE=macaroonie-hub

say() { printf '%s\n' "$*"; }
fail() { say "Install stopped: $*" >&2; exit 1; }

CHOICE=""
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --uninstall|--remove) CHOICE=remove ;;
    --keep) CHOICE=keep ;;
    --switch) CHOICE=switch ;;
    --force) FORCE=1 ;;
  esac
done
UNINSTALL=0
[ "$CHOICE" = remove ] && UNINSTALL=1

# Someone at a terminal to ask (piped from curl, stdin is the script: ask on the terminal).
has_tty() { (: < /dev/tty) 2>/dev/null; }
ask() {
  printf '%s' "$1" > /dev/tty
  REPLY=""
  read -r REPLY < /dev/tty || REPLY=""
}

# Run from a downloaded file without sudo: run itself again with sudo.
if [ "$(id -u)" != 0 ] && [ -f "$0" ] && command -v sudo >/dev/null 2>&1; then
  case "$0" in
    *.sh) say "The hub installs for the whole computer: type this computer's password if asked."
          exec sudo sh "$0" "$@" ;;
  esac
fi
[ "$(id -u)" = 0 ] || fail "run it as root: put sudo before sh"
[ "$(uname -s)" = Linux ] || fail "this installer is for Linux (on Windows use install.ps1)"

# "WingVibes, Ware (Venue hub)" from a line of link-info's JSON (on stdin).
describe_link() {
  "$1" -e '
let s = ""; process.stdin.on("data", d => { s += d }).on("end", () => {
  let i = {}; try { i = JSON.parse(s.trim().split("\n").pop()) } catch {}
  const where = [i.tenant_name, i.venue_name].filter(Boolean).join(", ") || "its venue"
  console.log(where + (i.name ? " (" + i.name + ")" : ""))
})'
}
json_field() { "$1" -e 'let s = ""; process.stdin.on("data", d => { s += d }).on("end", () => { let i = {}; try { i = JSON.parse(s.trim().split("\n").pop()) } catch {}; const v = i[process.argv[1]]; console.log(v === undefined || v === null ? "" : String(v)) })' "$2"; }

# Take this computer off its venue with the hub's own unlink (src/link.js):
# what waits goes to the cloud first, then the venue's files are deleted.
# Returns 1 when sales still wait and nobody agreed to lose them.
leave_venue() {  # node hub.js what
  force_arg=""
  [ "$FORCE" = 1 ] && force_arg="--force"
  while :; do
    out=$("$1" "$2" unlink --config "$HUB_HOME/hub.json" $force_arg 2>/dev/null || true)
    ok=$(printf '%s' "$out" | json_field "$1" ok)
    if [ "$ok" = true ]; then
      if [ "$(printf '%s' "$out" | json_field "$1" disconnected)" = true ]; then say "  Left $3. Store tech there shows this hub as not linked."
      elif [ "$(printf '%s' "$out" | json_field "$1" removed)" = true ]; then say "  $3 had removed this hub already."
      else say "  Left $3 here, but the cloud didn't answer: remove the hub in its Store tech -> Venue hub."; fi
      return 0
    fi
    unsent=$(printf '%s' "$out" | json_field "$1" unsent)
    [ -n "$unsent" ] || { say "  The hub couldn't leave $3." >&2; return 1; }
    why=$(printf '%s' "$out" | json_field "$1" error)
    say ""
    say "  $unsent sale(s) or change(s) from $3 are still on this computer and haven't reached the cloud${why:+ ($why)}."
    say "  Connect this computer to the internet and run this again: they go up first."
    has_tty || return 1
    ask "  To go ahead anyway and lose them, type LOSE (anything else stops here): "
    [ "$REPLY" = LOSE ] || return 1
    force_arg="--force"
  done
}

remove_hub() {
  $SYSTEMCTL disable --now "$SERVICE" >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_DIR/$SERVICE.service"
  $SYSTEMCTL daemon-reload >/dev/null 2>&1 || true
  rm -rf "$HUB_HOME"
  if id "$HUB_USER" >/dev/null 2>&1; then userdel "$HUB_USER" >/dev/null 2>&1 || true; fi
}

# Back to running as before (nothing was changed).
restart_hub() {
  chown -R "$HUB_USER": "$HUB_HOME" 2>/dev/null || true
  $SYSTEMCTL start "$SERVICE" >/dev/null 2>&1 || true
}

if [ "$UNINSTALL" = 1 ]; then
  say "Removing the Macaroonie hub..."
  $SYSTEMCTL stop "$SERVICE" >/dev/null 2>&1 || true
  node="$HUB_HOME/node/bin/node"
  cur_dir=""
  if [ -x "$node" ] && [ -f "$HUB_HOME/current.json" ]; then
    cur_dir=$("$node" -p 'require(process.argv[1]).dir || ""' "$HUB_HOME/current.json" 2>/dev/null || true)
  fi
  hub_js="$HUB_HOME/$cur_dir/hub/bin/hub.js"
  # Hubs from before unlink existed would start running instead.
  if [ -n "$cur_dir" ] && [ -f "$HUB_HOME/hub.json" ] && [ -f "$hub_js" ] && grep -q "'unlink'" "$hub_js"; then
    what=$("$node" "$hub_js" link-info --config "$HUB_HOME/hub.json" 2>/dev/null | describe_link "$node")
    if ! leave_venue "$node" "$hub_js" "$what"; then
      restart_hub
      fail "nothing was removed, the hub is running again"
    fi
  fi
  remove_hub
  say "Removed."
  exit 0
fi

case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) fail "this computer's processor ($(uname -m)) isn't supported: use an x86-64 or ARM64 mini PC" ;;
esac
for tool in curl tar sha256sum grep; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is missing: install it (sudo apt-get install -y $tool) and run this again"
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM
mkdir -p "$HUB_HOME"

# 1. Node.js, the hub's own copy.
NODE="$HUB_HOME/node/bin/node"
have=0
if [ -x "$NODE" ]; then have=$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0); fi
if [ "$have" -lt "$NODE_MAJOR" ]; then
  say "Downloading Node.js $NODE_MAJOR for linux-$ARCH..."
  curl -fsSL "$NODE_DIST/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" || fail "couldn't reach $NODE_DIST"
  file=$(grep -o "node-v[0-9.]*-linux-$ARCH\.tar\.gz" "$TMP/SHASUMS256.txt" | head -n 1)
  [ -n "$file" ] || fail "no Node.js $NODE_MAJOR for linux-$ARCH"
  curl -fsSL "$NODE_DIST/$file" -o "$TMP/$file" || fail "couldn't download $file"
  (cd "$TMP" && grep " $file\$" SHASUMS256.txt | sha256sum -c - >/dev/null 2>&1) || fail "the Node.js download doesn't match its checksum"
  rm -rf "$HUB_HOME/node.new"
  mkdir -p "$HUB_HOME/node.new"
  tar -xzf "$TMP/$file" -C "$HUB_HOME/node.new" --strip-components=1
  rm -rf "$HUB_HOME/node"
  mv "$HUB_HOME/node.new" "$HUB_HOME/node"
fi
say "Node.js $("$NODE" -v)"

# 2. The hub's user: lp for USB printers, dialout for serial ones.
if ! id "$HUB_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$HUB_HOME" --no-create-home --shell /usr/sbin/nologin "$HUB_USER" 2>/dev/null \
    || useradd --system --home-dir "$HUB_HOME" --no-create-home --shell /bin/false "$HUB_USER"
fi
for group in lp dialout; do
  if getent group "$group" >/dev/null 2>&1; then usermod -aG "$group" "$HUB_USER"; fi
done

# 3. The hub, from the cloud.
say "Downloading the hub from $API..."
curl -fsSL "$API/pos-api/hub/release" -o "$TMP/release.json" || fail "couldn't reach $API"
VERSION=$("$NODE" -p 'require(process.argv[1]).version' "$TMP/release.json")
SHA=$("$NODE" -p 'require(process.argv[1]).sha256' "$TMP/release.json")
curl -fsSL "$API/pos-api/hub/release.tgz" -o "$TMP/hub.tgz" || fail "couldn't download the hub"
echo "$SHA  $TMP/hub.tgz" | sha256sum -c - >/dev/null 2>&1 || fail "the hub download doesn't match its checksum: run this again"
DIR="releases/$(printf '%s' "$VERSION" | tr -c 'A-Za-z0-9._-' '_')"
mkdir -p "$HUB_HOME/releases"
rm -rf "$HUB_HOME/$DIR"
mkdir -p "$HUB_HOME/$DIR"
tar -xzf "$TMP/hub.tgz" -C "$HUB_HOME/$DIR"
"$NODE" "$HUB_HOME/$DIR/hub/bin/hub.js" --self-test >/dev/null || fail "the hub didn't pass its check"

# Already a hub here: keep it, link it to another restaurant or venue, or remove it.
NEW_HUB="$HUB_HOME/$DIR/hub/bin/hub.js"
if [ -f "$HUB_HOME/hub.json" ]; then
  info=$("$NODE" "$NEW_HUB" link-info --config "$HUB_HOME/hub.json" --api "$API" 2>/dev/null || true)
  linked=$(printf '%s' "$info" | json_field "$NODE" linked)
  same=$(printf '%s' "$info" | json_field "$NODE" same_api)
  status=$(printf '%s' "$info" | json_field "$NODE" status)
  what=$(printf '%s' "$info" | describe_link "$NODE")
  if [ "$linked" = true ] && [ "$same" = true ] && [ "$status" = removed ]; then
    say "This computer was the hub for $what, which removed it: it shows a new code to link it again."
  elif [ "$linked" = true ] && [ "$same" = true ]; then
    if [ -z "$CHOICE" ]; then
      say ""
      say "  This computer is already the venue hub for $what."
      [ "$status" = offline ] && say "  (The cloud didn't say what it is now: that's from when it was linked.)"
      say ""
      say "    1  Keep it for $what and update it"
      say "    2  Link it to another restaurant or venue instead"
      say "    3  Remove the hub from this computer"
      say ""
      if has_tty; then
        while [ -z "$CHOICE" ]; do
          ask "  Type 1, 2 or 3 and press Enter (Enter alone keeps it): "
          case "$REPLY" in
            ""|1) CHOICE=keep ;;
            2) CHOICE=switch ;;
            3) CHOICE=remove ;;
          esac
        done
      else
        CHOICE=keep
        say "  Kept (no one to ask). To change it, run this again with --switch or --uninstall."
      fi
    fi
    if [ "$CHOICE" != keep ]; then
      $SYSTEMCTL stop "$SERVICE" >/dev/null 2>&1 || true
      if ! leave_venue "$NODE" "$NEW_HUB" "$what"; then
        restart_hub
        fail "nothing changed: the hub is running again for $what"
      fi
      if [ "$CHOICE" = remove ]; then
        remove_hub
        say "Removed the hub from this computer."
        exit 0
      fi
      say "  Linking it again: it shows a new code below."
    fi
  fi
fi
cp "$HUB_HOME/$DIR/hub/bin/launcher.js" "$HUB_HOME/launcher.mjs"
"$NODE" -e '
const fs = require("fs"), path = require("path")
const [home, version, dir] = process.argv.slice(1)
const file = path.join(home, "current.json")
let cur = {}
try { cur = JSON.parse(fs.readFileSync(file, "utf8")) } catch {}
const previous = cur.version && cur.dir && cur.dir !== dir ? { version: cur.version, dir: cur.dir } : (cur.previous || null)
const next = { version, dir, previous, bad_versions: (cur.bad_versions || []).filter(v => v !== version), updated_at: new Date().toISOString() }
fs.writeFileSync(file + ".tmp", JSON.stringify(next, null, 2) + "\n")
fs.renameSync(file + ".tmp", file)' "$HUB_HOME" "$VERSION" "$DIR"
chown -R "$HUB_USER": "$HUB_HOME"
if [ -f "$HUB_HOME/hub.json" ]; then chmod 600 "$HUB_HOME/hub.json"; fi
say "Hub $VERSION installed in $HUB_HOME"

# 4. The service.
mkdir -p "$SYSTEMD_DIR"
cat > "$SYSTEMD_DIR/$SERVICE.service" <<UNIT
[Unit]
Description=Macaroonie venue hub (prints for the tills and kitchen)
After=network-online.target
Wants=network-online.target

[Service]
User=$HUB_USER
WorkingDirectory=$HUB_HOME
Environment=MACAROONIE_HUB_HOME=$HUB_HOME
ExecStart=$HUB_HOME/node/bin/node $HUB_HOME/launcher.mjs --api $API --http-port $HTTP_PORT --lan-port $LAN_PORT
Restart=always
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$HUB_HOME

[Install]
WantedBy=multi-user.target
UNIT
$SYSTEMCTL daemon-reload
$SYSTEMCTL enable "$SERVICE" >/dev/null 2>&1 || $SYSTEMCTL enable "$SERVICE"
rm -f "$HUB_HOME/state.json"   # read what the new start says, not the last one
$SYSTEMCTL restart "$SERVICE"

# The status page and the port the devices use on the venue's network, when the firewall is on.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$HTTP_PORT/tcp" comment "Macaroonie hub status page" >/dev/null 2>&1 || true
  ufw allow "$LAN_PORT/tcp" comment "Macaroonie hub for the venue's devices" >/dev/null 2>&1 || true
fi

# 5. The code to link it (or that it is linked already).
say "Starting the hub..."
i=0
summary=""
while [ "$i" -lt "$WAIT_SECONDS" ]; do
  if [ -f "$HUB_HOME/state.json" ]; then
    summary=$("$NODE" -e '
const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
if (s.phase === "linking" && s.link && s.link.code) console.log("code " + s.link.code + " " + (s.link.link_url || ""))
else if (s.phase === "running") console.log("running " + (s.name || "") + (s.venue_name ? " at " + s.venue_name : "") + (s.tenant_name ? ", " + s.tenant_name : ""))' "$HUB_HOME/state.json" 2>/dev/null || true)
    [ -n "$summary" ] && break
  fi
  sleep 1
  i=$((i + 1))
done

ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' || true)
say ""
case "$summary" in
  code*)
    set -- $summary
    say "  Link this hub: in Macaroonie open Store tech -> Venue hub -> Link a hub and type"
    say ""
    say "        $2"
    say ""
    if [ -n "${3:-}" ]; then say "  or open $3 on a phone."; fi
    ;;
  running*)
    say "  The hub is running and linked (${summary#running }). Nothing else to do."
    ;;
  *)
    say "  The hub didn't start in time. See what it says: journalctl -u $SERVICE -n 50"
    ;;
esac
say ""
for ip in $ips; do say "  Its page on the venue's network: http://$ip:$HTTP_PORT"; done
say "  Its log: journalctl -u $SERVICE -f"
say ""
