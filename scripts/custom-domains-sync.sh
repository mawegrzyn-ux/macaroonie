#!/usr/bin/env bash
# Keeps nginx in step with the custom domains tenants have set up in
# Website > Domain, so nobody has to run scripts/nginx-custom-domain.sh by hand.
#
# Installed by scripts/install-domain-sync.sh (run by every deploy) as
# /usr/local/sbin/macaroonie-domains-sync, started by a systemd timer every
# minute and straight away when the API writes $STATE_DIR/kick (Verify DNS,
# domain changed). Each run:
#   - reads the domains saved in tenant_site;
#   - switches on each verified one that has no HTTPS block yet: checks its DNS
#     points only at this server (A, and AAAA if any), then runs the domain
#     script for it, plus the www / bare twin when that points here too;
#   - takes off every macaroonie-domain-* block whose domain no tenant has saved
#     any more (and deletes its certificate).
# A failed certificate is retried after 5 min, 15 min, 1 h, 6 h, then daily
# (Let's Encrypt allows 5 failed checks per name per hour), or 2 minutes after a
# kick. Progress goes to $STATE_DIR/<domain>.json, which the API shows in the
# Domain section; $STATE_DIR/last-run says the sync is running.
#
# The database decides: a block for a domain nobody has saved is removed.
# `touch $STATE_DIR/disabled` stops the sync (the admin then shows the manual
# command again). Logs: journalctl -u macaroonie-domains
set -uo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/app}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/api/.env}"
STATE_DIR="${STATE_DIR:-/var/lib/macaroonie-domains}"
DOMAIN_SCRIPT="${DOMAIN_SCRIPT:-/usr/local/sbin/macaroonie-domain}"
AVAILABLE="${NGINX_AVAILABLE:-/etc/nginx/sites-available}"
ENABLED="${NGINX_ENABLED:-/etc/nginx/sites-enabled}"
LOCK_DIR="${LOCK_DIR:-/run/lock}"

HOST_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
NOW=$(date +%s)

[[ -f "${STATE_DIR}/disabled" ]] && exit 0
mkdir -p "$STATE_DIR"

exec 8>"${LOCK_DIR}/macaroonie-domains-sync.lock"
flock -n 8 || exit 0

env_val() {
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//"
}

DB="${DATABASE_URL:-$(env_val DATABASE_URL)}"
ROOT="${PUBLIC_ROOT_DOMAIN:-$(env_val PUBLIC_ROOT_DOMAIN)}"; ROOT="${ROOT:-macaroonie.com}"; ROOT="${ROOT,,}"
EXTRA_IPS="${APP_PUBLIC_IPS:-$(env_val APP_PUBLIC_IPS)}"

if [[ -z "$DB" ]]; then echo "No DATABASE_URL (looked in ${ENV_FILE})" >&2; exit 1; fi

# ── The domains tenants have saved ─────────────────────────────────────────
# Every tenant's row, so in system mode (migration 176 forces row-level
# security: without app.bypass_rls the app's role sees no rows at all, and
# the removal below would take every domain off). Same switch as systemSql.
db_query() {
  PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c app.bypass_rls=on" PGCONNECT_TIMEOUT=10 \
    psql "$DB" -v ON_ERROR_STOP=1 -tA -F'|' -c "$1"
}
SITES=$(db_query "SELECT count(*) FROM tenant_site") || {
  echo "Couldn't read tenant_site; nothing changed." >&2
  exit 1
}
ROWS=$(db_query "SELECT lower(custom_domain), custom_domain_verified FROM tenant_site WHERE custom_domain IS NOT NULL AND custom_domain <> ''") || {
  echo "Couldn't read tenant_site; nothing changed." >&2
  exit 1
}
# No website rows at all means the query can't see them (access, an empty or
# wrong database), not that every tenant left: change nothing.
if [[ "${SITES//[[:space:]]/}" == "0" ]]; then
  echo "tenant_site looks empty from here (database access?); nothing changed." >&2
  exit 1
fi

declare -A SAVED=()
WANTED=()
while IFS='|' read -r d verified; do
  [[ -n "$d" ]] || continue
  if [[ ! "$d" =~ $HOST_RE ]]; then echo "Skipping saved domain that isn't a host name: ${d}" >&2; continue; fi
  SAVED[$d]=1
  [[ "$verified" == "t" ]] && WANTED+=("$d")
done <<<"$ROWS"

# ── Helpers ────────────────────────────────────────────────────────────────
json_str() {
  local s="$1"
  s=${s//\\/\\\\}; s=${s//\"/\\\"}
  s=$(printf '%s' "$s" | tr '\n\t\r' '   ' | tr -d '\000-\037')
  printf '"%s"' "$s"
}

state_file() { echo "${STATE_DIR}/$1.json"; }
state_num()  { grep -o "\"$2\":[0-9]*" "$(state_file "$1")" 2>/dev/null | head -1 | cut -d: -f2; }
state_str()  { grep -o "\"$2\":\"[^\"]*\"" "$(state_file "$1")" 2>/dev/null | head -1 | cut -d'"' -f4; }

# write_state domain status message attempts last_try next_try names...
write_state() {
  local d=$1 status=$2 msg=$3 attempts=$4 last=$5 next=$6; shift 6
  local names="" n tmp
  for n in "$@"; do names+="${names:+,}$(json_str "$n")"; done
  tmp=$(mktemp "${STATE_DIR}/.tmp.XXXXXX")
  printf '{"domain":%s,"status":%s,"message":%s,"names":[%s],"attempts":%s,"last_try":%s,"next_try":%s,"updated_at":%s}\n' \
    "$(json_str "$d")" "$(json_str "$status")" "$(json_str "$msg")" "$names" \
    "${attempts:-0}" "${last:-0}" "${next:-0}" "$NOW" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$(state_file "$d")"
}

serves_https() { grep -qs 'listen[[:space:]]\+443' "${ENABLED}/macaroonie-domain-$1"; }
# Every name the domain's nginx block answers for.
conf_names() {
  grep -hs 'server_name' "${ENABLED}/macaroonie-domain-$1" \
    | sed -E 's/^[[:space:]]*server_name[[:space:]]+//; s/;.*$//' | tr ' ' '\n' | grep -v '^$' | sort -u
}

resolve4() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u; }
# AAAA records. `getent hosts` asks for IPv6 first and, unlike ahostsv6, still
# returns them on a server that has no IPv6 address itself (AI_ADDRCONFIG).
resolve6() { getent hosts "$1" 2>/dev/null | awk '$1 ~ /:/ {print $1}' | grep -v '^::ffff:' | sort -u; }

OUR4=$( { resolve4 "$ROOT"; tr ', ' '\n\n' <<<"$EXTRA_IPS" | grep -E '^[0-9.]+$'; } | sort -u)
OUR6=$( { resolve6 "$ROOT"; tr ', ' '\n\n' <<<"$EXTRA_IPS" | grep ':'; } | sort -u)

# Why a name can't get a certificate here yet; nothing when its DNS is right.
dns_problem() {
  local name=$1 a aaaa bad
  [[ -n "$OUR4" ]] || return 0   # can't tell what "here" is: let certbot decide
  a=$(resolve4 "$name")
  if [[ -z "$a" ]]; then
    echo "${name} has no A record (or CNAME) yet."; return
  fi
  bad=$(comm -23 <(echo "$a") <(echo "$OUR4"))
  if [[ -n "$bad" ]]; then
    echo "${name} points at $(paste -sd, <<<"$bad"), not at our server ($(paste -sd, <<<"$OUR4"))."; return
  fi
  aaaa=$(resolve6 "$name")
  [[ -n "$aaaa" ]] || return 0
  if [[ -n "$OUR6" ]]; then bad=$(comm -23 <(echo "$aaaa") <(echo "$OUR6")); else bad="$aaaa"; fi
  if [[ -n "$bad" ]]; then
    echo "${name} has an IPv6 (AAAA) record, $(paste -sd, <<<"$bad"), that isn't our server. Delete it at your DNS provider: certificates are checked over IPv6 first."
  fi
}

twin_of() { if [[ "$1" == www.* ]]; then echo "${1#www.}"; else echo "www.$1"; fi; }

# Seconds to wait after the n-th failed certificate.
backoff() {
  case "$1" in
    1) echo 300 ;; 2) echo 900 ;; 3) echo 3600 ;; 4) echo 21600 ;; *) echo 86400 ;;
  esac
}

# The useful line(s) from certbot's failure output.
cert_reason() {
  local out=$1 why
  why=$(grep -E '^[[:space:]]*Detail:' <<<"$out" | sed -E 's/^[[:space:]]*Detail:[[:space:]]*//' | head -3 | paste -sd';')
  [[ -n "$why" ]] || why=$(grep -iE 'too many|rate limit|error|failed' <<<"$out" \
    | grep -vE '^(No certificate yet|Usual causes|or Cloudflare)' | head -1)
  [[ -n "$why" ]] || why="certbot couldn't issue a certificate."
  echo "${why:0:400}"
}

KICK=$(stat -c %Y "${STATE_DIR}/kick" 2>/dev/null || echo 0)

# ── Take off domains nobody has saved any more ─────────────────────────────
declare -A REMOVED=()
for f in "${AVAILABLE}"/macaroonie-domain-* "${ENABLED}"/macaroonie-domain-*; do
  [[ -e "$f" ]] || continue
  d=${f##*/macaroonie-domain-}
  [[ -n "${SAVED[$d]:-}" || -n "${REMOVED[$d]:-}" ]] && continue
  REMOVED[$d]=1
  echo "${d}: no tenant has this domain any more; removing it."
  REMOVE=1 DELETE_CERT=1 bash "$DOMAIN_SCRIPT" "$d" 8>&- || echo "${d}: removal failed" >&2
  rm -f "$(state_file "$d")"
done
# State files of domains that are gone.
for f in "${STATE_DIR}"/*.json; do
  [[ -e "$f" ]] || continue
  d=$(basename "$f" .json)
  [[ -n "${SAVED[$d]:-}" ]] || rm -f "$f"
done
for f in "${STATE_DIR}"/twins/*; do
  [[ -e "$f" ]] || continue
  t=${f##*/}
  [[ -n "${SAVED[$(twin_of "$t")]:-}" ]] || rm -f "$f"
done

# ── Switch on verified domains ─────────────────────────────────────────────
for d in "${WANTED[@]}"; do
  if serves_https "$d"; then
    [[ "$(state_str "$d" status)" == "https" ]] || write_state "$d" https "" 0 "$NOW" 0 $(conf_names "$d")
    # The www / bare twin, once its DNS points here too (it may come later
    # than the main name). The domain script keeps https://$d on if this fails.
    twin=$(twin_of "$d")
    if [[ "$twin" =~ $HOST_RE && -z "${SAVED[$twin]:-}" ]] && ! conf_names "$d" | grep -Fxq "$twin"; then
      tf="${STATE_DIR}/twins/${twin}"
      t_attempts=0 t_next=0
      [[ -f "$tf" ]] && read -r t_attempts t_next < "$tf"
      if (( NOW >= ${t_next:-0} )) && [[ -z "$(dns_problem "$twin")" ]]; then
        echo "${d}: adding ${twin}, which points here now"
        out=$(bash "$DOMAIN_SCRIPT" "$d" "$twin" 2>&1 8>&-); rc=$?
        printf '%s\n' "$out" | sed "s/^/  ${d}: /"
        if (( rc == 0 )) && conf_names "$d" | grep -Fxq "$twin"; then
          rm -f "$tf"
          write_state "$d" https "" 0 "$NOW" 0 $(conf_names "$d")
        else
          t_attempts=$(( ${t_attempts:-0} + 1 ))
          mkdir -p "${STATE_DIR}/twins"
          echo "$t_attempts $(( NOW + $(backoff "$t_attempts") ))" > "$tf"
          echo "${d}: couldn't add ${twin} yet (attempt ${t_attempts}). $(cert_reason "$out")"
        fi
      fi
    fi
    continue
  fi

  attempts=$(state_num "$d" attempts); attempts=${attempts:-0}
  last=$(state_num "$d" last_try);     last=${last:-0}
  next=$(state_num "$d" next_try);     next=${next:-0}
  if (( NOW < next )) && ! (( KICK > last && NOW - last >= 120 )); then
    continue
  fi

  problem=$(dns_problem "$d")
  if [[ -n "$problem" ]]; then
    # No certificate request, so no Let's Encrypt attempt used: check every run.
    [[ "$(state_str "$d" message)" == "$problem" ]] || echo "${d}: waiting for DNS: ${problem}"
    write_state "$d" waiting_dns "$problem" "$attempts" "$last" 0 "$d"
    continue
  fi

  names=("$d")
  twin=$(twin_of "$d")
  if [[ "$twin" =~ $HOST_RE && -z "${SAVED[$twin]:-}" ]] && [[ -z "$(dns_problem "$twin")" ]]; then
    names+=("$twin")
  fi

  echo "${d}: switching on (${names[*]})"
  write_state "$d" working "" "$attempts" "$NOW" 0 "${names[@]}"
  out=$(bash "$DOMAIN_SCRIPT" "${names[@]}" 2>&1 8>&-); rc=$?
  printf '%s\n' "$out" | sed "s/^/  ${d}: /"
  if (( rc == 0 )) && serves_https "$d"; then
    echo "${d}: on, with HTTPS."
    write_state "$d" https "" 0 "$NOW" 0 "${names[@]}"
  else
    attempts=$((attempts + 1))
    wait=$(backoff "$attempts")
    status=error
    [[ -e "${ENABLED}/macaroonie-domain-${d}" ]] && status=http
    reason=$(cert_reason "$out")
    echo "${d}: no certificate yet (attempt ${attempts}); trying again in $((wait / 60)) min. ${reason}"
    write_state "$d" "$status" "$reason" "$attempts" "$NOW" $((NOW + wait)) "${names[@]}"
  fi
done

printf '{"at":%s}\n' "$NOW" > "${STATE_DIR}/last-run"
chmod 644 "${STATE_DIR}/last-run"
exit 0
