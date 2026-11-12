/* Builds the small animated road map shown beside the About section of README.md,
   in a light and a dark version.
   Run from the repository root:  node scripts/build-svgs.js
   GitHub shows SVGs as images: CSS and SMIL animation work, scripts and hover do not,
   and web fonts don't load, so text uses system fonts. */
"use strict";
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "assets");

/* Navy + Amber, matching the portfolio site. */
const THEMES = {
  light: { panel: "#0A1828", panelLine: "#1F3349", panelInk: "#E8EEF4", panelMuted: "#9AAABB" },
  dark: { panel: "#112236", panelLine: "#2A4560", panelInk: "#E8EEF4", panelMuted: "#9AAABB" }
};
const AMBER = "#F5A524";
const MAP = { free: "#3CCB8F", slow: "#F5A524", jam: "#FF6B5B" };
const MONO = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = n => Math.round(n * 10) / 10;
const pct = x => +(x * 100).toFixed(2) + "%";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Traffic through a day: one cycle runs from 05:00 to 23:00           */
/* ------------------------------------------------------------------ */
const DAY_START = 5, DAY_SPAN = 18, STILL_HOUR = 8.25;
const hourAt = t => DAY_START + DAY_SPAN * t;
const bump = (h, mid, width) => Math.exp(-(((h - mid) / width) ** 2));
const demand = h => 0.1 + 0.85 * bump(h, 8.25, 1.2) + 0.95 * bump(h, 17.5, 1.4) + 0.3 * bump(h, 12.75, 1.6);
const colorAt = (h, f) => { const v = demand(h) * f; return v < 0.42 ? MAP.free : v < 0.78 ? MAP.slow : MAP.jam; };

function connected(count, links) {
  const adj = Array.from({ length: count }, () => []);
  links.forEach(l => { adj[l.a].push(l.b); adj[l.b].push(l.a); });
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const v = queue.pop();
    for (const u of adj[v]) if (!seen.has(u)) { seen.add(u); queue.push(u); }
  }
  return seen.size === count;
}

/* A jittered street grid with one arterial row and column, a few links removed and a few diagonals. */
function network({ x, y, w, h, cols, rows, jitter, seed }) {
  const rnd = rng(seed);
  const nodes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({ x: x + (c / (cols - 1)) * w + (rnd() - 0.5) * 2 * jitter, y: y + (r / (rows - 1)) * h + (rnd() - 0.5) * 2 * jitter });
    }
  }
  const id = (r, c) => r * cols + c;
  const artRow = Math.floor(rows / 2), artCol = Math.floor(cols / 2);
  let links = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1) links.push({ a: id(r, c), b: id(r, c + 1), art: r === artRow });
      if (r < rows - 1) links.push({ a: id(r, c), b: id(r + 1, c), art: c === artCol });
    }
  }
  for (const l of [...links]) {
    if (l.art || rnd() > 0.16) continue;
    const trial = links.filter(m => m !== l);
    const deg = n => trial.filter(m => m.a === n || m.b === n).length;
    if (deg(l.a) >= 2 && deg(l.b) >= 2 && connected(nodes.length, trial)) links = trial;
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (rnd() < 0.2) links.push(rnd() < 0.5 ? { a: id(r, c), b: id(r + 1, c + 1) } : { a: id(r, c + 1), b: id(r + 1, c) });
    }
  }
  links.forEach(l => { l.f = l.art ? 1.1 + rnd() * 0.15 : 0.35 + rnd() * 0.6; });
  return { nodes, links };
}

/* Each link gets its own keyframes, so congestion builds and clears road by road. */
function linkLayer(net, T) {
  const N = 36;
  let css = "";
  const svg = net.links.map((l, i) => {
    const stops = [];
    for (let k = 0; k <= N; k++) stops.push([k / N, colorAt(hourAt(k / N), l.f)]);
    const kept = stops.filter((s, j) => j === 0 || j === N || s[1] !== stops[j - 1][1] || s[1] !== stops[j + 1][1]);
    css += `@keyframes k${i}{${kept.map(s => `${pct(s[0])}{stroke:${s[1]}}`).join("")}}.k${i}{animation:k${i} ${T}s linear infinite}`;
    const A = net.nodes[l.a], B = net.nodes[l.b];
    return `<line class="lk k${i}" x1="${r1(A.x)}" y1="${r1(A.y)}" x2="${r1(B.x)}" y2="${r1(B.y)}" stroke="${colorAt(STILL_HOUR, l.f)}"/>`;
  }).join("");
  return { css, svg };
}

/* Cars drive random routes along the links and fade in and out at the ends. */
function carLayer(net, seed, count, speed, radius) {
  const rnd = rng(seed);
  const adj = net.nodes.map(() => []);
  net.links.forEach(l => { adj[l.a].push(l.b); adj[l.b].push(l.a); });
  let out = "";
  for (let i = 0; i < count; i++) {
    let cur = Math.floor(rnd() * net.nodes.length), prev = -1;
    const seq = [cur];
    for (let s = 0; s < 7; s++) {
      const opts = adj[cur].filter(n => n !== prev);
      const pool = opts.length ? opts : adj[cur];
      const next = pool[Math.floor(rnd() * pool.length)];
      prev = cur; cur = next; seq.push(cur);
    }
    const pts = seq.map(n => net.nodes[n]);
    let len = 0;
    for (let j = 1; j < pts.length; j++) len += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y);
    const dur = r1(len / speed), begin = -r1(rnd() * dur);
    const d = "M" + pts.map(p => `${r1(p.x)} ${r1(p.y)}`).join(" L");
    out += `<circle class="car" r="${radius}" opacity="0">` +
      `<animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${d}"/>` +
      `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.94;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
      `</circle>`;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The map panel                                                       */
/* ------------------------------------------------------------------ */
function mapPanel(th) {
  const W = 480, H = 380, T = 16, SLOTS = 12;
  const net = network({ x: 52, y: 100, w: 376, h: 200, cols: 6, rows: 4, jitter: 12, seed: 41 });
  const links = linkLayer(net, T);

  let slotCss = "", slots = "";
  for (let i = 0; i < SLOTS; i++) {
    const h = DAY_START + (DAY_SPAN / SLOTS) * i;
    const label = String(Math.floor(h)).padStart(2, "0") + ":" + (h % 1 ? "30" : "00");
    const rush = demand(h + DAY_SPAN / SLOTS / 2) > 0.75;
    const a = (i / SLOTS) * 100, b = ((i + 1) / SLOTS) * 100, e = 0.01;
    const kf = i === 0
      ? `0%,${(b - e).toFixed(2)}%{opacity:1}${b.toFixed(2)}%,100%{opacity:0}`
      : i === SLOTS - 1
        ? `0%,${(a - e).toFixed(2)}%{opacity:0}${a.toFixed(2)}%,100%{opacity:1}`
        : `0%,${(a - e).toFixed(2)}%{opacity:0}${a.toFixed(2)}%,${(b - e).toFixed(2)}%{opacity:1}${b.toFixed(2)}%,100%{opacity:0}`;
    slotCss += `@keyframes s${i}{${kf}}.s${i}{animation:s${i} ${T}s linear infinite}`;
    slots += `<g class="slot s${i}"><text class="clock" x="454" y="46" text-anchor="end">${label}</text>` +
      (rush ? `<text class="rush" x="364" y="44" text-anchor="end">RUSH HOUR</text>` : "") + `</g>`;
  }
  const stillSlot = Math.round((STILL_HOUR - DAY_START) / (DAY_SPAN / SLOTS) - 0.5);

  /* With reduced motion, everything stops on a still frame of the morning rush hour and the cars are hidden. */
  const css = `
    .panel{fill:${th.panel}}
    .plab{font:500 15px ${MONO};letter-spacing:2px;fill:${th.panelMuted}}
    .clock{font:600 26px ${MONO};fill:${th.panelInk}}
    .rush{font:600 13px ${MONO};letter-spacing:1.6px;fill:${MAP.jam}}
    .track{fill:${th.panelLine}}
    .daybar{fill:${AMBER};transform-box:fill-box;transform-origin:0 50%;transform:scaleX(${((STILL_HOUR - DAY_START) / DAY_SPAN).toFixed(3)});animation:day ${T}s linear infinite}
    .lk{stroke-width:5;stroke-linecap:round}
    .nd{fill:${th.panel};stroke:${th.panelMuted};stroke-width:1.5}
    .car{fill:${th.panelInk};stroke:${th.panel};stroke-width:1.5}
    .leg{font:500 14px ${MONO};letter-spacing:1.4px;fill:${th.panelMuted}}
    .slot{opacity:0}.s${stillSlot}{opacity:1}
    @keyframes day{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    ${links.css}${slotCss}
    @media (prefers-reduced-motion: reduce){*{animation:none!important}.car{display:none}}`;

  const body = `
<rect class="panel" width="${W}" height="${H}" rx="14"/>
<text class="plab" x="26" y="42">LINK-LEVEL TRAVEL TIME</text>
${slots}
<rect class="track" x="26" y="62" width="428" height="3" rx="1.5"/>
<rect class="daybar" x="26" y="62" width="428" height="3" rx="1.5"/>
${links.svg}
${net.nodes.map(n => `<circle class="nd" cx="${r1(n.x)}" cy="${r1(n.y)}" r="4.5"/>`).join("")}
${carLayer(net, 5, 4, 42, 4)}
<circle cx="32" cy="346" r="5" fill="${MAP.free}"/><text class="leg" x="44" y="351">FREE</text>
<circle cx="110" cy="346" r="5" fill="${MAP.slow}"/><text class="leg" x="122" y="351">SLOW</text>
<circle cx="188" cy="346" r="5" fill="${MAP.jam}"/><text class="leg" x="200" y="351">JAM</text>
<text class="leg" x="454" y="351" text-anchor="end">ILLUSTRATION</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Link-level travel time</title>
<desc id="d">${esc("Illustration: a road network whose roads turn green, amber and red as traffic builds and clears through a day.")}</desc>
<style>${css.replace(/\n\s*/g, "")}</style>
${body.trim()}
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [mode, th] of Object.entries(THEMES)) {
  const svg = mapPanel(th);
  fs.writeFileSync(path.join(OUT, `map-${mode}.svg`), svg);
  console.log(`Wrote assets/map-${mode}.svg (${(svg.length / 1024).toFixed(1)} KB)`);
}
