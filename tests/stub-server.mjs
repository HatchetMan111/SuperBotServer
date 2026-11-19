// Stub-Server für den UI-Smoke-Test: serviert webui/dist + Mock-API im botd-Format.
// NUR für lokale UI-Checks – nicht Teil der Installation.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = new URL("../webui/dist/", import.meta.url).pathname;
const PORT = 8199;

const bots = [
  { id: "b1", name: "SuperBot", color: "#e8702e", shape: "waddle", harness: "claude", model: null, effort: null, primary: true, hidden: false, unread: true, preview: "Hallo! Ich bin dein Chef-Bot.", working: false },
  { id: "b2", name: "Entwickler", color: "#3b82f6", shape: "gem", harness: "claude", model: "claude-sonnet-5-5", effort: "high", primary: false, hidden: false, unread: false, preview: "Refactoring abgeschlossen.", working: true, status: "Running: npm test" },
  { id: "b3", name: "Recherche", color: "#4cc06a", shape: "cloud", harness: "claude", model: null, effort: null, primary: false, hidden: true, unread: false, preview: "", working: false },
];
const messages = {
  b1: [
    { id: 1, botId: "b1", role: "user", text: "Hallo, wer bist du?", error: false, fromBot: null, at: 1763550000 },
    { id: 2, botId: "b1", role: "bot", text: "Ich bin **SuperBot**, dein Chef-Bot. Ich verteile Arbeit an Sub-Bots.\n\n- Chat mit mir\n- Ich delegiere an Bots wie `Entwickler`", error: false, fromBot: null, at: 1763550060 },
    { id: 3, botId: "b1", role: "bot", text: "Womit soll ich anfangen?", error: false, fromBot: null, at: 1763550070, question: { title: "Was möchtest du tun?", options: ["Code schreiben", "Recherche starten", "Nur testet"], picked: null } },
    { id: 4, botId: "b1", role: "routine", text: "Morgen-Übersicht", error: false, fromBot: null, at: 1763550100 },
  ],
  b2: [
    { id: 5, botId: "b2", role: "user", text: "Schreibe Tests für api.js", error: false, fromBot: null, at: 1763550200 },
    { id: 6, botId: "b2", role: "bot", text: "Erledigt:\n```js\ntest('esc', () => {});\n```", error: false, fromBot: null, at: 1763550260 },
  ],
  b3: [],
};
const routines = {
  b1: [{ id: "r1", bot_id: "b1", name: "Morgen-Übersicht", cron: "30 7 * * *", instruction: "To-dos des Tages zusammenstellen", enabled: true, last_run_at: 1763548200, created_at: 1763500000 }],
  b2: [], b3: [],
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const j = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (p === "/healthz") return j(200, { ok: true });
  if (p === "/api/state") return j(200, { me: { name: "Phil" }, harnesses: ["claude"], defaultHarness: "claude", bots });
  if (p === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "bot", bot: bots[1] })}\n\n`);
    const iv = setInterval(() => {
      bots[1].draft = "...arbeite";
      res.write(`data: ${JSON.stringify({ type: "draft", botId: "b2", text: "Zwischenstand: alle Tests laufen" })}\n\n`);
    }, 3000);
    req.on("close", () => clearInterval(iv));
    return;
  }
  let m;
  if ((m = p.match(/^\/api\/harnesses\/([^/]+)\/models$/))) {
    return j(200, [
      { id: "claude-fable-5-2", label: "Fable 5.2", efforts: ["low", "medium", "high", "max"] },
      { id: "claude-opus-5-5", label: "Opus 5.5", efforts: ["low", "medium", "high", "max"] },
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "claude-haiku-5-5", label: "Haiku 5.5", efforts: ["low", "medium"] },
    ]);
  }
  if ((m = p.match(/^\/api\/bots\/([^/]+)\/messages$/))) {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => j(202, { id: Date.now(), botId: m[1], role: "user", text: JSON.parse(body || "{}").text, error: false, fromBot: null, at: Date.now() / 1000 }));
      return;
    }
    return j(200, messages[m[1]] || []);
  }
  if ((m = p.match(/^\/api\/bots\/([^/]+)\/routines$/))) return j(200, routines[m[1]] || []);
  if (p.startsWith("/api/")) return j(404, { error: "stub: nicht implementiert" });

  const file = p === "/" ? "index.html" : p.slice(1);
  try {
    const data = await readFile(join(DIST, file));
    const mime = extname(file) === ".html" ? "text/html; charset=utf-8" : extname(file) === ".js" ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8";
    res.writeHead(200, { "content-type": mime });
    if (file === "index.html") {
      // Smoke-Test: Fehler-Collector injizieren (überlebt Reloads)
      const hook = `<script>window.__errs=window.__errs||[];window.addEventListener('error',function(e){window.__errs.push(String(e.message)+' @ '+String(e.filename||'')+':'+String(e.lineno))});window.addEventListener('unhandledrejection',function(e){window.__errs.push('rejection: '+String(e.reason&&e.reason.message||e.reason))});</script>`;
      res.end(String(data).replace("<head>", "<head>" + hook));
    } else res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(PORT, "127.0.0.1", () => console.log(`stub on http://127.0.0.1:${PORT}`));
