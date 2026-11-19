#!/usr/bin/env bash
# Mock-Harness für install/superbotserver.sh (Muster: unshare -rm + Mock-Root, Grube 15/16)
# Jeder Case läuft im eigenen Mount-Namespace: /opt, /etc/systemd, /etc/sudoers.d,
# /root, /usr/local und /etc/resolv.conf sind Bind-Mounts in den Sandbox-Ordner.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT
INSTALLER="$ROOT/install/superbotserver.sh"
export INSTALLER
WORK="$ROOT/tests/.work"
PASSED=0; FAILED=0

unset -f grep 2>/dev/null || true   # Profil exportiert ugrep-Funktion (bekannte Grube)
command -v unshare >/dev/null || { echo "unshare fehlt"; exit 1; }
mkdir -p "$WORK"; rm -rf "$WORK"/sb-*

# ── Assertions ─────────────────────────────────────────────────────────────
SB="/unset"
sandbox_path() {  # Installations-Pfade in den Sandbox-Kontext auflösen
  local p="$1"
  p="${p/#\/opt\//$SB/opt/}"
  p="${p/#\/root\//$SB/ctfs/root/}"
  p="${p/#\/etc\/systemd\//$SB/etc-systemd/}"
  p="${p/#\/etc\/sudoers.d\//$SB/etc-sudoers/}"
  p="${p/#\/home\/superbot\//$SB/home/superbot/}"
  echo "$p"
}
expect_contains() {  # $1 name, $2 haystack, $3 needle
  if grep -qF -- "$3" <<<"$2"; then PASSED=$((PASSED+1)); echo "  PASS: $1"
  else FAILED=$((FAILED+1)); echo "  FAIL: $1 – erwartet: $3"; echo "    ── Output: $(head -c 400 <<<"$2" | tr '\n' '│')"; fi
}
expect_file() {  # $1 name, $2 install-Pfad (wird gemappt)
  local p; p="$(sandbox_path "$2")"
  if [[ -e "$p" ]]; then PASSED=$((PASSED+1)); echo "  PASS: $1"
  else FAILED=$((FAILED+1)); echo "  FAIL: $1 – fehlt: $p"; fi
}
expect_no_dir() {  # $1 name, $2 Pfad (muss fehlen)
  if [[ ! -e "$2" ]]; then PASSED=$((PASSED+1)); echo "  PASS: $1"
  else FAILED=$((FAILED+1)); echo "  FAIL: $1 – sollte fehlen: $2"; fi
}
expect_exec() {
  local p; p="$(sandbox_path "$2")"
  if [[ -x "$p" ]]; then PASSED=$((PASSED+1)); echo "  PASS: $1"
  else FAILED=$((FAILED+1)); echo "  FAIL: $1 – nicht ausführbar: $p"; fi
}
expect_calls() {  # $1 name, $2 needle in calls.log
  if grep -qF -- "$2" "$SB/state/calls.log" 2>/dev/null; then PASSED=$((PASSED+1)); echo "  PASS: $1"
  else FAILED=$((FAILED+1)); echo "  FAIL: $1 – calls.log ohne: $2"; fi
}
expect_no_calls() {
  if ! grep -qF -- "$2" "$SB/state/calls.log" 2>/dev/null; then PASSED=$((PASSED+1)); echo "  PASS: $1"
  else FAILED=$((FAILED+1)); echo "  FAIL: $1 – calls.log enthält unerwartet: $2"; fi
}
expect_rc() {  # $1 name, $2 erwartet (0|nz), $3 tatsächlich
  if { [[ "$3" == "0" && "$2" == "0" ]] || [[ "$3" != "0" && "$2" == "nz" ]]; }; then PASSED=$((PASSED+1)); echo "  PASS: $1"
  else FAILED=$((FAILED+1)); echo "  FAIL: $1 – rc=$3, erwartet $2"; fi
}
export -f sandbox_path expect_contains expect_file expect_no_dir expect_exec expect_calls expect_no_calls expect_rc

# ── Sandbox-Setup (läuft IM Namespace) ─────────────────────────────────────
sandbox_up() {
  export SB_STATE="$SB/state" SB_FIXTURES="$SB/fixtures"
  mkdir -p "$SB"/{state,fixtures,etc-sudoers,usr-local/bin,opt,ctfs/root,bin,home/superbot/data,home/superbot/workspace}
  mkdir -p "$SB/etc-systemd/system"   # /etc/systemd ist Bind-Mount → system/-Unterordner muss existieren
  for m in "$ROOT/tests/mocks/"*; do ln -sf "$m" "$SB/bin/$(basename "$m")"; done
  # default CT-Liste (Name = LETZTE Spalte, Grube 18) – 100/101/205 belegt → Auto-ID 102
  printf 'VMID Status Name\n100 running gamma\n101 running alpha\n205 running beta\n' > "$SB/state/ct-list.txt"
  # Fixtures (tar mit --owner=0 --group=0, Grube 16)
  local t; t="$(mktemp -d)"
  mkdir -p "$t/up/superbot-fakeSHA/server/src" "$t/web/SuperBotServer-main/webui/dist"
  echo "[workspace]" > "$t/up/superbot-fakeSHA/Cargo.toml"
  echo 'fn main() {}' > "$t/up/superbot-fakeSHA/server/src/main.rs"
  echo "<html>ui</html>" > "$t/web/SuperBotServer-main/webui/dist/index.html"
  echo "console.log('ui')" > "$t/web/SuperBotServer-main/webui/dist/app.js"
  echo "body{}" > "$t/web/SuperBotServer-main/webui/dist/styles.css"
  # Root-Ordner als Archiv-Wurzel (wie echte GitHub-Tarballs) – --strip-components=1 zählt sonst verschoben
  tar -czf "$SB/fixtures/upstream.tar.gz" --owner=0 --group=0 -C "$t/up" superbot-fakeSHA
  tar -czf "$SB/fixtures/webui.tar.gz" --owner=0 --group=0 -C "$t/web" SuperBotServer-main
  rm -rf "$t"
  printf '#!/bin/sh\nmkdir -p "$HOME/.cargo/bin"\nln -sf "$SB/bin/cargo" "$HOME/.cargo/bin/cargo"\necho rustup-ok >> "$SB_STATE/calls.log"\n' > "$SB/fixtures/install-rustup.sh"
  printf '#!/bin/sh\nmkdir -p "$HOME/.local/bin"\nprintf "#!/bin/sh\\necho claude-mock \\"\\$@\\"\\n" > "$HOME/.local/bin/claude"\nchmod 755 "$HOME/.local/bin/claude"\necho claude-ok >> "$SB_STATE/calls.log"\n' > "$SB/fixtures/install-claude.sh"
  printf '#!/bin/sh\nprintf "#!/bin/sh\\necho codex-mock \\"\\$@\\"\\n" > "$HOME/.local/bin/codex"\nchmod 755 "$HOME/.local/bin/codex"\necho codex-ok >> "$SB_STATE/calls.log"\n' > "$SB/fixtures/install-codex.sh"
  printf '#!/bin/sh\necho "ttyd 1.7.7 (mock)"\n' > "$SB/fixtures/ttyd-bin"
  chmod 755 "$SB/fixtures/"*.sh "$SB/fixtures/ttyd-bin"
  # Bind-Mounts: Sandbox übernimmt die kritischen Pfade
  # (/etc/resolv.conf ist auf dem Host ein Symlink → DNS-Datei per Installer-Var umleiten)
  mkdir -p "$SB/etc-sudoers" "$SB/resolv"
  printf 'nameserver 9.9.9.9\n' > "$SB/resolv/resolv.conf"
  mount --bind "$SB/etc-systemd" /etc/systemd
  mount --bind "$SB/etc-sudoers" /etc/sudoers.d
  mount --bind "$SB/usr-local" /usr/local
  mount --bind "$SB/opt" /opt
  mount --bind "$SB/ctfs/root" /root
  export PATH="$SB/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"   # sauberes PATH ohne Real-CLIs
  export INNER_LOG="$SB/var-log/superbot-setup.log"
  export DNS_RESOLV_FILE="$SB/resolv/resolv.conf"
  mkdir -p "$(dirname "$INNER_LOG")"
  export HOME="$SB/home/superbot"   # sonst zielen $HOME-Checks aufs echte User-Home
  export DATA_DIR="$SB/home/superbot/data" WORKSPACE_DIR="$SB/home/superbot/workspace"
}
seed_ct() {  # $1 VMID $2 Status $3 Hostname [+ env: seed .env/.pw/bin/webui]
  printf 'VMID Status Name\n101 running alpha\n%s %s %s\n205 running beta\n' "$1" "$2" "$3" > "$SB/state/ct-list.txt"
  if [[ "${4:-}" == "env" ]]; then
    mkdir -p "$SB/opt/superbot/bin" "$SB/opt/superbot/webui"
    printf 'HOST=0.0.0.0\nPORT=8097\nAUTH_PASSWORD=OldPass1234567890\nDEFAULT_HARNESS=claude\nSCREENS=off\n' > "$SB/opt/superbot/.env"
    printf 'OldPass1234567890\n' > "$SB/opt/superbot/.pw"
    printf '#!/bin/sh\necho old-botd\n' > "$SB/opt/superbot/bin/botd"; chmod 755 "$SB/opt/superbot/bin/botd"
    echo "<html>old</html>" > "$SB/opt/superbot/webui/index.html"
  fi
}
export -f sandbox_up seed_ct

# ── Case-Runner ────────────────────────────────────────────────────────────
run_case() {  # $1 name, $2 invoker, $3 seed-Snippet (optional), $4 env-Präfix (optional)
  local name="$1" invoker="$2" seed="${3:-}" envpre="${4:-}"
  echo "── $name"
  SB="$(mktemp -d "$WORK/sb-XXXXXX")"
  export SB INSTALLER
  local out rc=0
  out="$(mktemp)"
  unshare -rm bash -c '
    sandbox_up
    '"$envpre"'
    '"$seed"'
    '"$invoker"'
  ' >"$out" 2>&1 <<<"${CASE_STDIN:-}" || rc=$?
  OUT="$(cat "$out")"; RC=$rc
  rm -f "$out"
  if [[ "${HARNESS_DEBUG_OUT:-0}" == "1" ]]; then echo "  ┌─ Volle Ausgabe (rc=$RC):"; tail -n 25 <<<"$OUT" | sed 's/^/  │ /'; fi
  CASE_STDIN=""
}

report() {
  echo
  echo "═══ Ergebnis: $PASSED Assertions PASS, $FAILED FAIL ═══"
  rm -rf "$WORK"/sb-* 2>/dev/null
  [[ $FAILED -eq 0 ]]
}

# ══════════════════════════ CASES ══════════════════════════════════════════

run_case "install_happy (Auto-ID, Flags, Summary, Dateien)" 'bash "$INSTALLER"'
expect_rc "rc=0" 0 "$RC"
expect_contains "Summary mit URL" "$OUT" "http://10.0.0.42:8097"
expect_contains "Summary mit Web-Terminal :8098" "$OUT" "http://10.0.0.42:8098"
expect_contains "claude login als nächster Schritt" "$OUT" "claude login"
expect_calls "CT 102 erstellt (Auto-ID)" "create 102"
expect_contains "unprivileged" "$(cat "$SB/state/create-args.txt")" "--unprivileged 1"
expect_contains "nesting" "$(cat "$SB/state/create-args.txt")" "--features nesting=1"
expect_contains "onboot" "$(cat "$SB/state/create-args.txt")" "--onboot 1"
expect_contains "start" "$(cat "$SB/state/create-args.txt")" "--start 1"
expect_calls "systemd restart superbot" "systemctl restart superbot superbot-ttyd"
expect_calls "template geladen" "pveam download local debian-13-standard"
expect_calls "useradd superbot" "useradd -m -s /bin/bash superbot"
expect_calls "claude-Installer lief" "claude-ok"
expect_calls "ttyd geladen" "ttyd/releases/download"
expect_file "sudoers angelegt" "/etc/sudoers.d/superbot"
expect_file "botd gebaut" "/opt/superbot/bin/botd"
expect_exec "botd ausführbar" "/opt/superbot/bin/botd"
expect_file "botctl gebaut" "/opt/superbot/bin/botctl"
expect_file "webui index.html" "/opt/superbot/webui/index.html"
expect_file "webui app.js" "/opt/superbot/webui/app.js"
expect_file "webui styles.css" "/opt/superbot/webui/styles.css"
expect_file "Unit superbot.service" "/etc/systemd/system/superbot.service"
expect_file "Unit superbot-ttyd.service" "/etc/systemd/system/superbot-ttyd.service"
expect_no_dir "kein bin.old-Rest (Swap sauber)" "$SB/opt/superbot/bin.old"
expect_no_dir "kein webui.old-Rest (Swap sauber)" "$SB/opt/superbot/webui.old"
PW="$(cat "$SB/opt/superbot/.pw" 2>/dev/null || true)"
if [[ "$PW" =~ ^[A-Za-z0-9]{20}$ ]]; then PASSED=$((PASSED+1)); echo "  PASS: PW 20 alnum"; else FAILED=$((FAILED+1)); echo "  FAIL: PW='$PW'"; fi
expect_contains ".env mit Passwort" "$(cat "$SB/opt/superbot/.env")" "AUTH_PASSWORD=$PW"
expect_contains ".env HOST=0.0.0.0" "$(cat "$SB/opt/superbot/.env")" "HOST=0.0.0.0"
expect_contains ".env PORT=8097" "$(cat "$SB/opt/superbot/.env")" "PORT=8097"
expect_contains ".env SCREENS=off" "$(cat "$SB/opt/superbot/.env")" "SCREENS=off"
expect_contains ".env WEB_DIR" "$(cat "$SB/opt/superbot/.env")" "WEB_DIR=/opt/superbot/webui"
expect_contains "Summary druckt Passwort" "$OUT" "$PW"
expect_contains "Verifikation gelaufen" "$OUT" "API-Login OK"

run_case "install_--ctid_explicit" 'bash "$INSTALLER" --ctid 150'
expect_rc "rc=0" 0 "$RC"
expect_calls "CT 150 erstellt" "create 150"

run_case "install_--ip_statisch" 'bash "$INSTALLER" --ctid 151 --ip 10.0.0.9/24 --gw 10.0.0.1'
expect_rc "rc=0" 0 "$RC"
expect_contains "net0 statisch" "$(cat "$SB/state/create-args.txt")" "ip=10.0.0.9/24,gw=10.0.0.1"

run_case "install_--ip_ohne_--gw_stirbt" 'bash "$INSTALLER" --ctid 152 --ip 10.0.0.9/24'
expect_rc "rc nz" nz "$RC"
expect_contains "Fehler gw" "$OUT" "--gw (Gateway) nötig"

run_case "install_dup_hostname_stirbt" 'bash "$INSTALLER"' 'seed_ct 102 running superbot'
expect_rc "rc nz" nz "$RC"
expect_contains "Fehler mit Hinweis" "$OUT" "bereits ein CT mit Hostname"
expect_no_calls "kein create" "create 1"

run_case "install_ctid_taken_stirbt" 'bash "$INSTALLER" --ctid 101'
expect_rc "rc nz" nz "$RC"
expect_contains "Fehler" "$OUT" "bereits vergeben"

run_case "install_ohne_pct_stirbt" 'bash "$INSTALLER"' '' 'PATH="/usr/bin:/bin"'
expect_rc "rc nz" nz "$RC"
expect_contains "Fehler pct" "$OUT" "pct nicht gefunden"

run_case "install_cargo_fail_zeigt_Fehlerkette" 'FAIL_CARGO=1 bash "$INSTALLER"'
expect_rc "rc nz" nz "$RC"
expect_contains "ERR-Trap druckt Zeile+Befehl" "$OUT" "Fehler in Zeile"
expect_contains "Fehlerketten-Überschrift" "$OUT" "Vollständige Fehlerkette"
expect_contains "Inner-Log-Auszug" "$OUT" "mock cargo build failure"

run_case "install_systemctl_fail_zeigt_Fehlerkette" 'FAIL_SYSTEMCTL=1 bash "$INSTALLER"'
expect_rc "rc nz" nz "$RC"
expect_contains "ERR-Trap mit Zeile" "$OUT" "Fehler in Zeile"
expect_contains "Fehlerketten-Überschrift" "$OUT" "Vollständige Fehlerkette"
expect_contains "Inner kam bis systemd-Schritt" "$OUT" "7/7 Konfiguration"

run_case "dns_fallback_wird_geschrieben" 'DNS_FAIL_N=7 bash "$INSTALLER"'
expect_rc "rc=0" 0 "$RC"
expect_contains "Fallback-Warnung" "$OUT" "Fallback-Nameserver"
expect_contains "DNS danach ok" "$OUT" "DNS funktioniert"

run_case "healthz_fail_stirbt" 'FAIL_HEALTH=1 bash "$INSTALLER"'
expect_rc "rc nz" nz "$RC"
expect_contains "Fehler healthz" "$OUT" "healthz antwortet nicht"

run_case "api_login_fail_stirbt" 'FAIL_API=1 bash "$INSTALLER"'
expect_rc "rc nz" nz "$RC"
expect_contains "Fehler API" "$OUT" "API-Login fehlgeschlagen (HTTP 401)"

run_case "kein_template_stirbt" 'PVEAM_EMPTY=1 bash "$INSTALLER"'
expect_rc "rc nz" nz "$RC"
expect_contains "Fehler Template" "$OUT" "Kein debian-13-Template"

run_case "update_happy_env_erhalten" 'bash "$INSTALLER" --update' 'seed_ct 102 running superbot env'
expect_rc "rc=0" 0 "$RC"
expect_calls "Update gefunden" "exec 102 env"
expect_calls "INNER_MODE=update" "INNER_MODE=update"
expect_contains "Passwort erhalten" "$(cat "$SB/opt/superbot/.env")" "AUTH_PASSWORD=OldPass1234567890"
expect_contains "WEB_DIR ergänzt" "$(cat "$SB/opt/superbot/.env")" "WEB_DIR=/opt/superbot/webui"
expect_contains "Update-Summary" "$OUT" "Update fertig"
expect_calls "restart nach Update" "systemctl restart superbot superbot-ttyd"

run_case "update_startet_gestoppten_CT" 'bash "$INSTALLER" --update' 'seed_ct 102 stopped superbot env'
expect_rc "rc=0" 0 "$RC"
expect_calls "pct start" "start 102"

run_case "update_ohne_CT_stirbt" 'bash "$INSTALLER" --update'
expect_rc "rc nz" nz "$RC"
expect_contains "Fehler" "$OUT" "Kein CT mit Hostname"
expect_contains "Hinweis --ctid" "$OUT" "--ctid"

run_case "update_--ctid_unbekannt_stirbt" 'bash "$INSTALLER" --update --ctid 999'
expect_rc "rc nz" nz "$RC"
expect_contains "Fehler" "$OUT" "existiert nicht"

run_case "status_zeigt_IP_und_Passwort" 'bash "$INSTALLER" --status' 'seed_ct 102 running superbot env'
expect_rc "rc=0" 0 "$RC"
expect_contains "IP" "$OUT" "IP: 10.0.0.42"
expect_contains "Web-UI ok" "$OUT" "Web-UI erreichbar"
expect_contains "Passwort" "$OUT" "OldPass1234567890"
expect_contains "Service aktiv" "$OUT" "Service superbot: active"

CASE_STDIN=$'JA\n'
run_case "uninstall_mit_JA" 'bash "$INSTALLER" --uninstall' 'seed_ct 102 running superbot'
expect_rc "rc=0" 0 "$RC"
expect_calls "destroy" "destroy 102"

CASE_STDIN=$'nein\n'
run_case "uninstall_mit_nein_bricht_ab" 'bash "$INSTALLER" --uninstall' 'seed_ct 102 running superbot'
expect_rc "rc nz" nz "$RC"
expect_contains "Abbruch" "$OUT" "Abgebrochen"
expect_no_calls "kein destroy" "destroy 102"

run_case "uninstall_EOF_bricht_ab" 'bash "$INSTALLER" --uninstall' 'seed_ct 102 running superbot'
expect_rc "rc nz" nz "$RC"
expect_contains "Abbruch bei EOF" "$OUT" "Abgebrochen"
expect_no_calls "kein destroy" "destroy 102"

run_case "uninstall_--force_ohne_Prompt" 'bash "$INSTALLER" --uninstall --force' 'seed_ct 102 running superbot'
expect_rc "rc=0" 0 "$RC"
expect_calls "destroy" "destroy 102"

run_case "grube8_bash-c-0-Fallback_--status" 'bash -c "$(cat "$INSTALLER")" --status' 'seed_ct 102 running superbot env'
expect_rc "rc=0" 0 "$RC"
expect_contains "Status gelaufen trotz 0=--status" "$OUT" "SuperBot-Server Status"

run_case "grube8_bash-c-0-Fallback_--uninstall_--force" 'bash -c "$(cat "$INSTALLER")" --uninstall --force' 'seed_ct 102 running superbot'
expect_rc "rc=0" 0 "$RC"
expect_calls "destroy via bash -c" "destroy 102"

run_case "--help_zeigt_Optionen" 'bash "$INSTALLER" --help'
expect_rc "rc=0" 0 "$RC"
expect_contains "Hilfe" "$OUT" "Optionen:"
expect_contains "Hilfe update" "$OUT" "--update"

report
