import React, { useEffect, useState } from "react";
import { api, timeStr } from "../api.js";
import { Avatar } from "../avatar.jsx";

// Routinen: Cron-gesteuerte Aufgaben pro Bot. Aggregiert über alle Bots.
export default function RoutinesView({ bots, showToast }) {
  const [routines, setRoutines] = useState(null); // null = lädt
  const [editor, setEditor] = useState(null); // {r?} für neu/bearbeiten

  const loadAll = async () => {
    const results = await Promise.all(
      bots.map(async (b) => {
        try {
          const list = await api("GET", `/api/bots/${b.id}/routines`);
          return list.map((r) => ({ ...r, _bot: b }));
        } catch { return []; }
      })
    );
    setRoutines(results.flat());
  };

  useEffect(() => { setRoutines(null); loadAll().catch((e) => showToast(e.message)); }, [bots.length]); // eslint-disable-line

  const toggle = async (r) => {
    try {
      const updated = await api("PATCH", `/api/routines/${r.id}`, { enabled: !r.enabled });
      setRoutines((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...updated, _bot: r._bot } : x)));
    } catch (err) { showToast(err.message); }
  };

  const remove = async (r) => {
    if (!confirm(`Routine „${r.name}" wirklich löschen?`)) return;
    try {
      await api("DELETE", `/api/routines/${r.id}`);
      setRoutines((prev) => prev.filter((x) => x.id !== r.id));
    } catch (err) { showToast(err.message); }
  };

  const saveRoutine = async (data, id) => {
    try {
      if (id) {
        const updated = await api("PATCH", `/api/routines/${id}`, data);
        setRoutines((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated, _bot: x._bot } : x)));
      } else {
        const created = await api("POST", `/api/bots/${data._botId}/routines`, { name: data.name, cron: data.cron, instruction: data.instruction });
        const bot = bots.find((b) => b.id === data._botId);
        setRoutines((prev) => [...(prev || []), { ...created, _bot: bot }]);
      }
      setEditor(null);
      showToast(id ? "Routine gespeichert." : "Routine erstellt.", "ok");
    } catch (err) { showToast(err.message); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>⏰ Routinen</h2>
          <p className="sub">Cron-gesteuerte Aufgaben – Bots können selbst welche anlegen (<code>botctl routine add</code>).</p>
        </div>
        <button className="btn primary" onClick={() => setEditor({})} disabled={!bots.length}>➕ Neue Routine</button>
      </div>

      {routines === null ? (
        <div className="empty-page"><p>Lade Routinen …</p></div>
      ) : !routines.length ? (
        <div className="empty-page">
          <span style={{ fontSize: 56 }}>⏰</span>
          <h3>Noch keine Routinen</h3>
          <p>Lege eine Routine an, z. B. „Jeden Morgen 07:30 die To-do-Liste zusammenstellen".</p>
          {bots.length ? <button className="btn primary" onClick={() => setEditor({})}>➕ Erste Routine</button> : <p>Erst braucht es einen Bot.</p>}
        </div>
      ) : (
        <div className="routine-list">
          {routines.map((r) => (
            <div key={r.id} className={`routine-item ${r.enabled ? "" : "paused"}`}>
              <div className="r-bot">
                <Avatar color={r._bot?.color} shape={r._bot?.shape} size={34} />
                <span>{r._bot?.name}</span>
              </div>
              <div className="r-main">
                <strong>{r.name}</strong>
                <code className="cron">{r.cron}</code>
                <p className="r-instr">{r.instruction}</p>
                <small>Letzter Lauf: {r.last_run_at ? timeStr(r.last_run_at) : "noch nie"}</small>
              </div>
              <div className="r-actions">
                <button className={`toggle ${r.enabled ? "on" : ""}`} onClick={() => toggle(r)} title={r.enabled ? "Pause" : "Aktivieren"}>
                  {r.enabled ? "⏸ Pause" : "▶ Aktivieren"}
                </button>
                <button className="icon-btn" onClick={() => setEditor({ r })} title="Bearbeiten">✏️</button>
                <button className="icon-btn" onClick={() => remove(r)} title="Löschen">🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editor && (
        <RoutineDialog
          r={editor.r}
          bots={bots}
          onClose={() => setEditor(null)}
          onSave={saveRoutine}
        />
      )}
    </div>
  );
}

function RoutineDialog({ r, bots, onClose, onSave }) {
  const [name, setName] = useState(r?.name || "");
  const [cron, setCron] = useState(r?.cron || "0 9 * * *");
  const [instruction, setInstruction] = useState(r?.instruction || "");
  const [botId, setBotId] = useState(r?._bot?.id || bots.find((b) => b.primary)?.id || bots[0]?.id || "");

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          if (r) onSave({ name: name.trim(), cron: cron.trim(), instruction: instruction.trim() }, r.id);
          else onSave({ _botId: botId, name: name.trim(), cron: cron.trim(), instruction: instruction.trim() });
        }}
      >
        <div className="modal-head"><h3>{r ? "Routine bearbeiten" : "Neue Routine"}</h3>
          <button type="button" className="icon-btn modal-close" onClick={onClose}>✕</button>
        </div>
        <label className="field">
          <span>Bot</span>
          <select value={botId} onChange={(e) => setBotId(e.target.value)} disabled={!!r}>
            {bots.map((b) => <option key={b.id} value={b.id}>{b.name}{b.primary ? " (Primär)" : ""}</option>)}
          </select>
        </label>
        <label className="field"><span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Morgen-Übersicht" />
        </label>
        <label className="field"><span>Cron (5 Felder, Server-Zeitzone)</span>
          <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="30 7 * * *" />
          <small>
            Beispiele: <code>30 7 * * *</code> täglich 07:30 · <code>0 9 * * 1-5</code> werktags 09:00 · <code>*/15 * * * *</code> alle 15 Min
          </small>
        </label>
        <label className="field"><span>Aufgabe (Anweisung an den Bot)</span>
          <textarea rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Was soll der Bot bei jedem Lauf tun?" />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn primary" disabled={!name.trim() || !cron.trim() || !instruction.trim()}>
            💾 {r ? "Speichern" : "Erstellen"}
          </button>
        </div>
      </form>
    </div>
  );
}
