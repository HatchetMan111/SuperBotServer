# SuperBot-Server · Proxmox-Installer

Ein Agent-Team für Zuhause: [davidondrej/superbot](https://github.com/davidondrej/superbot) (`botd`, MIT) + eigene **React/Vite-Web-UI** — als LXC auf dem Proxmox-Host, installiert per **Einzeiler** im Stil der Community-Scripts.

> Du chattest mit Bots wie mit Kollegen: Jeder Bot hat einen Namen, einen Job, sein eigenes Gedächtnis und läuft auf dem Agent-CLI deiner Wahl (Claude Code, Codex, Pi). Der Primär-Bot (★ SuperBot) verteilt Arbeit an Sub-Bots — Bot-zu-Bot per `botctl ask`. Routinen laufen per Cron. Alles lokal im Container, keine Cloud dazwischen.

## 🚀 Installation (Proxmox-Host, root)

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/SuperBotServer/main/install/superbotserver.sh)"
```

Das Script:
- nimmt die **nächste freie CT-ID** (oder `--ctid N`) und baut einen unprivilegierten Debian-13-LXC `superbot` (2 vCPU, 4 GB RAM, 10 GB, `onboot=1`) — Template passend zur Host-Architektur (amd64 **und arm64**)
- baut `botd` aus dem **gepinnten Upstream** (Rust, `cargo build` im CT, ~3–6 min)
- legt die **React/Vite-UI** als dist ab (kein Node im CT) und verdrahtet sie per `WEB_DIR`
- installiert das **Claude-Code-CLI** für den Benutzer `superbot` + ein **ttyd-Web-Terminal**
- richtet **systemd**-Dienste ein (`Restart=always`, `After=network-online.target`) und verifiziert: Service aktiv · `healthz` OK · API-Login OK

Am Ende druckt der Installer **URL + Passwort + nächste Schritte** aus.

## 🌐 Zugänge

| Was | Adresse | Login |
|---|---|---|
| Web-UI (Chat, Bots, Routinen, Einrichtung) | `http://<CT-IP>:8097` | beliebiger Benutzername + Passwort (im Installer-Output) |
| Web-Terminal (Agent-CLI-Login) | `http://<CT-IP>:8098` | Benutzer `superbot` |

**Erster Schritt nach der Installation:** Web-Terminal öffnen → `claude login` (oder `ANTHROPIC_API_KEY` in `/opt/superbot/.env`). Danach zeigt 🛠️ **Einrichtung** in der UI den Status aller Agent-CLIs.

## 🤖 Bots einrichten (UI)

- **Chat** — Live-Streaming (SSE), Stop, Auswahlkarten, Modell/Denkaufwand pro Bot
- **Bots** — Super- & Sub-Bots anlegen/bearbeiten/löschen: Name, Harness, Modell, Effort, 11 Farben × 12 Roboter-Avatare
- **Routinen** — Cron-Aufgaben pro Bot (anlegen, pausieren, bearbeiten) — Bots können selbst welche bauen (`botctl routine add`)
- **Einrichtung** — Status der Agent-CLIs, Speicherorte, Update-Einzeiler zum Kopieren

Bot-zu-Bot und Routinen aus dem Chat heraus: der Primär-Bot nutzt `botctl ask "<Bot>" "<Nachricht>"` und `botctl routine add "<Name>" "<Cron>" "<Aufgabe>"`.

## 🔧 Verwaltung (auf dem Proxmox-Host)

```bash
… superbotserver.sh --update      # Upstream + Web-UI aktualisieren (.env/Passwort bleibt)
… superbotserver.sh --status      # CT, Dienste, healthz, Passwort
… superbotserver.sh --uninstall   # CT inkl. Bot-Daten löschen (Abfrage; --force = ohne)
… superbotserver.sh --ctid 150    # explizite CT-ID (beim Install/Update/Status)
… superbotserver.sh --bridge BR   # andere Proxmox-Bridge statt vmbr0
… superbotserver.sh --ip 192.168.178.111/24 --gw 192.168.178.1   # statisch statt DHCP
```
(alles mit dem selben Einzeiler von oben + Flag)

**Daten (backuppen):** `/home/superbot/data` (DB + Bot-Gedächtnis) · Arbeitsordner: `/home/superbot/workspace` · Konfig: `/opt/superbot/.env`

**Codex statt/neben Claude:** Installer mit `INSTALL_CODEX=1 bash -c "$(wget -qLO - …)"` starten, danach `codex login` im Web-Terminal. Pi: separat im CT installieren (`pi --login`).

**Hinweis zu Bot-Bildschirmen (Computer-Use):** im Installer bewusst `SCREENS=off` — das spart Xvfb/voxl/Chrome-Gefummel im LXC. Chat, Gedächtnis, Routinen und Bot-zu-Bot laufen vollständig. Aktivieren: Xvfb+openbox+voxl im CT installieren und `SCREENS` in `.env` setzen (siehe Upstream-Doku `docs/computer.md`).

## 🧩 Repo-Aufbau

```
install/superbotserver.sh   Proxmox-Installer (Signage-Stil, set -Eeuo pipefail + ERR-Trap)
webui/                      React 18 + Vite-UI (deutsch, hell/dunkel) — dist committed
tests/run-harness.sh        Mock-Harness: 95 Assertions über 22 Cases (unshare -rm + Mock-Root)
tests/mocks/                pct/pveam/curl/cargo/systemctl/…-Mocks + Fixtures
```

Entwicklung UI: `cd webui && npm run build` (Node ≥ 20) → dist committen. Der Build erzeugt bewusst genau `index.html + app.js + styles.css` — botd serviert nur diese 3 Dateien (harte Whitelist, `WEB_DIR`).

## 🙏 Credits

- [davidondrej/superbot](https://github.com/davidondrej/superbot) — der Server (`botd`/`botctl`) und die Roboter-Avatare (MIT)
- Web-UI: eigene React/Vite-Portierung auf die offizielle botd-API (SSE, Basic-Auth)
