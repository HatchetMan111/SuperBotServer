import React, { useState } from "react";
import { copyText } from "../api.js";

const HARNESS_INFO = {
  claude: { label: "Claude Code", login: "claude login", env: "ANTHROPIC_API_KEY", note: "Empfohlen als Standard-Harness." },
  codex: { label: "Codex (OpenAI)", login: "codex login", env: "OPENAI_API_KEY", note: "Optional per Installer-Flag INSTALL_CODEX=1." },
  pi: { label: "Pi Agent", login: "pi --login", env: "OPENROUTER_API_KEY", note: "Pi muss im Container separat installiert werden." },
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

      <h3 className="section">Agent-CLIs anmelden <small>(jeder Bot läuft auf einem CLI-Agent)</small></h3>
      <div className="setup-cards">
        {Object.entries(HARNESS_INFO).map(([h, info]) => {
          const installed = harnesses.includes(h);
          return (
            <div key={h} className={`setup-card ${installed ? "ok" : "missing"}`}>
              <div className="setup-card-head">
                <strong>{info.label}</strong>
                <span className={`pill ${installed ? "ok" : "warn"}`}>{installed ? "✓ installiert" : "✗ nicht installiert"}</span>
              </div>
              {installed ? (
                <p>Fertig eingerichtet – du kannst Bots auf <strong>{h}</strong> anlegen.</p>
              ) : (
                <>
                  <ol>
                    <li>Öffne das <a href={ttydUrl} target="_blank" rel="noopener">Web-Terminal ({ttydUrl})</a></li>
                    <li>Anmelden (Benutzer: <code>superbot</code>) und ausführen:</li>
                  </ol>
                  {cmdBtn(info.login, `${h}-login`)}
                  <p className="alt">Alternativ per API-Key: Env-Variable <code>{info.env}</code> in <code>/opt/superbot/.env</code> setzen und <code>sudo systemctl restart superbot</code>.</p>
                </>
              )}
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
            <li>Konfiguration: <code>/opt/superbot/.env</code> (Passwort, Ports, Zeitzone …)</li>
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
      </div>
    </div>
  );
}
