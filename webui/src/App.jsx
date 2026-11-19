import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Avatar, COLORS, SHAPES } from "./avatar.jsx";
import ChatView from "./views/ChatView.jsx";
import BotsView from "./views/BotsView.jsx";
import RoutinesView from "./views/RoutinesView.jsx";
import SetupView from "./views/SetupView.jsx";

const TABS = [
  { id: "chat", label: "💬 Chat" },
  { id: "bots", label: "🤖 Bots" },
  { id: "routines", label: "⏰ Routinen" },
  { id: "setup", label: "🛠️ Einrichtung" },
];

export default function App() {
  const [me, setMe] = useState({ name: "" });
  const [harnesses, setHarnesses] = useState([]);
  const [defaultHarness, setDefaultHarness] = useState("claude");
  const [bots, setBots] = useState([]);
  const [messages, setMessages] = useState({}); // botId -> Message[]
  const [drafts, setDrafts] = useState({}); // botId -> Streaming-Text
  const [activeId, setActiveId] = useState(localStorage.getItem("activeBot") || "");
  const [view, setView] = useState("chat");
  const [toast, setToast] = useState(null);
  const [dialog, setDialog] = useState(null); // {mode:'create'} | {mode:'edit', bot}
  const toastTimer = useRef(null);
  const stateRef = useRef({});
  stateRef.current = { bots, activeId, messages };

  const showToast = useCallback((msg, kind = "error") => {
    clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const upsertBot = useCallback((b) => {
    setBots((prev) => {
      const i = prev.findIndex((x) => x.id === b.id);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], ...b }; return next; }
      return [...prev, b];
    });
  }, []);

  const markRead = useCallback(async (id) => {
    try {
      await api("POST", `/api/bots/${id}/read`);
      setBots((prev) => prev.map((b) => (b.id === id ? { ...b, unread: false } : b)));
    } catch { /* egal */ }
  }, []);

  const open = useCallback(async (id, msgs) => {
    const cur = stateRef.current;
    if (!cur.bots.some((b) => b.id === id)) id = cur.bots.find((b) => b.primary)?.id || "";
    if (!id) return;
    setActiveId(id);
    localStorage.setItem("activeBot", id);
    try {
      if (!cur.messages[id]) {
        const list = await api("GET", `/api/bots/${id}/messages`);
        setMessages((prev) => ({ ...prev, [id]: list }));
      }
      markRead(id);
    } catch (err) { showToast(err.message); }
  }, [markRead, showToast]);

  // Erst-Load: /api/state
  const load = useCallback(async (refresh) => {
    try {
      const s = await api("GET", "/api/state");
      setMe(s.me || { name: "Du" });
      setHarnesses(s.harnesses || []);
      setDefaultHarness(s.defaultHarness || "claude");
      setBots(s.bots || []);
      stateRef.current = { ...stateRef.current, bots: s.bots || [] };
      if (refresh) {
        const ids = Object.keys(stateRef.current.messages);
        const loaded = await Promise.all(ids.map((id) => api("GET", `/api/bots/${id}/messages`).catch(() => null)));
        setMessages((prev) => {
          const next = { ...prev };
          ids.forEach((id, i) => { if (loaded[i]) next[id] = loaded[i]; });
          return next;
        });
      }
      // Aktiven Bot öffnen (oder den Primären)
      let id = localStorage.getItem("activeBot") || "";
      if (!(s.bots || []).some((b) => b.id === id)) id = (s.bots || []).find((b) => b.primary)?.id || (s.bots || [])[0]?.id || "";
      if (id) {
        setActiveId(id);
        if (!stateRef.current.messages[id]) {
          const list = await api("GET", `/api/bots/${id}/messages`).catch(() => []);
          setMessages((prev) => ({ ...prev, [id]: list }));
        }
        markRead(id);
      }
    } catch (err) {
      if (err.message?.includes("401")) showToast("Login nötig – bitte Zugangsdaten eingeben.", "info");
      else showToast(`Server nicht erreichbar: ${err.message}`);
    }
  }, [markRead, showToast]);

  useEffect(() => { load(false); }, [load]);

  // SSE: Live-Updates (message, draft, status, bot, botDeleted, resync)
  useEffect(() => {
    let openedOnce = false;
    const es = new EventSource("/api/events");
    es.onmessage = (ev) => {
      let e; try { e = JSON.parse(ev.data); } catch { return; }
      if (e.type === "resync") return void load(true);
      if (e.type === "message") {
        const msg = e.message;
        setMessages((prev) => {
          const list = prev[msg.botId];
          if (list && !list.some((m) => m.id === msg.id)) return { ...prev, [msg.botId]: [...list, msg] };
          return prev;
        });
        if (msg.role === "bot") setDrafts((prev) => { const n = { ...prev }; delete n[msg.botId]; return n; });
        if (e.bot) upsertBot(e.bot);
        if (msg.botId === stateRef.current.activeId) markRead(msg.botId);
      } else if (e.type === "bot") {
        upsertBot(e.bot);
      } else if (e.type === "botDeleted") {
        setBots((prev) => prev.filter((b) => b.id !== e.botId));
        if (stateRef.current.activeId === e.botId) {
          const p = stateRef.current.bots.find((b) => b.primary && b.id !== e.botId);
          if (p) open(p.id);
        }
      } else if (e.type === "draft") {
        setDrafts((prev) => ({ ...prev, [e.botId]: e.text }));
      } else if (e.type === "status") {
        setBots((prev) => prev.map((b) => (b.id === e.botId ? { ...b, working: e.working, status: e.status } : b)));
        if (!e.working) setDrafts((prev) => { const n = { ...prev }; delete n[e.botId]; return n; });
      }
    };
    es.onopen = () => { if (openedOnce) load(true); openedOnce = true; };
    es.onerror = () => { /* EventSource verbindet automatisch neu */ };
    return () => es.close();
  }, [load, upsertBot, markRead, open]);

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("superbot-theme", next);
  };

  const primaryBot = bots.find((b) => b.primary);
  const activeBot = bots.find((b) => b.id === activeId) || primaryBot;

  const send = useCallback(async (botId, text, answer) => {
    try {
      const msg = await api("POST", `/api/bots/${botId}/messages`, { text, ...(answer ? { answer } : {}) });
      setMessages((prev) => {
        const list = prev[botId];
        if (list && !list.some((m) => m.id === msg.id)) return { ...prev, [botId]: [...list, msg] };
        return prev;
      });
    } catch (err) { showToast(err.message); }
  }, [showToast]);

  const stop = useCallback(async (botId) => {
    try { await api("POST", `/api/bots/${botId}/stop`); } catch (err) { showToast(err.message); }
  }, [showToast]);

  const saveBot = useCallback(async (data, id) => {
    try {
      const saved = id
        ? await api("PATCH", `/api/bots/${id}`, data)
        : await api("POST", "/api/bots", data);
      upsertBot(saved);
      setDialog(null);
      showToast(id ? `Bot „${saved.name}" gespeichert.` : `Bot „${saved.name}" erstellt.`, "ok");
      return saved;
    } catch (err) { showToast(err.message); return null; }
  }, [showToast, upsertBot]);

  const deleteBot = useCallback(async (id) => {
    try {
      await api("DELETE", `/api/bots/${id}`);
      setBots((prev) => prev.filter((b) => b.id !== id));
      setDialog(null);
      if (stateRef.current.activeId === id) {
        const p = stateRef.current.bots.find((b) => b.primary && b.id !== id);
        if (p) open(p.id);
      }
      showToast("Bot gelöscht.", "ok");
    } catch (err) { showToast(err.message); }
  }, [open, showToast]);

  const patchBotQuiet = useCallback(async (id, patch) => {
    try { upsertBot(await api("PATCH", `/api/bots/${id}`, patch)); } catch (err) { showToast(err.message); }
  }, [showToast, upsertBot]);

  const viewProps = {
    me, harnesses, defaultHarness, bots, messages, drafts, activeBot, activeId,
    open, send, stop, patchBot: patchBotQuiet, showToast,
    openNewBot: () => setDialog({ mode: "create" }),
    openEditBot: (bot) => setDialog({ mode: "edit", bot }),
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView("chat")} title="Zum Chat">
          <Avatar color="#e8702e" shape="waddle" size={34} />
          <span>SuperBot</span>
        </button>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${view === t.id ? "active" : ""}`} onClick={() => setView(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="top-right">
          <span className="me-name" title="Angemeldet als">{me.name || ""}</span>
          <button className="icon-btn" onClick={toggleTheme} title="Hell/Dunkel umschalten">
            {document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      {view === "chat" && <ChatView {...viewProps} />}
      {view === "bots" && <BotsView {...viewProps} />}
      {view === "routines" && <RoutinesView {...viewProps} />}
      {view === "setup" && <SetupView {...viewProps} />}

      {dialog && (
        <BotDialog
          mode={dialog.mode}
          bot={dialog.bot}
          harnesses={harnesses}
          defaultHarness={defaultHarness}
          botsCount={bots.length}
          onClose={() => setDialog(null)}
          onSave={saveBot}
          onDelete={deleteBot}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

// Dialog: Neuer Bot / Bot bearbeiten (Name, Harness, Modell, Effort, Farbe, Form)
function BotDialog({ mode, bot, harnesses, defaultHarness, botsCount, onClose, onSave, onDelete }) {
  const [name, setName] = useState(bot?.name || "");
  const [harness, setHarness] = useState(bot?.harness || defaultHarness || "claude");
  const [model, setModel] = useState(bot?.model || "");
  const [effort, setEffort] = useState(bot?.effort || "");
  const [color, setColor] = useState(bot?.color || COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [shape, setShape] = useState(bot?.shape || Object.keys(SHAPES)[Math.floor(Math.random() * Object.keys(SHAPES).length)]);
  const [hidden, setHidden] = useState(!!bot?.hidden);
  const [models, setModels] = useState(null); // null = lädt
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isPrimary = !!bot?.primary;

  useEffect(() => {
    let alive = true;
    setModels(null);
    api("GET", `/api/harnesses/${harness}/models`).then((l) => { if (alive) setModels(l || []); }).catch(() => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [harness]);

  const current = models?.find((m) => m.id === model);
  const efforts = current?.efforts || [];

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const data = { name: name.trim(), color, shape, hidden };
    if (mode === "create") {
      data.harness = harness;
      if (model) data.model = model;
      if (effort) data.effort = effort;
      await onSave(data);
    } else {
      // Harness-Wechsel: Modell/Effort verlieren ihre Gültigkeit → zurücksetzen
      const changedHarness = harness !== bot.harness;
      data.harness = harness;
      data.model = changedHarness ? null : (model || null);
      data.effort = changedHarness ? null : (effort || null);
      await onSave(data, bot.id);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <Avatar color={color} shape={shape} size={56} />
          <h3>{mode === "create" ? "Neuen Bot erstellen" : `Bot „${bot.name}" bearbeiten`}</h3>
          <button type="button" className="icon-btn modal-close" onClick={onClose} title="Schließen">✕</button>
        </div>

        <label className="field">
          <span>Name <small>{isPrimary ? "(Primär-Bot)" : ""}</small></span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={isPrimary ? bot.name : "z. B. Entwickler, Recherche, Postfach"} />
        </label>

        <label className="field">
          <span>Agent (Harness)</span>
          <select value={harness} onChange={(e) => { setHarness(e.target.value); setModel(""); setEffort(""); }}>
            {(harnesses.length ? harnesses : [harness]).map((h) => (
              <option key={h} value={h}>{h === "claude" ? "Claude Code" : h === "codex" ? "Codex" : h === "pi" ? "Pi Agent" : h}</option>
            ))}
          </select>
          {!harnesses.length && <small className="warn">Kein Agent-CLI installiert – siehe 🛠️ Einrichtung</small>}
          {!harnesses.includes(harness) && harnesses.length > 0 && <small className="warn">„{harness}" ist nicht installiert – siehe 🛠️ Einrichtung</small>}
        </label>

        <div className="field-row">
          <label className="field">
            <span>Modell</span>
            <select value={model} onChange={(e) => { setModel(e.target.value); setEffort(""); }} disabled={!models}>
              <option value="">Standard-Modell</option>
              {(models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              {model && models && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
            </select>
            {models && !models.length && <small>Keine Modellliste (CLI nicht installiert?)</small>}
          </label>
          <label className="field">
            <span>Denkaufwand</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={!efforts.length}>
              <option value="">Standard</option>
              {efforts.map((ef) => <option key={ef} value={ef}>{ef}</option>)}
            </select>
          </label>
        </div>

        <div className="field">
          <span>Farbe</span>
          <div className="swatches">
            {COLORS.map((c) => (
              <button type="button" key={c} className={`swatch ${c === color ? "sel" : ""}`} style={{ background: c }} onClick={() => setColor(c)} title={c} />
            ))}
          </div>
        </div>

        <div className="field">
          <span>Form</span>
          <div className="shapes">
            {Object.keys(SHAPES).map((s) => (
              <button type="button" key={s} className={`shape ${s === shape ? "sel" : ""}`} onClick={() => setShape(s)} title={s}>
                <Avatar color={c_safe(color)} shape={s} size={38} ring={s === shape} />
              </button>
            ))}
          </div>
        </div>

        {mode === "edit" && (
          <label className="field check">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            <span>Versteckt (Bot bleibt aktiv, verschwindet aus der Liste)</span>
          </label>
        )}

        <div className="modal-actions">
          {mode === "edit" && !isPrimary && (
            confirmDelete ? (
              <button type="button" className="btn danger" onClick={() => onDelete(bot.id)}>Wirklich löschen? Klick!</button>
            ) : (
              <button type="button" className="btn ghost danger-text" onClick={() => setConfirmDelete(true)}>🗑️ Löschen</button>
            )
          )}
          <button type="button" className="btn ghost" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>
            {mode === "create" ? "➕ Erstellen" : "💾 Speichern"}
          </button>
        </div>
      </form>
    </div>
  );
}

function c_safe(c) { return c || "#e8702e"; }
