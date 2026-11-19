import React from "react";
import { Avatar } from "../avatar.jsx";

// Bot-Verwaltung: alle Super-/Sub-Bots als Karten, Klick = bearbeiten.
export default function BotsView({ bots, harnesses, messages, openNewBot, openEditBot }) {
  const subs = bots.filter((b) => !b.primary);
  const hiddenCount = bots.filter((b) => b.hidden).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>🤖 Deine Bots</h2>
          <p className="sub">
            {bots.length} Bot{bots.length === 1 ? "" : "s"} · {subs.length} Sub-Bot{subs.length === 1 ? "" : "s"}{hiddenCount ? ` · ${hiddenCount} versteckt` : ""} ·
            Agent-CLIs installiert: {harnesses.length ? harnesses.map((h) => h).join(", ") : "keine"}
          </p>
        </div>
        <button className="btn primary" onClick={openNewBot}>➕ Neuer Bot</button>
      </div>

      {!bots.length ? (
        <div className="empty-page">
          <Avatar color="#e8702e" shape="waddle" size={90} />
          <h3>Noch keine Bots</h3>
          <p>Erstelle deinen ersten Bot – er bekommt einen Namen, eine Aufgabe und seinen eigenen Agenten.</p>
          <button className="btn primary" onClick={openNewBot}>➕ Ersten Bot erstellen</button>
        </div>
      ) : (
        <div className="card-grid">
          {bots.map((b) => (
            <button key={b.id} className={`bot-card ${b.hidden ? "is-hidden" : ""}`} onClick={() => openEditBot(b)}>
              <div className="bot-card-top">
                <Avatar color={b.color} shape={b.shape} size={58} />
                <div className="bot-card-name">
                  <strong>{b.name}</strong>
                  <span className="harness-tag">{b.harness}</span>
                  {b.primary && <span className="primary-tag">★ Primär (SuperBot)</span>}
                  {b.hidden && <span className="hidden-tag">versteckt</span>}
                </div>
              </div>
              <div className="bot-card-meta">
                <span title="Modell">🧠 {b.model || "Standard-Modell"}{b.effort ? ` · ${b.effort}` : ""}</span>
                <span title="Nachrichten">{(messages[b.id] || []).length} Nachr.</span>
                <span className={b.working ? "live" : "idle"}>{b.working ? "● arbeitet" : "○ bereit"}</span>
              </div>
              {b.preview && <div className="bot-card-preview">„{b.preview}"</div>}
              <div className="bot-card-edit">✏️ Bearbeiten</div>
            </button>
          ))}
        </div>
      )}

      <div className="hint-box">
        💡 <strong>Super- &amp; Sub-Bots:</strong> Der <em>Primär-Bot</em> (★) ist dein Chef-Bot. Er kann Arbeit an Sub-Bots verteilen
        (<code>botctl ask "Name" "Nachricht"</code>) – jeder Bot hat seinen eigenen Chat, sein eigenes Gedächtnis und seinen eigenen Agenten.
      </div>
    </div>
  );
}
