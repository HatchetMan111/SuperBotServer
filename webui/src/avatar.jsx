// Bot-Avatare: die 12 "Squish"-Roboter aus dem Upstream (MIT, davidondrej/superbot web/app.js)
// als React-Komponente portiert – eine Körperfarbe + dunkles Visier mit zwei Augen.

const DARK = "#141414";

const rect = (x, y, w, h, rx, f) => ({ t: "rect", x, y, w, h, rx, f });
const circ = (cx, cy, r, f) => ({ t: "circ", cx, cy, r, f });
const ell = (cx, cy, rx, ry, f, rot = 0) => ({ t: "ell", cx, cy, rx, ry, f, rot });
const pth = (d, f, round = 0) => ({ t: "path", d, f, round });
const nub = (x, y, h, f) => [rect(x - 1.3, y - h, 2.6, h + 2, 1.3, f), circ(x, y - h, 3, f)];
const visor = (k) => (x, y, w, h) => {
  const s = h / 12, g = w * 0.22;
  const eye = (ex) => rect(ex - 1.5 * s, y - 2.9 * s, 3 * s, 5.8 * s, 1.5 * s, k);
  return [rect(x - w / 2, y - h / 2, w, h, h / 2, DARK), eye(x - g), eye(x + g)];
};
const none = () => [];
const tilt = (deg, shapes) => shapes.map((s) => ({ ...s, rotate: deg }));

const GEAR = Array.from({ length: 97 }, (_, i) => {
  const a = (i / 96) * Math.PI * 2, r = 18.5 + 2.6 * Math.cos(8 * a);
  return `${i ? "L" : "M"}${(24 + r * Math.sin(a)).toFixed(2)} ${(24 - r * Math.cos(a)).toFixed(2)}`;
}).join("") + "Z";

// Reihenfolge = Reihenfolge im "Neuer Bot"-Dialog.
export const SHAPES = {
  waddle: (k, f) => [...nub(24, 9, 3, k), ell(16.5, 41, 5.5, 3, k), ell(31.5, 41, 5.5, 3, k), circ(24, 24, 16.5, k), ...f(24, 24, 23, 12)],
  drop: (k, f) => [pth("M24 6c9 0 15 12 17 22 2 10-6 15-17 15S5 38 7 28C9 18 15 6 24 6z", k), ...f(24, 27, 22, 12)],
  cloud: (k, f) => [...nub(26, 12, 6, k), circ(15, 27, 10, k), circ(26, 22, 12, k), circ(35, 29, 9, k), rect(5, 27, 38, 15, 7.5, k), ...f(24, 30, 22, 11)],
  bean: (k, f) => [...nub(20, 9, 5, k), ell(24, 26, 20, 14, k, -12), ...f(24, 26, 23, 12)],
  onigiri: (k, f) => [pth("M24 9L41 38H7Z", k, 12), ...f(24, 30, 20, 11)],
  peanut: (k, f) => [...nub(24, 11, 4, k), circ(15, 26, 12, k), circ(33, 26, 12, k), rect(15, 17, 18, 18, 0, k), ...f(24, 25, 26, 12)],
  pebble: (k, f) => [pth("M9 16C13 8 30 4 38 11s7 22-3 29-26 5-29-7c-1-6 1-13 3-17z", k), ...f(25, 25, 23, 12)],
  square: (k, f) => tilt(12, [...nub(24, 9, 4, k), rect(8, 9, 32, 32, 12, k), ...f(24, 25, 22, 12)]),
  jelly: (k, f) => tilt(18, [ell(24, 25, 13.5, 19, k), ...f(24, 22, 19, 11)]),
  gem: (k, f) => [pth("M24 7L40.5 18.5L34.5 40H13.5L7.5 18.5Z", k, 9), ...f(24, 26, 22, 12)],
  gear: (k, f) => [pth(GEAR, k), ...f(24, 24, 24, 12)],
  heart: (k, f) => [pth("M24 42L7 25A9.5 9.5 0 0 1 24 13A9.5 9.5 0 0 1 41 25Z", k, 6), ...f(24, 25, 22, 11)],
};
// Alte Shape-Namen (vor den Robotern), damit bestehende Bots ähnlich aussehen.
const OLD_SHAPES = { round: "waddle", star: "gear", flower: "gear", scallop: "gear", splat: "gear", blob: "pebble", egg: "drop", wide: "bean", triangle: "onigiri", pentagon: "gem", hexagon: "gem" };

export const COLORS = ["#f5f5f5", "#9a6b3f", "#e5484d", "#e8702e", "#e9a23b", "#4cc06a", "#4fb5a5", "#3b82f6", "#8b5cf6", "#e64a9c", "#7a7a7a"];

export function shapeOf(shape) {
  return SHAPES[shape] ?? SHAPES[OLD_SHAPES[shape]] ?? SHAPES.waddle;
}

function part(s, i) {
  const key = `${s.t}-${i}`;
  switch (s.t) {
    case "rect": return <rect key={key} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} fill={s.f} />;
    case "circ": return <circle key={key} cx={s.cx} cy={s.cy} r={s.r} fill={s.f} />;
    case "ell": return <ellipse key={key} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.f} transform={`rotate(${s.rot} ${s.cx} ${s.cy})`} />;
    case "path": return <path key={key} d={s.d} fill={s.f} stroke={s.round ? s.f : undefined} strokeWidth={s.round || undefined} strokeLinejoin={s.round ? "round" : undefined} />;
    default: return null;
  }
}

// ring: Auswahl-Rahmen, der der Form folgt (für den Bot-Editor).
export function Avatar({ color, shape = "waddle", size = 48, ring = false, className = "" }) {
  const draw = shapeOf(shape);
  const scale = (k, shapes) => shapes.map((s) => ({ ...s, groupScale: k }));
  const body = draw(color, visor(color));
  const ringParts = ring ? [...scale(1.1, draw("#4a4a4a", none)), ...scale(1.02, draw("#1f1f1f", none)), ...scale(0.86, body)] : body;
  return (
    <svg className={`avatar ${className}`} viewBox="0 0 48 48" width={size} height={size} style={{ width: size, height: size, overflow: "visible", flexShrink: 0 }}>
      {ringParts.map((s, i) => {
        if (s.groupScale || s.rotate) {
          const t = [];
          if (s.rotate) t.push(`rotate(${s.rotate} 24 24)`);
          if (s.groupScale) t.push(`translate(24 24) scale(${s.groupScale}) translate(-24 -24)`);
          return <g key={`g-${i}`} transform={t.join(" ")}>{part(s, i)}</g>;
        }
        return part(s, i);
      })}
    </svg>
  );
}
