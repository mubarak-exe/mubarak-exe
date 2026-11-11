/* Builds the animated SVGs that README.md shows, in a light and a dark version each.
   Run from the repository root:  node scripts/build-svgs.js
   To change the wording, edit BANNER, CARDS or TOOLKIT below and run it again.
   GitHub shows SVGs as images: CSS and SMIL animation work, scripts and hover do not,
   and web fonts don't load, so text uses system fonts. */
"use strict";
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "assets");

/* Navy + Amber, matching the portfolio site. */
const THEMES = {
  light: {
    bg: "#F4F6F8", ink: "#0A1828", muted: "#4A5868", line: "#D6DDE4", accent: "#A04A08",
    panel: "#0A1828", panelLine: "#1F3349", panelInk: "#E8EEF4", panelMuted: "#9AAABB"
  },
  dark: {
    bg: "#0A1828", ink: "#E8EEF4", muted: "#9AAABB", line: "#1F3349", accent: "#F5A524",
    panel: "#112236", panelLine: "#2A4560", panelInk: "#E8EEF4", panelMuted: "#9AAABB"
  }
};
const AMBER = "#F5A524";
const MAP = { free: "#3CCB8F", slow: "#F5A524", jam: "#FF6B5B" };
const SANS = "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */
const BANNER = {
  kicker: "ML RESEARCH · WATERLOO, ONTARIO",
  name: ["Mubarak", "Shikalgar"],
  lines: ["Travel-time prediction, digital twins", "and LLM agents for urban mobility."],
  status: "OPEN TO ML AND RESEARCH ROLES IN CANADA",
  desc: "Machine learning research in Waterloo, Ontario: travel-time prediction, digital twins and LLM agents for urban mobility. An animated road network shows traffic building through a day."
};

const CARDS = [
  {
    id: "linketa", art: "network",
    kicker: "01 · GRAPH ML · 2025–26", title: "LinkETA",
    body: "A Graph Transformer that predicts travel time for every road segment, and adapts to a new city from 25 trips.",
    value: "23.7%", label: "lower error than Baidu's DuETA, on average",
    cta: "READ THE PREPRINT ↗", linked: true
  },
  {
    id: "text2simulation", art: "agent",
    kicker: "02 · LLM AGENT · 2026", title: "Text2Simulation",
    body: "A GPT-4o and LangGraph agent that sets up digital-twin simulations from plain language, and refuses what it can't run.",
    value: "96.7%", label: "of unsupported requests caught, zero false alarms",
    cta: "PAPER IN IEEE XPLORE", linked: false
  },
  {
    id: "dtumos", art: "dispatch",
    kicker: "03 · DIGITAL TWIN · 2025–NOW", title: "DTUMOS",
    body: "Open-source digital twin for urban mobility. I added traffic-aware ETAs and helped build its taxi dispatch.",
    value: "1 min", label: "dispatch steps; matching solved as MIP with OR-Tools",
    cta: "VIEW THE REPO ↗", linked: true
  },
  {
    id: "fake-news", art: "attention",
    kicker: "04 · NLP · 2021–22", title: "Fake news detection",
    body: "Hybrid BiLSTM-TCN model with attention for detecting fake news. My B.Tech. final-year project.",
    value: "Best Project", label: "SGU award 2021–22 · published in IEEE Xplore 2023",
    cta: "VIEW THE REPO ↗", linked: true
  }
];

const TOOLKIT = [
  "Graph Transformers", "Spatiotemporal prediction", "Meta-learning", "LLM agents", "LangGraph",
  "Map matching", "OpenStreetMap", "OR-Tools", "Mixed-Integer Programming", "PyTorch",
  "Digital twins", "Geospatial ETL"
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
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

function wrap(text, max) {
  const lines = [];
  let cur = "";
  for (const w of text.split(" ")) {
    const next = cur ? cur + " " + w : w;
    if (next.length > max && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/* With reduced motion, CSS animation stops on a still frame (morning rush hour),
   SMIL-animated parts are hidden, and static stand-ins are shown instead. */
const REDUCED = ".still{display:none}@media (prefers-reduced-motion: reduce){*{animation:none!important}.smil{display:none}.still{display:inline}}";

function svgDoc(w, h, title, desc, css, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
<style>${css.replace(/\n\s*/g, "")}</style>
${body.trim()}
</svg>
`;
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
function linkLayer(net, prefix, T) {
  const N = 36;
  let css = "";
  const svg = net.links.map((l, i) => {
    const stops = [];
    for (let k = 0; k <= N; k++) stops.push([k / N, colorAt(hourAt(k / N), l.f)]);
    const kept = stops.filter((s, j) => j === 0 || j === N || s[1] !== stops[j - 1][1] || s[1] !== stops[j + 1][1]);
    css += `@keyframes ${prefix}${i}{${kept.map(s => `${pct(s[0])}{stroke:${s[1]}}`).join("")}}.${prefix}${i}{animation:${prefix}${i} ${T}s linear infinite}`;
    const A = net.nodes[l.a], B = net.nodes[l.b];
    return `<line class="lk ${prefix}${i}" x1="${r1(A.x)}" y1="${r1(A.y)}" x2="${r1(B.x)}" y2="${r1(B.y)}" stroke="${colorAt(STILL_HOUR, l.f)}"/>`;
  }).join("");
  return { css, svg };
}

function nodeLayer(net, r) {
  return net.nodes.map(n => `<circle class="nd" cx="${r1(n.x)}" cy="${r1(n.y)}" r="${r}"/>`).join("");
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
    out += `<circle class="car smil" r="${radius}" opacity="0">` +
      `<animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${d}"/>` +
      `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.94;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
      `</circle>`;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Banner                                                              */
/* ------------------------------------------------------------------ */
function banner(th) {
  const W = 1200, H = 460, T = 16, SLOTS = 12;
  const net = network({ x: 728, y: 136, w: 380, h: 214, cols: 6, rows: 4, jitter: 12, seed: 41 });
  const links = linkLayer(net, "k", T);

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
    slots += `<g class="slot s${i}"><text class="clock" x="1136" y="80" text-anchor="end">${label}</text>` +
      (rush ? `<text class="rush" x="1054" y="78" text-anchor="end">RUSH HOUR</text>` : "") + `</g>`;
  }
  const stillSlot = Math.round((STILL_HOUR - DAY_START) / (DAY_SPAN / SLOTS) - 0.5);

  const css = `
    .bg{fill:${th.bg};stroke:${th.line}}
    .kick{font:500 15px ${MONO};letter-spacing:2.4px;fill:${th.muted}}
    .dash{stroke:${th.accent};stroke-width:3}
    .name{font:800 96px ${SANS};letter-spacing:-3px;fill:${th.ink}}
    .sub{font:400 23px ${SANS};fill:${th.muted}}
    .stat{font:600 13.5px ${MONO};letter-spacing:1.6px;fill:${th.ink}}
    .dot{fill:${MAP.free}}
    .ping{fill:${MAP.free};transform-box:fill-box;transform-origin:center;animation:ping 2.4s ease-out infinite}
    .panel{fill:${th.panel}}
    .plab{font:500 12.5px ${MONO};letter-spacing:2px;fill:${th.panelMuted}}
    .clock{font:600 22px ${MONO};fill:${th.panelInk}}
    .rush{font:600 11px ${MONO};letter-spacing:1.6px;fill:${MAP.jam}}
    .track{fill:${th.panelLine}}
    .daybar{fill:${AMBER};transform-box:fill-box;transform-origin:0 50%;transform:scaleX(${((STILL_HOUR - DAY_START) / DAY_SPAN).toFixed(3)});animation:day ${T}s linear infinite}
    .lk{stroke-width:5;stroke-linecap:round}
    .nd{fill:${th.panel};stroke:${th.panelMuted};stroke-width:1.5}
    .car{fill:${th.panelInk};stroke:${th.panel};stroke-width:1.5}
    .leg{font:500 11.5px ${MONO};letter-spacing:1.4px;fill:${th.panelMuted}}
    .slot{opacity:0}.s${stillSlot}{opacity:1}
    .n1,.n2{animation:up 1.1s cubic-bezier(.2,.75,.15,1) both}.n2{animation-delay:.12s}
    .f1,.f2,.f3{animation:rise .9s cubic-bezier(.2,.75,.15,1) both}.f2{animation-delay:.35s}.f3{animation-delay:.55s}
    @keyframes up{from{transform:translateY(112px)}to{transform:none}}
    @keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
    @keyframes ping{0%{transform:scale(1);opacity:.55}100%{transform:scale(3.2);opacity:0}}
    @keyframes day{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    ${links.css}${slotCss}${REDUCED}`;

  const body = `
<rect class="bg" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20"/>
<clipPath id="c1"><rect x="40" y="100" width="620" height="108"/></clipPath>
<clipPath id="c2"><rect x="40" y="208" width="620" height="110"/></clipPath>
<g class="f1"><line class="dash" x1="56" y1="81" x2="82" y2="81"/><text class="kick" x="94" y="86">${esc(BANNER.kicker)}</text></g>
<g clip-path="url(#c1)"><text class="name n1" x="50" y="190">${esc(BANNER.name[0])}</text></g>
<g clip-path="url(#c2)"><text class="name n2" x="50" y="290">${esc(BANNER.name[1])}</text></g>
<g class="f2"><text class="sub" x="54" y="346">${esc(BANNER.lines[0])}</text><text class="sub" x="54" y="378">${esc(BANNER.lines[1])}</text></g>
<g class="f3"><circle class="ping" cx="62" cy="418" r="6"/><circle class="dot" cx="62" cy="418" r="6"/><text class="stat" x="80" y="423">${esc(BANNER.status)}</text></g>
<rect class="panel" x="676" y="36" width="488" height="388" rx="14"/>
<text class="plab" x="704" y="78">LINK-LEVEL TRAVEL TIME</text>
${slots}
<rect class="track" x="704" y="96" width="432" height="3" rx="1.5"/>
<rect class="daybar" x="704" y="96" width="432" height="3" rx="1.5"/>
${links.svg}
${nodeLayer(net, 4.5)}
${carLayer(net, 5, 4, 42, 4)}
<circle cx="709" cy="396" r="4.5" fill="${MAP.free}"/><text class="leg" x="720" y="400">FREE</text>
<circle cx="774" cy="396" r="4.5" fill="${MAP.slow}"/><text class="leg" x="785" y="400">SLOW</text>
<circle cx="839" cy="396" r="4.5" fill="${MAP.jam}"/><text class="leg" x="850" y="400">JAM</text>
<text class="leg" x="1136" y="400" text-anchor="end">ILLUSTRATION</text>`;

  return svgDoc(W, H, BANNER.name.join(" "), BANNER.desc, css, body);
}

/* ------------------------------------------------------------------ */
/* Card artwork (drawn in a 184 x 184 panel)                           */
/* ------------------------------------------------------------------ */
const ARTS = {
  network(th) {
    const net = network({ x: 26, y: 28, w: 132, h: 128, cols: 4, rows: 4, jitter: 9, seed: 7 });
    const links = linkLayer(net, "k", 12);
    return {
      css: `.lk{stroke-width:4;stroke-linecap:round}.nd{fill:${th.panel};stroke:${th.panelMuted};stroke-width:1.2}.car{fill:${th.panelInk};stroke:${th.panel};stroke-width:1.2}${links.css}`,
      svg: links.svg + nodeLayer(net, 3.5) + carLayer(net, 3, 2, 30, 3.2)
    };
  },

  agent(th) {
    const T = 7;
    const boxes = [
      [32, 18, 120, 24, "REQUEST"], [32, 62, 120, 24, "LLM AGENT"], [32, 106, 120, 24, "VERIFY"],
      [14, 150, 72, 22, "RUN"], [98, 150, 72, 22, "REFUSE"]
    ];
    const flash = (x, y, w, h, color, values, keyTimes) =>
      `<rect class="smil" x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${color}" fill-opacity="0">` +
      `<animate attributeName="fill-opacity" values="${values}" keyTimes="${keyTimes}" dur="${T}s" repeatCount="indefinite"/></rect>`;
    const token = (d, keyPoints, keyTimes, opValues, opTimes) =>
      `<circle class="smil" r="5" fill="${AMBER}" opacity="0">` +
      `<animateMotion dur="${T}s" repeatCount="indefinite" path="${d}" keyPoints="${keyPoints}" keyTimes="${keyTimes}" calcMode="linear"/>` +
      `<animate attributeName="opacity" values="${opValues}" keyTimes="${opTimes}" dur="${T}s" repeatCount="indefinite"/></circle>`;
    const labelColor = l => l === "RUN" ? MAP.free : l === "REFUSE" ? MAP.jam : th.panelInk;
    return {
      css: `.wire{fill:none;stroke:${th.panelLine};stroke-width:2}.abox{fill:${th.panel};stroke:${th.panelLine};stroke-width:1.5}.alab{font:600 9.5px ${MONO};letter-spacing:1.2px}`,
      svg:
        `<path class="wire" d="M92 42V62M92 86V106M92 130V140L50 150M92 140L134 150"/>` +
        boxes.map(([x, y, w, h]) => `<rect class="abox" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`).join("") +
        flash(32, 106, 120, 24, AMBER, "0;0;0.3;0;0;0.3;0;0", "0;0.2;0.25;0.3;0.7;0.75;0.8;1") +
        flash(14, 150, 72, 22, MAP.free, "0;0;0.35;0.35;0;0", "0;0.38;0.41;0.47;0.5;1") +
        flash(98, 150, 72, 22, MAP.jam, "0;0;0.35;0.35;0", "0;0.88;0.91;0.97;1") +
        boxes.map(([x, y, w, h, l]) => `<text class="alab" x="${x + w / 2}" y="${y + h / 2 + 3.5}" text-anchor="middle" fill="${labelColor(l)}">${l}</text>`).join("") +
        token("M92 30V118L50 161", "0;1;1", "0;0.4;1", "0;1;1;0;0", "0;0.03;0.44;0.47;1") +
        token("M92 30V118L134 161", "0;0;1;1", "0;0.5;0.9;1", "0;0;1;1;0;0", "0;0.5;0.53;0.94;0.97;1")
    };
  },

  dispatch(th) {
    const G = [26, 70, 114, 158];
    const trips = [
      { from: [0, 3], to: [2, 1], dur: 6, begin: 0, hFirst: true },
      { from: [3, 0], to: [1, 2], dur: 7, begin: -2.4, hFirst: false },
      { from: [3, 3], to: [0, 0], dur: 8, begin: -5.1, hFirst: true }
    ];
    let streets = "";
    G.forEach(v => { streets += `<line class="st" x1="${v}" y1="12" x2="${v}" y2="172"/><line class="st" x1="12" y1="${v}" x2="172" y2="${v}"/>`; });
    let moving = "", still = "";
    trips.forEach(t => {
      const [sx, sy] = [G[t.from[0]], G[t.from[1]]], [ex, ey] = [G[t.to[0]], G[t.to[1]]];
      const d = t.hFirst ? `M${sx} ${sy}H${ex}V${ey}` : `M${sx} ${sy}V${ey}H${ex}`;
      const timing = `dur="${t.dur}s" begin="${t.begin}s" repeatCount="indefinite"`;
      moving +=
        `<circle class="smil pax" cx="${ex}" cy="${ey}" r="5" opacity="0"><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.08;0.8;0.84;1" ${timing}/></circle>` +
        `<g class="smil" opacity="0"><rect class="taxi" x="-7" y="-4.5" width="14" height="9" rx="2.5"/>` +
        `<animateMotion ${timing} path="${d}" rotate="auto" keyPoints="0;1;1" keyTimes="0;0.8;1" calcMode="linear"/>` +
        `<animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.06;0.86;0.92;1" ${timing}/></g>`;
      still += `<circle class="still pax" cx="${ex}" cy="${ey}" r="5"/><rect class="still taxi" x="${sx - 7}" y="${sy - 4.5}" width="14" height="9" rx="2.5"/>`;
    });
    return {
      css: `.st{stroke:${th.panelLine};stroke-width:3;stroke-linecap:round}.taxi{fill:${AMBER}}.pax{fill:${th.panelInk}}`,
      svg: streets + moving + still
    };
  },

  attention(th) {
    const rnd = rng(17), n = 7, cell = 18, gap = 4, off = 17, top = 14;
    let css = `.cell{fill:${AMBER}}.alab{font:600 9px ${MONO};letter-spacing:1.4px;fill:${th.panelMuted}}`, svg = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const near = Math.max(0, 1 - Math.abs(r - c) / 2.5);
        const v = () => Math.min(0.95, 0.08 + near * 0.55 + rnd() * 0.4).toFixed(2);
        const [v0, v1, v2] = [v(), v(), v()];
        const i = r * n + c;
        css += `@keyframes a${i}{0%,100%{opacity:${v0}}33%{opacity:${v1}}66%{opacity:${v2}}}.a${i}{animation:a${i} 6s ease-in-out infinite}`;
        svg += `<rect class="cell a${i}" x="${off + c * (cell + gap)}" y="${top + r * (cell + gap)}" width="${cell}" height="${cell}" rx="3" opacity="${v0}"/>`;
      }
    }
    svg += `<text class="alab" x="${off}" y="178">ATTENTION WEIGHTS</text>`;
    return { css, svg };
  }
};

/* ------------------------------------------------------------------ */
/* Project card                                                        */
/* ------------------------------------------------------------------ */
function card(c, th) {
  const W = 600, H = 320;
  const titleSize = Math.min(34, Math.floor(340 / (c.title.length * 0.6)));
  const body = wrap(c.body, 40);
  if (body.length > 3) throw new Error(`${c.id}: the card text needs ${body.length} lines; shorten it to fit in 3.`);
  const art = ARTS[c.art](th);
  const css = `
    .bg{fill:${th.bg};stroke:${th.line}}
    .panel{fill:${th.panel}}
    .kick{font:600 12.5px ${MONO};letter-spacing:2px;fill:${th.accent}}
    .title{font:800 ${titleSize}px ${SANS};letter-spacing:-1px;fill:${th.ink}}
    .body{font:400 16px ${SANS};fill:${th.muted}}
    .rule{stroke:${th.line}}
    .val{font:800 32px ${SANS};letter-spacing:-.5px;fill:${th.accent}}
    .lab{font:400 14px ${SANS};fill:${th.muted}}
    .cta{font:600 12.5px ${MONO};letter-spacing:1.5px;fill:${c.linked ? th.accent : th.muted}}
    ${art.css}${REDUCED}`;
  const body2 = `
<rect class="bg" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16"/>
<g transform="translate(392 24)"><rect class="panel" width="184" height="184" rx="12"/>${art.svg}</g>
<text class="kick" x="28" y="54">${esc(c.kicker)}</text>
<text class="title" x="27" y="100">${esc(c.title)}</text>
${body.map((l, i) => `<text class="body" x="28" y="${136 + i * 24}">${esc(l)}</text>`).join("")}
<line class="rule" x1="28" y1="226" x2="572" y2="226"/>
<text class="val" x="27" y="274">${esc(c.value)}</text>
<text class="lab" x="28" y="298">${esc(c.label)}</text>
<text class="cta" x="572" y="274" text-anchor="end">${esc(c.cta)}</text>`;
  return svgDoc(W, H, c.title, `${c.body} ${c.value} ${c.label}.`, css, body2);
}

/* ------------------------------------------------------------------ */
/* Toolkit strip: an endless marquee                                   */
/* ------------------------------------------------------------------ */
function marquee(th) {
  const W = 1200, H = 72, size = 15, charW = size * 0.6 + 1.6, gap = 64;
  const pos = [];
  let x = 0;
  for (const item of TOOLKIT) { pos.push(x); x += item.length * charW + gap; }
  const cycle = r1(x), copies = Math.ceil(W / cycle) + 1;
  let track = "";
  for (let k = 0; k < copies; k++) {
    TOOLKIT.forEach((item, i) => {
      const at = 40 + k * cycle + pos[i];
      track += `<text class="tk" x="${r1(at)}" y="41">${esc(item.toUpperCase())}</text>`;
      const sep = at + item.length * charW + gap / 2;
      track += `<rect class="sep" x="${r1(sep - 3.5)}" y="32.5" width="7" height="7" transform="rotate(45 ${r1(sep)} 36)"/>`;
    });
  }
  const css = `
    .band{fill:${th.panel}}
    .tk{font:600 ${size}px ${MONO};letter-spacing:1.6px;fill:${th.panelInk}}
    .sep{fill:${AMBER}}
    .track{animation:mq ${Math.round(cycle / 38)}s linear infinite}
    @keyframes mq{to{transform:translateX(-${cycle}px)}}
    ${REDUCED}`;
  const body = `
<defs>
<clipPath id="clip"><rect width="${W}" height="${H}" rx="14"/></clipPath>
<linearGradient id="fl" x1="0" x2="1"><stop offset="0" stop-color="${th.panel}"/><stop offset="1" stop-color="${th.panel}" stop-opacity="0"/></linearGradient>
<linearGradient id="fr" x1="1" x2="0"><stop offset="0" stop-color="${th.panel}"/><stop offset="1" stop-color="${th.panel}" stop-opacity="0"/></linearGradient>
</defs>
<g clip-path="url(#clip)">
<rect class="band" width="${W}" height="${H}"/>
<g class="track">${track}</g>
<rect width="90" height="${H}" fill="url(#fl)"/>
<rect x="${W - 90}" width="90" height="${H}" fill="url(#fr)"/>
</g>`;
  return svgDoc(W, H, "Toolkit", TOOLKIT.join(", ") + ".", css, body);
}

/* ------------------------------------------------------------------ */
/* Write the files                                                     */
/* ------------------------------------------------------------------ */
fs.mkdirSync(OUT, { recursive: true });
const written = [];
for (const [mode, th] of Object.entries(THEMES)) {
  const files = [[`banner-${mode}.svg`, banner(th)], [`toolkit-${mode}.svg`, marquee(th)]];
  CARDS.forEach(c => files.push([`card-${c.id}-${mode}.svg`, card(c, th)]));
  for (const [name, svg] of files) {
    fs.writeFileSync(path.join(OUT, name), svg);
    written.push(`${name} (${(svg.length / 1024).toFixed(1)} KB)`);
  }
}
console.log("Wrote to assets/:\n  " + written.join("\n  "));
