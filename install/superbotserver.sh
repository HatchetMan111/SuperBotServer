#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  SuperBot-Server Installer für Proxmox VE (LXC, Community-Scripts-Stil)
#
#  Installiert davidondrej/superbot (botd) + eigene React/Vite-Web-UI in einen
#  Debian-13-LXC. Ein Agent-Team (Super-/Sub-Bots) auf Claude Code / Codex / Pi.
#
#  Einzeiler (auf dem Proxmox-Host):
#    bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/SuperBotServer/main/install/superbotserver.sh)"
#
#  Modi: (ohne Flag) Install · --update · --uninstall · --status · --ctid N
# ═══════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail

# ── Konfiguration ──────────────────────────────────────────────────────────
APP_NAME="SuperBot"
CT_HOSTNAME="superbot"
REPO_RAW="https://raw.githubusercontent.com/HatchetMan111/SuperBotServer/main/install/superbotserver.sh"
# shellcheck disable=SC2016  # bewusst single-quoted: kopierfertiger Literal-Einzeiler
ONE_LINER='bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/SuperBotServer/main/install/superbotserver.sh)"'

UPSTREAM_REPO="davidondrej/superbot"
UPSTREAM_SHA="652e100fc3412239fd5a07ca7bb8566213c5b6fa"   # gepinnt (superbot main, 2026-11-19)
WEBUI_REPO="HatchetMan111/SuperBotServer"                  # dist ist committed → kein Node im CT

PORT=8097            # Web-UI + API (botd)
TTYD_PORT=8098       # Web-Terminal (Agent-CLI-Login)
CORES=2
RAM_MB=4096
DISK_GB=10
SWAP_MB=1024
BRIDGE="${BRIDGE:-vmbr0}"
STORAGE="${STORAGE:-local-lvm}"

DEFAULT_HARNESS="claude"
INSTALL_CODEX="${INSTALL_CODEX:-0}"     # 1 = zusätzlich Codex-CLI installieren
USER_NAME_VALUE="${USER_NAME_VALUE:-Phil}"
PRIMARY_BOT_NAME="SuperBot"
TZ_VALUE="Europe/Berlin"
RUN_TIMEOUT_MINUTES=60

CT_USER="superbot"                        # botd läuft NICHT als root (Claude-Code-Pflicht)
APP_DIR="/opt/superbot"
DATA_DIR="${DATA_DIR:-/home/${CT_USER}/data}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/home/${CT_USER}/workspace}"
INNER_LOG="${INNER_LOG:-/var/log/superbot-setup.log}"
DNS_RESOLV_FILE="${DNS_RESOLV_FILE:-/etc/resolv.conf}"   # im CT; Harness überschreibt (Symlink-Grube)

# ── Farben & Helper ────────────────────────────────────────────────────────
C_G="\033[1;32m"; C_Y="\033[1;33m"; C_R="\033[1;31m"; C_B="\033[1;36m"; C_W="\033[1;37m"; C_0="\033[0m"
info()  { echo -e "${C_B}▸${C_0} $*"; }
ok()    { echo -e "${C_G}✔${C_0} $*"; }
warn()  { echo -e "${C_Y}⚠${C_0} $*"; }
err()   { echo -e "${C_R}✘${C_0} $*" >&2; }
die()   { err "$*"; exit 1; }
header() { echo -e "${C_W}═══ $* ═══${C_0}"; }

on_error() {
  local code=$1 line=$2
  echo >&2
  err "Fehler in Zeile ${line} (Exit ${code}): ${BASH_COMMAND}"
  echo -e "${C_Y}── Vollständige Fehlerkette ──${C_0}" >&2
  if [[ -n "${CT_ID:-}" ]] && pct status "$CT_ID" >/dev/null 2>&1; then
    pct exec "$CT_ID" -- tail -n 50 "$INNER_LOG" 2>/dev/null | sed 's/^/    │ /' >&2 || true
    pct exec "$CT_ID" -- journalctl -u superbot -u superbot-ttyd -n 30 --no-pager 2>/dev/null | sed 's/^/    │ /' >&2 || true
  fi
  err "Debug mit vollständigem Trace: wget -qLO /tmp/sb-install.sh ${REPO_RAW} && bash -x /tmp/sb-install.sh [Optionen]"
  err "Log im CT: pct exec <CT-ID> -- cat ${INNER_LOG}"
  exit "$code"
}
trap 'on_error $? $LINENO' ERR

# bash -c "$(wget …)" --flag landet in $0, nicht $1 (bekannte Grube) → $0-Fallback:
if [[ "${0}" == -* ]]; then set -- "$0" "$@"; fi

usage() {
  cat <<'USAGE'
SuperBot-Server Installer (Proxmox-Host, root):

  bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/SuperBotServer/main/install/superbotserver.sh)"

Optionen:
  (ohne)        Neuinstallation (LXC mit nächster freier ID)
  --ctid N      Explizite CT-ID verwenden
  --update      Bestehenden SuperBot-CT aktualisieren (Upstream + Web-UI)
  --status      Status von CT, Diensten und Web-UI anzeigen
  --uninstall   CT inkl. Bot-Daten löschen (Abfrage; --force = ohne)
  --force       Bestätigungsabfragen überspringen
  --help        Diese Hilfe
USAGE
}

MODE="install"; CT_ID=""; FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update)    MODE="update" ;;
    --uninstall) MODE="uninstall" ;;
    --status)    MODE="status" ;;
    --force)     FORCE=1 ;;
    --ctid)      CT_ID="$2"; shift ;;
    --help|-h)   usage; exit 0 ;;
    *)           die "Unbekannte Option: $1 (verfügbar: --update --uninstall --status --ctid N --force --help)" ;;
  esac
  shift
done

# ── Grund Checks (Host) ────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Bitte als root ausführen (auf dem Proxmox-Host)."
command -v pct >/dev/null || die "pct nicht gefunden – das Script gehört auf den Proxmox-Host (PVE), nicht in einen Gast."
command -v pveam >/dev/null || die "pveam nicht gefunden – Proxmox VE nötig."

# ── CT-Findung / freie ID ──────────────────────────────────────────────────
find_ct_id_by_hostname() {  # $1=hostname → VMID oder leer ($NF statt $4, Grube 13)
  local id
  id="$(pct list 2>/dev/null | awk -v n="$1" '$NF == n {print $1}' || true)"
  if [[ -z "$id" ]]; then
    local cand
    for cand in $(pct list 2>/dev/null | awk 'NR>1 {print $1}' || true); do
      if [[ "$(pct config "$cand" 2>/dev/null | grep -E '^hostname: ' | awk '{print $2}')" == "$1" ]]; then
        id="$cand"; break
      fi
    done
  fi
  echo "$id"
}

next_free_id() {  # niedrigste freie VMID ab 100
  local used id i
  used="$(pct list 2>/dev/null | awk 'NR>1 {print $1}'; qm list 2>/dev/null | awk 'NR>1 {print $1}' || true)"
  for i in $(seq 100 999); do
    if ! grep -qx "$i" <<<"$used"; then echo "$i"; return 0; fi
  done
  return 1
}

# ── Netz/DNS-Warten (Grube 4/11/11a: IP-Poll reicht nicht, DNS 3× bestätigen) ─
wait_ct_network() {  # Progress NUR nach stderr (Grube 29: kein stdout-Pollution in $())
  local id=$1 ip="" i
  info "Warte auf Netzwerk des Containers …" >&2
  for i in $(seq 1 120); do
    ip="$(pct exec "$id" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
    if [[ -n "$ip" ]]; then echo "$ip"; return 0; fi
    sleep 1
  done
  return 1
}

verify_ct_dns() {  # 3 konsekutive Erfolge verlangen (Grube 11a)
  local id=$1 host=$2 ok=0 i
  for i in $(seq 1 9); do
    if pct exec "$id" -- getent hosts "$host" >/dev/null 2>&1; then
      ok=$((ok+1))
      if [[ $ok -ge 3 ]]; then return 0; fi
    else
      ok=0
    fi
    sleep 1
  done
  return 1
}

fix_ct_dns() {  # Fallback-Nameserver schreiben + erneut prüfen
  local id=$1
  warn "DNS im CT defekt – schreibe Fallback-Nameserver …"
  pct exec "$id" -- bash -c "printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > ${DNS_RESOLV_FILE}"
}

ensure_ct_running() {  # Grube 10: pct exec auf gestopptem CT → Exit 255
  local id=$1 st
  st="$(pct status "$id" 2>/dev/null | awk '{print $2}' || true)"
  if [[ "$st" != "running" ]]; then
    info "Starte Container $id …"
    pct start "$id"
    wait_ct_network "$id" >/dev/null || true
  fi
}

http_ok() {  # curl-Statuscheck OHNE || echo 000 (Grube 2)
  local url=$1 code
  code="$(curl -sL -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)"
  [[ "$code" == "200" ]]
}

# ── Inner-Setup (läuft IM CT; Quoted-Heredoc, Werte via env, Grube 14/14a) ──
inner_script() { cat <<'INNEREOF'
#!/usr/bin/env bash
set -Eeuo pipefail
MODE="${INNER_MODE:?}" PORT="${INNER_PORT:?}" TTYD_PORT="${INNER_TTYD_PORT:?}"
CT_USER="${INNER_CT_USER:?}" APP_DIR="${INNER_APP_DIR:?}"
UPSTREAM_REPO="${INNER_UPSTREAM_REPO:?}" UPSTREAM_SHA="${INNER_UPSTREAM_SHA:?}"
WEBUI_REPO="${INNER_WEBUI_REPO:?}"
DEFAULT_HARNESS="${INNER_DEFAULT_HARNESS:?}" INSTALL_CODEX="${INNER_INSTALL_CODEX:?}"
USER_NAME_VALUE="${INNER_USER_NAME:?}" PRIMARY_BOT_NAME="${INNER_PRIMARY_BOT_NAME:?}"
TZ_VALUE="${INNER_TZ:?}" RUN_TIMEOUT_MINUTES="${INNER_RUN_TIMEOUT:?}"
DATA_DIR="${INNER_DATA_DIR:?}" WORKSPACE_DIR="${INNER_WORKSPACE_DIR:?}"
export DEBIAN_FRONTEND=noninteractive

say()  { echo "▸ $*"; }
ok_in() { echo "✔ $*"; }

# 1) apt ZUERST (nacktes Template hat kein curl – Grube 21), Downloads danach
say "1/7 Systempakete (apt)"
apt-get update -qq
apt-get install -y -qq curl ca-certificates git build-essential pkg-config ca-certificates wget procps >/dev/null
ok_in "Basis-Pakete"

say "2/7 Benutzer ${CT_USER}"
if ! id "$CT_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$CT_USER"
  echo "${CT_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart superbot, /usr/bin/systemctl status superbot" > "/etc/sudoers.d/${CT_USER}"
  chmod 440 "/etc/sudoers.d/${CT_USER}"
fi
ok_in "Benutzer vorhanden"

say "3/7 ttyd Web-Terminal"
if [[ ! -x /usr/local/bin/ttyd ]]; then
  curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64"
  chmod 755 /usr/local/bin/ttyd
fi
ok_in "ttyd $(/usr/local/bin/ttyd --version 2>/dev/null | head -1 || echo '')"

say "4/7 Rust-Toolchain + Agent-CLIs (Benutzer ${CT_USER})"
SU="su - ${CT_USER} -c"
if ! $SU 'test -x "$HOME/.cargo/bin/cargo"' 2>/dev/null; then
  $SU 'curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable' >/dev/null
fi
if ! $SU 'command -v claude >/dev/null 2>&1 || test -x "$HOME/.local/bin/claude"'; then
  $SU 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null
fi
if [[ "$INSTALL_CODEX" == "1" ]] && ! $SU 'command -v codex >/dev/null 2>&1 || test -x "$HOME/.local/bin/codex"'; then
  $SU 'curl -fsSL https://codex.openai.com/install.sh | bash' >/dev/null
fi
ok_in "Toolchain + CLIs"

say "5/7 SuperBot bauen (Upstream ${UPSTREAM_SHA:0:8}) – dauert einige Minuten"
rm -rf /tmp/sb-src "${APP_DIR}/bin.new"
mkdir -p /tmp/sb-src "${APP_DIR}/bin.new"
curl -fsSL "https://github.com/${UPSTREAM_REPO}/archive/${UPSTREAM_SHA}.tar.gz" | tar -xz -C /tmp/sb-src --strip-components=1
chown -R "${CT_USER}:" /tmp/sb-src
$SU 'export PATH="$HOME/.cargo/bin:$PATH"; cd /tmp/sb-src && cargo build --release' >/dev/null
cp /tmp/sb-src/target/release/botd /tmp/sb-src/target/release/botctl "${APP_DIR}/bin.new/"
chmod 755 "${APP_DIR}/bin.new/botd" "${APP_DIR}/bin.new/botctl"
# Swap-Muster statt mv-INTO (Grube 23); bei Crash bleibt *.old als Rollback liegen
rm -rf "${APP_DIR}/bin.old"
if [[ -d "${APP_DIR}/bin" ]]; then mv "${APP_DIR}/bin" "${APP_DIR}/bin.old"; fi
mv "${APP_DIR}/bin.new" "${APP_DIR}/bin"
rm -rf "${APP_DIR}/bin.old" /tmp/sb-src
ok_in "botd + botctl gebaut"

say "6/7 Web-UI (React/Vite-Dist aus ${WEBUI_REPO})"
rm -rf /tmp/webui-src "${APP_DIR}/webui.new"
mkdir -p /tmp/webui-src "${APP_DIR}/webui.new"
curl -fsSL "https://codeload.github.com/${WEBUI_REPO}/tar.gz/refs/heads/main" | tar -xz -C /tmp/webui-src --strip-components=1
cp -a /tmp/webui-src/webui/dist/. "${APP_DIR}/webui.new/"
rm -rf "${APP_DIR}/webui.old"
if [[ -d "${APP_DIR}/webui" ]]; then mv "${APP_DIR}/webui" "${APP_DIR}/webui.old"; fi
mv "${APP_DIR}/webui.new" "${APP_DIR}/webui"
rm -rf "${APP_DIR}/webui.old" /tmp/webui-src
chown -R root:root "${APP_DIR}"
ok_in "Web-UI: $(ls "${APP_DIR}/webui" | tr '\n' ' ')"

say "7/7 Konfiguration (.env) + systemd"
if [[ ! -f "${APP_DIR}/.env" ]]; then
  # endliche Quelle statt tr|head (SIGPIPE unter pipefail → Exit 141)
  PW="$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')"
  PW="${PW:0:20}"
  cat > "${APP_DIR}/.env" <<ENVEOF
# SuperBot-Konfiguration (bei --update unangetastet – Passwort bleibt)
HOST=0.0.0.0
PORT=${PORT}
AUTH_PASSWORD=${PW}
USER_NAME="${USER_NAME_VALUE}"
DEFAULT_HARNESS=${DEFAULT_HARNESS}
DATA_DIR=${DATA_DIR}
WORKSPACE_DIR=${WORKSPACE_DIR}
WEB_DIR=${APP_DIR}/webui
TZ=${TZ_VALUE}
RUN_TIMEOUT_MINUTES=${RUN_TIMEOUT_MINUTES}
SCREENS=off
PRIMARY_BOT_NAME=${PRIMARY_BOT_NAME}
ENVEOF
  chmod 600 "${APP_DIR}/.env"
  echo "${PW}" > "${APP_DIR}/.pw"   # für --status
  chmod 600 "${APP_DIR}/.pw"
  echo "PW_GENERATED=${PW}" > /tmp/superbot-pw-flag
else
  # fehlende Schlüssel ergänzen (idempotent, Passwort bleibt)
  grep -q '^WEB_DIR=' "${APP_DIR}/.env" || echo "WEB_DIR=${APP_DIR}/webui" >> "${APP_DIR}/.env"
  grep -q '^SCREENS=' "${APP_DIR}/.env" || echo "SCREENS=off" >> "${APP_DIR}/.env"
fi
mkdir -p "${DATA_DIR}" "${WORKSPACE_DIR}"
chown -R "${CT_USER}:${CT_USER}" "${DATA_DIR}" "${WORKSPACE_DIR}"

cat > /etc/systemd/system/superbot.service <<UNIT1
[Unit]
Description=SuperBot (botd) – AI-Bot-Team Webserver
After=network-online.target
Wants=network-online.target

[Service]
User=${CT_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=PATH=/home/${CT_USER}/.local/bin:/home/${CT_USER}/.cargo/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${APP_DIR}/bin/botd
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT1

cat > /etc/systemd/system/superbot-ttyd.service <<UNIT2
[Unit]
Description=SuperBot Web-Terminal (ttyd) für Agent-CLI-Logins
After=network.target

[Service]
User=${CT_USER}
ExecStart=/usr/local/bin/ttyd --writable --port ${TTYD_PORT} bash -l
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT2

systemctl daemon-reload
systemctl enable -q superbot superbot-ttyd
systemctl restart superbot superbot-ttyd
sleep 2
systemctl is-active --quiet superbot || { journalctl -u superbot -n 30 --no-pager; exit 1; }
systemctl is-active --quiet superbot-ttyd || { journalctl -u superbot-ttyd -n 30 --no-pager; exit 1; }
ok_in "Systemd-Dienste laufen"
echo "INNER_DONE"
INNEREOF
}

run_inner() {  # $1 = MODE; Grube 14: pipefail-tee, damit Inner-Crash sichtbar bleibt
  local mode=$1
  info "Übertrage Setup in den Container …"
  inner_script > /tmp/.superbot-inner.sh
  bash -n /tmp/.superbot-inner.sh || die "Inner-Script hat Syntaxfehler (Generierung kaputt)."
  pct exec "$CT_ID" -- bash -c "rm -f ${INNER_LOG}"
  pct push "$CT_ID" /tmp/.superbot-inner.sh /root/.superbot-inner.sh >/dev/null
  set +e
  pct exec "$CT_ID" -- env \
    INNER_MODE="$mode" INNER_PORT="$PORT" INNER_TTYD_PORT="$TTYD_PORT" \
    INNER_CT_USER="$CT_USER" INNER_APP_DIR="$APP_DIR" \
    INNER_UPSTREAM_REPO="$UPSTREAM_REPO" INNER_UPSTREAM_SHA="$UPSTREAM_SHA" \
    INNER_WEBUI_REPO="$WEBUI_REPO" INNER_DEFAULT_HARNESS="$DEFAULT_HARNESS" \
    INNER_INSTALL_CODEX="$INSTALL_CODEX" INNER_USER_NAME="$USER_NAME_VALUE" \
    INNER_PRIMARY_BOT_NAME="$PRIMARY_BOT_NAME" INNER_TZ="$TZ_VALUE" \
    INNER_RUN_TIMEOUT="$RUN_TIMEOUT_MINUTES" INNER_DATA_DIR="$DATA_DIR" \
    INNER_WORKSPACE_DIR="$WORKSPACE_DIR" \
    bash -c "set -o pipefail; bash /root/.superbot-inner.sh 2>&1 | tee ${INNER_LOG}"
  local inner_rc=$?
  set -e
  if [[ $inner_rc -ne 0 ]] || ! pct exec "$CT_ID" -- grep -q INNER_DONE "$INNER_LOG"; then
    die "Inner-Setup fehlgeschlagen (Exit ${inner_rc}) – Log: pct exec $CT_ID -- cat $INNER_LOG"
  fi
}

# ════════════════════════════ INSTALL ══════════════════════════════════════
do_install() {
  header "${APP_NAME}-Server Installation"
  local template
  info "Suche Debian-13-Template …"
  pveam update >/dev/null 2>&1 || true
  template="$(pveam available 2>/dev/null | grep -o 'debian-13-standard[^ ]*' | sort -rV | head -1 || true)"
  [[ -n "$template" ]] || die "Kein debian-13-Template gefunden (pveam available leer?)."
  if ! pveam list local 2>/dev/null | grep -q "$template"; then
    info "Lade Template ${template} …"
    pveam download local "$template" >/dev/null
  fi
  ok "Template ${template} lokal"

  if [[ -z "$CT_ID" ]]; then
    CT_ID="$(next_free_id)" || die "Keine freie CT-ID gefunden."
  fi
  if pct list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$CT_ID"; then
    die "CT-ID $CT_ID ist bereits vergeben (--ctid weglassen = automatisch)."
  fi
  if [[ -n "$(find_ct_id_by_hostname "$CT_HOSTNAME")" ]]; then
    die "Es existiert bereits ein CT mit Hostname '${CT_HOSTNAME}' (ID $(find_ct_id_by_hostname "$CT_HOSTNAME")). Update mit: ${ONE_LINER} --update"
  fi

  info "Erstelle LXC ${CT_ID} (${CORES} vCPU, ${RAM_MB} MB RAM, ${DISK_GB} GB) …"
  pct create "$CT_ID" "local:vztmpl/${template}" \
    --hostname "$CT_HOSTNAME" \
    --unprivileged 1 \
    --features nesting=1 \
    --cores "$CORES" --memory "$RAM_MB" --swap "$SWAP_MB" \
    --rootfs "${STORAGE}:${DISK_GB}" \
    --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
    --onboot 1 --start 1 >/dev/null
  ok "Container ${CT_ID} erstellt"

  local ct_ip
  ct_ip="$(wait_ct_network "$CT_ID")" || die "CT bekam keine IP (DHCP?). Diagnose: pct exec $CT_ID -- hostname -I"
  ok "IP: ${ct_ip}"
  verify_ct_dns "$CT_ID" "deb.debian.org" || fix_ct_dns "$CT_ID"
  verify_ct_dns "$CT_ID" "deb.debian.org" || die "DNS im CT defekt. Diagnose: pct exec $CT_ID -- getent hosts deb.debian.org"
  ok "DNS funktioniert"

  run_inner install
  verify_installation "$CT_ID" "$ct_ip"
  summary_install "$CT_ID" "$ct_ip"
}

# ═════════════════════════════ UPDATE ══════════════════════════════════════
do_update() {
  header "${APP_NAME}-Server Update"
  if [[ -z "$CT_ID" ]]; then
    CT_ID="$(find_ct_id_by_hostname "$CT_HOSTNAME")" || true
    [[ -n "$CT_ID" ]] || die "Kein CT mit Hostname '${CT_HOSTNAME}' gefunden. Mit --ctid N explizit angeben."
  fi
  pct list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$CT_ID" || die "CT-ID $CT_ID existiert nicht."
  ensure_ct_running "$CT_ID"
  local ct_ip
  ct_ip="$(wait_ct_network "$CT_ID")" || die "CT hat keine IP."
  verify_ct_dns "$CT_ID" "github.com" || fix_ct_dns "$CT_ID"
  verify_ct_dns "$CT_ID" "github.com" || die "DNS im CT defekt."
  info "Update auf Upstream ${UPSTREAM_SHA:0:8} + neue Web-UI …"
  run_inner update
  verify_installation "$CT_ID" "$ct_ip"
  summary_update "$CT_ID" "$ct_ip"
}

# ═════════════════════════════ STATUS ══════════════════════════════════════
do_status() {
  header "${APP_NAME}-Server Status"
  if [[ -z "$CT_ID" ]]; then
    CT_ID="$(find_ct_id_by_hostname "$CT_HOSTNAME")" || true
    [[ -n "$CT_ID" ]] || die "Kein '${CT_HOSTNAME}'-CT gefunden (--ctid N angeben)."
  fi
  local st ip pw
  st="$(pct status "$CT_ID" 2>/dev/null | awk '{print $2}' || true)"
  info "CT ${CT_ID} (${CT_HOSTNAME}): ${st}"
  if [[ "$st" == "running" ]]; then
    ip="$(pct exec "$CT_ID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
    info "IP: ${ip:-unbekannt}"
    for svc in superbot superbot-ttyd; do
      local sst
      sst="$(pct exec "$CT_ID" -- systemctl is-active "$svc" 2>/dev/null || true)"
      info "Service ${svc}: ${sst}"
    done
    if http_ok "http://${ip}:${PORT}/healthz"; then ok "Web-UI erreichbar: http://${ip}:${PORT}"; else warn "Web-UI antwortet NICHT auf :${PORT}"; fi
    pw="$(pct exec "$CT_ID" -- cat "${APP_DIR}/.pw" 2>/dev/null || true)"
    if [[ -n "$pw" ]]; then
      info "Login: beliebiger Benutzername, Passwort: ${pw}"
    fi
  fi
}

# ═════════════════════════════ UNINSTALL ═══════════════════════════════════
do_uninstall() {
  header "${APP_NAME}-Server Deinstallation"
  if [[ -z "$CT_ID" ]]; then
    CT_ID="$(find_ct_id_by_hostname "$CT_HOSTNAME")" || true
    [[ -n "$CT_ID" ]] || die "Kein '${CT_HOSTNAME}'-CT gefunden (--ctid N angeben)."
  fi
  warn "CT ${CT_ID} (${CT_HOSTNAME}) inkl. ALLER Bot-Daten (${DATA_DIR}) wird gelöscht!"
  if [[ $FORCE -ne 1 ]]; then
    read -r -p "Wirklich löschen? Tippe 'JA': " answer || answer=""
    [[ "$answer" == "JA" ]] || die "Abgebrochen."
  fi
  pct stop "$CT_ID" 2>/dev/null || true
  pct destroy "$CT_ID"
  ok "CT ${CT_ID} gelöscht."
}

# ═════════════════════════════ VERIFY + SUMMARY ════════════════════════════
verify_installation() {
  local id=$1 ip=$2
  info "Verifikation …"
  pct exec "$id" -- systemctl is-active --quiet superbot || die "Service superbot läuft nicht (Log: pct exec $id -- journalctl -u superbot -n 50)"
  pct exec "$id" -- systemctl is-active --quiet superbot-ttyd || die "Service superbot-ttyd läuft nicht."
  http_ok "http://${ip}:${PORT}/healthz" || die "healthz antwortet nicht auf http://${ip}:${PORT}"
  local pw
  pw="$(pct exec "$id" -- cat "${APP_DIR}/.pw" 2>/dev/null || true)"
  if [[ -n "$pw" ]]; then
    local code
    code="$(curl -sL -o /dev/null -w '%{http_code}' --max-time 10 -u "user:${pw}" "http://${ip}:${PORT}/api/state" || true)"
    [[ "$code" == "200" ]] || die "API-Login fehlgeschlagen (HTTP ${code})."
  fi
  ok "Service läuft · healthz OK · API-Login OK"
}

summary_install() {
  local id=$1 ip=$2 pw
  pw="$(pct exec "$id" -- cat "${APP_DIR}/.pw" 2>/dev/null || true)"
  echo
  echo -e "${C_G}════════════════════════════════════════════════════════════${C_0}"
  echo -e "${C_W}  🤖 SuperBot ist installiert!${C_0}"
  echo -e "${C_G}════════════════════════════════════════════════════════════${C_0}"
  echo
  echo -e "  🌐 Web-UI:        ${C_B}http://${ip}:${PORT}${C_0}"
  echo -e "  🔑 Login:         beliebiger Benutzername · Passwort: ${C_W}${pw}${C_0}"
  echo -e "  💻 Web-Terminal:  ${C_B}http://${ip}:${TTYD_PORT}${C_0}  (Benutzer ${CT_USER}, kein PW)"
  echo
  echo -e "  ${C_W}Nächster Schritt – Agent-CLI anmelden:${C_0}"
  echo -e "   1. Web-Terminal öffnen:  http://${ip}:${TTYD_PORT}"
  echo -e "   2. Einloggen (Benutzer ${CT_USER}) und ausführen:"
  echo -e "        ${C_G}claude login${C_0}   (oder API-Key in ${APP_DIR}/.env: ANTHROPIC_API_KEY=…)"
  echo -e "   3. Danach in der Web-UI unter 🛠️ Einrichtung prüfen (✓ installiert)."
  echo
  echo -e "  📂 Daten (Backup!):  ${DATA_DIR}  ·  Arbeitsordner: ${WORKSPACE_DIR}"
  echo -e "  🔧 Host-Befehle:     pct exec ${id} -- systemctl status superbot"
  echo -e "  ⬆️  Update später:    ${ONE_LINER} --update"
  echo -e "${C_G}════════════════════════════════════════════════════════════${C_0}"
  echo
}

summary_update() {
  local id=$1 ip=$2
  echo
  ok "Update fertig – Web-UI: http://${ip}:${PORT} (Login unverändert, siehe ${APP_DIR}/.env)"
  echo
}

case "$MODE" in
  install)   do_install ;;
  update)    do_update ;;
  status)    do_status ;;
  uninstall) do_uninstall ;;
esac
