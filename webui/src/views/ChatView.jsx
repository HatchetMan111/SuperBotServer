import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, copyText, esc, md } from "../api.js";
import { Avatar } from "../avatar.jsx";

export default function ChatView({
  bots, messages, drafts, activeBot, activeId, harnesses,
  open, send, stop, patchBot, openNewBot, openEditBot,
}) {
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const primaryBot = bots.find((b) => b.primary);
  const list = useMemo(() => {
    const q = filter.toLowerCase();
    return bots
      .filter((b) => !b.primary && (showHidden ? b.hidden : !b.hidden))
      .filter((b) => !q || b.name.toLowerCase().includes(q) || (b.preview || "").toLowerCase().includes(q));
  }, [bots, filter, showHidden]);
  const hiddenCount = bots.filter((b) => b.hidden).length;

  return (
    <div className="chat-layout">
      <aside className="sidebar">
        {primaryBot && (
          <button className={`primary-bot ${primaryBot.id === activeId ? "active" : ""}`} onClick={() => open(primaryBot.id)}>
            <div className="avatar-wrap">
              <Avatar color={primaryBot.color} shape={primaryBot.shape} size={72} />
              <span className="badge" title="Primär-Bot (SuperBot)">★</span>
              {primaryBot.unread && primaryBot.id !== activeId && <span className="unread" />}
            </div>
            <span className="p-name">{primaryBot.name}</span>
            {primaryBot.working && <span className="working-hint">arbeitet …</span>}
          </button>
        )}
        <div className="sidebar-tools">
          <input className="search" placeholder="🔍 Bot suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="btn primary small" onClick={openNewBot}>➕ Neuer Bot</button>
        </div>
        <div className="bot-list">
          {list.map((b) => (
            <button key={b.id} className={`bot-row ${b.id === activeId ? "active" : ""}`} onClick={() => open(b.id)}>
              <Avatar color={b.color} shape={b.shape} size={44} />
              <div className="meta">
                <div className="name">{b.name}</div>
                <div className="preview">{b.working ? <em>{b.status || "Working"} …</em> : b.preview || ""}</div>
              </div>
              {b.unread && b.id !== activeId && <span className="unread" />}
            </button>
          ))}
          {!list.length && <div className="empty">{showHidden ? "Keine versteckten Bots." : "Noch keine Bots – lege den ersten an!"}</div>}
        </div>
        {hiddenCount > 0 && (
          <button className="hidden-toggle" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "← Zurück zu den Bots" : `👁️ Versteckte Bots (${hiddenCount})`}
          </button>
        )}
        <div className="sidebar-foot">
          {activeBot && <button className="link-btn" onClick={() => openEditBot(activeBot)}>⚙️ Aktiven Bot bearbeiten</button>}
        </div>
      </aside>

      {activeBot ? <ChatPane key={activeBot.id} bot={activeBot} bots={bots} msgs={messages[activeBot.id] || []} draft={drafts[activeBot.id]} send={send} stop={stop} patchBot={patchBot} harnesses={harnesses} openEditBot={openEditBot} /> : (
        <div className="chat-empty">
          <Avatar color="#e8702e" shape="waddle" size={90} />
          <h2>Willkommen bei SuperBot</h2>
          <p>Lege deinen ersten Bot an, um loszulegen.</p>
          <button className="btn primary" onClick={openNewBot}>➕ Neuer Bot</button>
        </div>
      )}
    </div>
  );
}

function ChatPane({ bot, bots, msgs, draft, send, stop, patchBot, harnesses, openEditBot }) {
  const [text, setText] = useState("");
  const boxRef = useRef(null);
  const taRef = useRef(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = boxRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [msgs.length, draft, bot.working, bot.status]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const doSend = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    atBottomRef.current = true;
    send(bot.id, t);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
  };

  // Modell/Effort-Picker: Modellliste des Bots-Harness laden
  const [models, setModels] = useState([]);
  useEffect(() => {
    let alive = true;
    api_models(bot.harness).then((l) => { if (alive) setModels(l); });
    return () => { alive = false; };
  }, [bot.harness]);
  const current = models.find((m) => m.id === bot.model);
  const efforts = current?.efforts || [];

  return (
    <main className="chat-pane">
      <div className="chat-head">
        <Avatar color={bot.color} shape={bot.shape} size={30} />
        <span className="chat-name">{bot.name}</span>
        <span className="harness-tag">{bot.harness}</span>
        {bot.primary && <span className="primary-tag">★ Primär</span>}
        <div className="chat-head-actions">
          <button className="icon-btn" onClick={openEditBot.bind(null, bot)} title="Bot bearbeiten">⚙️</button>
        </div>
      </div>

      <div className="messages" ref={boxRef} onScroll={onScroll}>
        {msgs.map((m) => renderMessage(bot, bots, m))}
        {bot.working && (
          <>
            {draft && <div className="msg-row bot"><div className="bubble"><div dangerouslySetInnerHTML={{ __html: md(draft) }} /></div></div>}
            <div className="msg-row bot">
              <div className="bubble typing">
                <span /><span /><span />
                <em className="status">{bot.status || "Working"}</em>
                <button className="stop-btn" onClick={() => stop(bot.id)}>■ Stop</button>
              </div>
            </div>
          </>
        )}
        {!msgs.length && !bot.working && (
          <div className="empty-chat">
            <Avatar color={bot.color} shape={bot.shape} size={64} />
            <p>Sag Hi zu <strong>{bot.name}</strong>!</p>
          </div>
        )}
      </div>

      <div className="composer">
        <div className="pickers">
          <select
            value={bot.model || ""}
            onChange={(e) => patchBot(bot.id, { model: e.target.value || null })}
            disabled={!models.length}
            title="Modell dieses Bots"
          >
            <option value="">Standard-Modell</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            {bot.model && !models.some((m) => m.id === bot.model) && <option value={bot.model}>{bot.model}</option>}
          </select>
          <select
            value={bot.effort || ""}
            onChange={(e) => patchBot(bot.id, { effort: e.target.value || null })}
            disabled={!efforts.length}
            title="Denkaufwand"
            hidden={!efforts.length}
          >
            <option value="">Standard-Aufwand</option>
            {efforts.map((ef) => <option key={ef} value={ef}>{ef}</option>)}
          </select>
        </div>
        <div className="composer-row">
          <textarea
            ref={taRef}
            rows={1}
            placeholder={`Nachricht an ${bot.name} …`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const el = taRef.current;
              if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }
            }}
            onKeyDown={onKeyDown}
          />
          <button className="btn primary send" onClick={doSend} disabled={!text.trim()}>➤</button>
        </div>
        <div className="composer-hint">Enter = senden · Shift+Enter = neue Zeile</div>
      </div>
    </main>
  );
}

async function api_models(h) {
  try {
    return (await api("GET", `/api/harnesses/${h}/models`)) || [];
  } catch { return []; }
}

// Eine Chat-Nachricht (Port der Upstream-Renderlogik)
function renderMessage(bot, bots, m) {
  if (m.role === "routine") {
    return <div key={m.id} className="msg-row routine"><div className="routine-pill">⏰ Routine · {esc(m.text)}</div></div>;
  }
  if (m.role === "peer" || m.role === "reply") {
    const who = bots.find((b) => b.id === m.fromBot)?.name || "anderer Bot";
    const label = m.role === "peer" ? `Von ${who}` : `Antwort von ${who}`;
    return (
      <div key={m.id} className="msg-row peer">
        <div className="bubble"><div className="from">{label}</div><div dangerouslySetInnerHTML={{ __html: md(m.text) }} /></div>
      </div>
    );
  }
  let out = [];
  if (m.role === "user") {
    out.push(
      <div key={m.id} className="msg-row user">
        <div className="bubble"><span dangerouslySetInnerHTML={{ __html: esc(m.text).replace(/\n/g, "<br>") }} /></div>
      </div>
    );
  } else if (m.text) {
    out.push(
      <div key={`t-${m.id}`} className="msg-row bot">
        <div className={`bubble ${m.error ? "error" : ""}`}>
          <div dangerouslySetInnerHTML={{ __html: md(m.text) }} />
          <button className="copy-btn" title="Kopieren" onClick={() => copyText(m.text)}>⧉</button>
        </div>
      </div>
    );
  }
  if (m.question) {
    const q = m.question;
    out.push(
      <div key={`q-${m.id}`} className="msg-row bot">
        <div className={`bubble question ${q.picked != null ? "answered" : ""}`}>
          <h4>{q.title}</h4>
          {q.options.map((o, k) => (
            <button
              key={k}
              className={`option ${q.picked === k ? "picked" : ""}`}
              disabled={q.picked != null}
              onClick={() => send(bot.id, q.options[k], { messageId: m.id, option: k })}
            >
              <span className="key">{"ABCDEF"[k]}</span>{o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return out;
}
