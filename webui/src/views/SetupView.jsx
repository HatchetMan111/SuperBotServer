import React, { useState } from "react";
import { copyText } from "../api.js";

// Anmelde-Info je Harness. "installiert" (API: harnesses-Liste) bedeutet nur:
// CLI-Binary auf PATH – die ANMELDUNG beim Anbieter ist ein separater Schritt!
const HARNESS_INFO = {
  claude: {
    label: "Claude Code",
    login: "claude login",
    env: "ANTHROPIC_API_KEY",
    note: "Direkt bei Anthropic (Abo oder API-Key) – OpenRouter läuft hier nicht. Standard-Harness.",
  },
  codex: {
    label: "Codex (OpenAI)",
    login: "codex login",
    env: "OPENAI_API_KEY",
    note: "Optional per Installer-Flag INSTALL_CODEX=1 nachinstalliert.",
  },
  pi: {
    label: "Pi Agent (OpenRouter + viele Anbieter)",
    login: "echo 'OPENROUTER_API_KEY=sk-or-v1-DEIN-KEY' >> /opt/superbot/.env && sudo systemctl restart superbot",
    env: "OPENROUTER_API_KEY",
    note: "Pi ist beim Installer mit dabei. Anmeldung: OpenRouter-Key in .env ODER `pi` starten und dort /login.",
  },
};

// Einrichtungs-Panel: Was läuft, was fehlt, wie melde ich Agent-CLIs an.
export default function SetupView({ me, harnesses, bots, showToast }) {
  const [copied, setCopied] = useState("");
  const ttydUrl = `http://${window.location.hostname}:8098`;
  const ctIp = window.location.hostname;

  const copy = async (text, key) => {
    const ok = await copyText(text);
    if (ok) { setCopied(key); showToast("In die Zwischenablage kopiert!", "ok"); setTimeout(() => setCopied(""), 1500); }
    else showToast("Kopieren fehlgeschlagen – bitte manuell markieren.");
  };

  const cmdBtn = (cmd, key) => (
    <button className={`cmd ${copied === key ? "copied" : ""}`} onClick={() => copy(cmd, key)} title="Klicken = kopieren">
      <code>{cmd}</code><span>{copied === key ? "✓ kopiert" : "⧉"}</span>
    </button>
  );

  const openrouterEnvCmd = "echo 'OPENROUTER_API_KEY=sk-or-v1-DEIN-KEY' >> /opt/superbot/.env && sudo systemctl restart superbot";
  const piInstallCmd = "curl -fsSL https://pi.dev/install.sh | sh";

  return (
    <div className="page">
      <div className="page-head"><div>
        <h2>🛠️ Einrichtung</h2>
        <p className="sub">Alles läuft lokal in deinem LXC-Container „superbot" ({ctIp}).</p>
      </div></div>

      <div className="status-grid">
        <div className="stat-card">
          <span className="stat-num">{bots.length}</span>
          <span className="stat-label">Bots eingerichtet</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{harnesses.length}/3</span>
          <span className="stat-label">Agent-CLIs installiert</span>
        </div>
        <div className="stat-card">
          <span className="stat-num ok">✓</span>
          <span className="stat-label">Server (botd) läuft<br /><small>systemd: superbot.service</small></span>
        </div>
      </div>

      <div className="hint-box" style={{ marginTop: 22 }}>
        ⚠️ <strong>„installiert" ≠ „angemeldet":</strong> Der Installer legt die CLI-Binarys ab (Claude Code ist als Standard schon da) — angemeldet ist KEINE davon. Ohne Anmeldung bekommt der Bot beim ersten Lauf einen Fehler. Unten steht pro Agent, wie du ihn anmeldest.
      </div>

      <h3 className="section">🔑 OpenRouter nutzen <small>(ein Key, viele Modelle – läuft über den Pi-Agent)</small></h3>
      <div className="setup-cards">
        <div className={`setup-card ${harnesses.includes("pi") ? "ok" : "missing"}`}>
          <div className="setup-card-head"><strong>OpenRouter über Pi</strong>
            <span className={`pill ${harnesses.includes("pi") ? "ok" : "warn"}`}>{harnesses.includes("pi") ? "✓ Pi installiert" : "✗ Pi fehlt"}</span>
          </div>
          {harnesses.includes("pi") ? (
            <ol>
              <li>Key erstellen: <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a> („sk-or-v1-…")</li>
              <li>Key eintragen (Web-Terminal oder klicken = kopieren, dann Key einsetzen):</li>
            </ol>
          ) : (
            <>
              <p>Pi-Agent installieren (Web-Terminal, Benutzer <code>superbot</code>):</p>
              {cmdBtn(piInstallCmd, "pi-install")}
              <ol>
                <li>Key erstellen: <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a> („sk-or-v1-…")</li>
                <li>Key eintragen:</li>
              </ol>
            </>
          )}
          {cmdBtn(openrouterEnvCmd, "openrouter-env")}
          <ol start={3}>
            <li>In der Web-UI: 🤖 Bots → Neuer Bot → Agent <strong>„pi"</strong> wählen → Modellliste erscheint automatisch (alle Modelle mit gültigem Key).</li>
          </ol>
          <p className="note">Claude Code / Codex sind Direkt-Anmeldungen (Anthropic/OpenAI) und laufen nicht über OpenRouter. Alternativ: <code>pi</code> im Web-Terminal starten → dort <code>/login</code>.</p>
        </div>
      </div>

      <h3 className="section">Agent-CLIs anmelden <small>(jeder Bot läuft auf einem CLI-Agent)</small></h3>
      <div className="setup-cards">
        {Object.entries(HARNESS_INFO).map(([h, info]) => {
          const installed = harnesses.includes(h);
          return (
            <div key={h} className={`setup-card ${installed ? "ok" : "missing"}`}>
              <div className="setup-card-head">
                <strong>{info.label}</strong>
                <span className={`pill ${installed ? "ok" : "warn"}`}>{installed ? "✓ CLI installiert" : "✗ nicht installiert"}</span>
              </div>
              <ol>
                <li>Öffne das <a href={ttydUrl} target="_blank" rel="noopener">Web-Terminal ({ttydUrl})</a></li>
                <li>Anmelden (Benutzer: <code>superbot</code>) – {installed ? "jetzt ausführen:" : "danach ausführen:"}</li>
              </ol>
              {cmdBtn(info.login, `${h}-login`)}
              <p className="alt">Alternativ per API-Key: Env-Variable <code>{info.env}</code> in <code>/opt/superbot/.env</code> setzen und <code>sudo systemctl restart superbot</code>.</p>
              <p className="note">{info.note}</p>
            </div>
          );
        })}
      </div>

      <h3 className="section">Daten &amp; Betrieb</h3>
      <div className="setup-cards">
        <div className="setup-card">
          <div className="setup-card-head"><strong>📂 Speicherorte (sichern!)</strong></div>
          <ul>
            <li>Datenbank + Bot-Gedächtnis: <code>/home/superbot/data</code></li>
            <li>Gemeinsamer Arbeitsordner der Bots: <code>/home/superbot/workspace</code></li>
            <li>Konfiguration: <code>/opt/superbot/.env</code> (Passwort, Ports, API-Keys …)</li>
            <li>Programm: <code>/opt/superbot/bin</code> (botd + botctl)</li>
          </ul>
          <p className="note">Backup = den Ordner <code>/home/superbot/data</code> kopieren.</p>
        </div>
        <div className="setup-card">
          <div className="setup-card-head"><strong>🔧 Befehle (auf dem Proxmox-Host)</strong></div>
          {cmdBtn(`pct exec $(pct list | awk '/\\bsuperbot\\b/{print $1}') -- login`, "console")}
          <p>oder direkt: <code>pct console &lt;CT-ID&gt;</code> (Strg+Ö zum Verlassen).</p>
          <p className="note">Neustart der App: <code>sudo systemctl restart superbot</code> · Status: <code>systemctl status superbot</code></p>
        </div>
        <div className="setup-card">
          <div className="setup-card-head"><strong>🖥️ Bot-Bildschirme (Computer-Use)</strong></div>
          <p>Aktuell <strong>aus</strong> – das spart Ressourcen. Die Chat-, Gedächtnis-, Routine- und Bot-zu-Bot-Funktionen laufen vollständig.</p>
          <p className="note">Zum Aktivieren: im Container <code>xvfb openbox</code> installieren und Screens-Env setzen (siehe README, Abschnitt „Screens").</p>
        </div>
      </div>

      <h3 className="section">Update</h3>
      <div className="setup-card">
        <p>App + Web-UI aktualisieren (auf dem Proxmox-Host):</p>
        {cmdBtn("bash -c \"$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/SuperBotServer/main/install/superbotserver.sh)\" --update", "update")}
        <p className="note">Nach einem Installer-Update landen auch neue Agent-CLIs im CT (z. B. Pi nachträglich).</p>
      </div>
    </div>
  );
}
