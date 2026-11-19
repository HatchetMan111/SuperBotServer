// Dünner API-Client: alle Daten liegen auf dem Server (botd), Live-Updates via /api/events (SSE).
// Auth: HTTP Basic über den Browser-Login (botd sendet WWW-Authenticate).

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Einfaches Markdown → HTML (Port der Upstream-Logik): zuerst escapen, dann
// Code-Blöcke auslagern, Inline-Formate, Listen, Überschriften, Links.
export function md(src) {
  const blocks = [];
  let s = esc(src ?? "");
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code${lang ? ` data-lang="${lang}"` : ""}>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = (t) => t
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(^|[^*])\*\*([^*\n]+)\*\*/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return s.split(/\n{2,}/).map((para) => {
    if (/^\u0000\d+\u0000$/.test(para.trim())) return para.trim();
    const lines = para.split("\n");
    if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
    if (lines.every((l) => /^\s*\d+[.)] /.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)] /, ""))}</li>`).join("")}</ol>`;
    const h = para.match(/^#{1,4} (.*)$/);
    if (h && lines.length === 1) return `<p><strong>${inline(h[1])}</strong></p>`;
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

export function timeStr(at) {
  if (!at) return "";
  const d = new Date(at < 1e12 ? at * 1000 : at);
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Clipboard mit Fallback (http:// im LAN hat kein navigator.clipboard)
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* Fallback unten */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); return true; } catch { return false; }
  finally { ta.remove(); }
}
