// Topics page: where the groups' energy flows.
// Organizations send streams of energy to the topics their projects, events and actions work on.
// Two layouts (organizations in the middle / on the left) and two styles ("Comets + shields" / "Watershed").
// Stream size uses the Topics page's slider weights; each topic glows (or greens) with how much energy reaches it.
// Zooming goes deeper: main topics → sub-topics → individual bills, and the items (projects, events, actions,
// mission statements) that make up each stream appear as dots along it.
// Calm by design: one stream per organization → main topic until you zoom or click, a fixed particle budget
// drawn on canvas, slow speeds, low opacity, additive glow, and static flows for prefers-reduced-motion.
import * as d3 from "d3";
import { h, clear } from "./dom";
import type { TopicRecord, TopicsFile, TopicsCallbacks } from "./topics";

export interface CommandRoomCtx {
  file: TopicsFile;
  mapIds: string[];
  /** The slider weight of one record. */
  weight(r: TopicRecord): number;
  /** Most one group can add to one topic ("Cap per group" slider). */
  cap(): number;
  colorOf(parentId: string): string;
  detail: HTMLElement;
  cb: TopicsCallbacks;
}

type Layout = "center" | "sides";
type Style = "comets" | "watershed";

interface Org {
  key: string;
  host: string;
  name: string;
  logo?: string;
  base: number;
  energy: number;
  x: number;
  y: number;
  r: number;
  order: number;
}
interface Problem {
  id: string;
  label: string;
  parent: string; // main topic id (for colour)
  level: 0 | 1 | 2; // main topic, sub-topic, bill
  up: Problem | null;
  kids: Problem[];
  base: number;
  energy: number;
  glow: number;
  recurring: number;
  x: number;
  y: number;
  r: number;
  angle: number;
  qx: number; // where the rivulets join into one river (watershed)
  qy: number;
  visible: boolean;
}
interface Stream {
  org: Org;
  prob: Problem;
  recs: TopicRecord[];
  raw: number;
  value: number;
  base: number;
  pts: Float32Array; // polyline x,y
  cum: Float32Array; // cumulative length
  uni: Float32Array; // the same path resampled at equal steps of length (fast lookups)
  len: number;
  riverAt: number; // index where the river part starts (watershed)
  n: number; // particles
  speed: number; // phase per second
  seed: number;
}
interface Item {
  key: string;
  s: Stream;
  r: TopicRecord;
  f: number; // where along the stream
}
interface Ripple {
  prob: Problem;
  t0: number;
  big: boolean;
}

const DAY = 86400000;
const BROAD = "broad";
const BILLS = "bills";
const STORE = "openthink.topics.commandroom.v1";
const SPLIT_K = 1.7; // zoom where main topics split into sub-topics
const DEEP_K = 2.8; // zoom where bills split and items appear
const KIND_LABEL: Record<TopicRecord["kind"], string> = {
  event: "Event",
  project: "Project",
  action: "Action",
  org_mission: "Mission statement",
  coalition_mission: "Mission statement",
};
const KIND_COLOR: Record<string, string> = { event: "#f472b6", project: "#34d399", action: "#fbbf24", mission: "#cbd5e1" };

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return ((x >>> 0) % 10000) / 10000;
}
const isMission = (r: TopicRecord) => r.kind === "org_mission" || r.kind === "coalition_mission";
const kindKey = (r: TopicRecord) => (isMission(r) ? "mission" : r.kind);
const fmtDay = d3.timeFormat("%b %-d, %Y");
/** Is p the same as, or inside, q? */
function within(p: Problem, q: Problem): boolean {
  for (let x: Problem | null = p; x; x = x.up) if (x === q) return true;
  return false;
}

export function createCommandRoom(ctx: CommandRoomCtx): { el: HTMLElement; update(): void; show(): void; hide(): void } {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "{}") as { layout?: Layout; style?: Style };
    } catch {
      return {};
    }
  })();
  let layout: Layout = saved.layout === "sides" ? "sides" : "center";
  let style: Style = saved.style === "watershed" ? "watershed" : "comets";
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ layout, style }));
    } catch {
      /* ignore */
    }
  };
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // ---------- Data: main topics → sub-topics → bills ----------
  const recs = ctx.file.records.filter((r) => ctx.mapIds.includes(r.map) && (r.topics.length || r.bills.length));
  const c2p = new Map<string, string>();
  for (const p of ctx.file.parents) for (const c of p.children) c2p.set(c.id, p.id);
  const childLabel = new Map<string, string>();
  for (const p of ctx.file.parents) for (const c of p.children) childLabel.set(`${p.id}/${c.id}`, c.id === BILLS ? "Named bills" : c.label);
  const billName = new Map(ctx.file.bills.map((b) => [b.id, b.name]));

  const probs = new Map<string, Problem>();
  const getProb = (id: string, label: string, parent: string, level: 0 | 1 | 2, up: Problem | null): Problem => {
    let p = probs.get(id);
    if (!p) {
      p = { id, label, parent, level, up, kids: [], base: 0, energy: 0, glow: 0, recurring: 0, x: 0, y: 0, r: 4, angle: 0, qx: 0, qy: 0, visible: false };
      probs.set(id, p);
      up?.kids.push(p);
    }
    return p;
  };
  const orgs = new Map<string, Org>();
  const streams = new Map<string, Stream>();
  const recStreams = new Map<string, Stream[]>();
  for (const r of recs) {
    const okey = `${r.map}:${r.host}`;
    let org = orgs.get(okey);
    if (!org) {
      org = { key: okey, host: r.host, name: r.host_name, logo: ctx.cb.logoOf?.(r.host), base: 0, energy: 0, x: NaN, y: NaN, r: 3, order: 0 };
      orgs.set(okey, org);
    }
    const topics = new Set(r.topics);
    if (r.bills.length && c2p.has(BILLS)) topics.add(BILLS); // a record naming a bill belongs under "Named bills"
    const fed = new Set<Problem>();
    for (const t of topics) {
      const pid = c2p.get(t);
      if (!pid) continue;
      const pp = getProb(`p:${pid}`, ctx.file.parents.find((x) => x.id === pid)!.label, pid, 0, null);
      const cp = getProb(`c:${pid}/${t}`, childLabel.get(`${pid}/${t}`) ?? t, pid, 1, pp);
      fed.add(pp);
      fed.add(cp);
      if (t === BILLS) {
        if (r.bills.length) for (const b of r.bills) fed.add(getProb(`b:${b}`, billName.get(b) ?? b, pid, 2, cp));
        else fed.add(getProb("b:other", "Other named bills", pid, 2, cp));
      }
    }
    const list: Stream[] = [];
    for (const prob of fed) {
      const k = `${okey}|${prob.id}`;
      let s = streams.get(k);
      if (!s) {
        s = { org, prob, recs: [], raw: 0, value: 0, base: 0, pts: new Float32Array(0), cum: new Float32Array(0), uni: new Float32Array(0), len: 1, riverAt: 0, n: 0, speed: 0, seed: hash(k) };
        streams.set(k, s);
      }
      s.recs.push(r);
      list.push(s);
    }
    recStreams.set(r.id, list);
  }
  // main topics and sub-topics in the file's order; bills in the file's order with "Other" last
  const parents: Problem[] = ctx.file.parents.map((p) => probs.get(`p:${p.id}`)).filter((p): p is Problem => !!p);
  const billOrder = ctx.file.bills.map((b) => `b:${b.id}`).concat("b:other");
  for (const p of parents) {
    const order = ctx.file.parents.find((x) => x.id === p.parent)!.children.map((c) => `c:${p.parent}/${c.id}`);
    p.kids.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    for (const k of p.kids) k.kids.sort((a, b) => billOrder.indexOf(a.id) - billOrder.indexOf(b.id));
  }
  const allStreams = [...streams.values()];
  const orgList = [...orgs.values()];

  // time range for playback
  const dated = recs.filter((r) => r.date && Number.isFinite(Date.parse(r.date))).map((r) => Date.parse(r.date!));
  const hasTime = dated.length > 0;
  const T0 = hasTime ? +d3.timeMonth.floor(new Date(Math.min(...dated))) : 0;
  const T1 = hasTime ? Math.max(...dated) + 10 * DAY : 0;
  let tNow: number | null = null; // null = the whole year at once
  const recWeight = new Map<string, number>();

  function timeFactor(r: TopicRecord, t: number | null): number {
    if (t === null || !r.date) return 1; // undated projects, actions and missions are always on
    const d = Date.parse(r.date);
    if (!Number.isFinite(d)) return 1;
    if (t < d) return 0;
    if (r.recurring) return 1; // a repeating event keeps going
    return Math.exp(-(t - d) / (18 * DAY)); // a one-off event's energy fades over a few weeks
  }

  const levelMax = [1, 1, 1];
  function compute(t: number | null, intoBase: boolean) {
    const cap = ctx.cap();
    for (const s of allStreams) s.raw = 0;
    for (const p of probs.values()) {
      p.energy = 0;
      p.recurring = 0;
    }
    for (const o of orgList) o.energy = 0;
    for (const r of recs) {
      const w = ctx.weight(r) * timeFactor(r, t);
      if (!intoBase) recWeight.set(r.id, w);
      if (w <= 0) continue;
      for (const s of recStreams.get(r.id) ?? []) {
        s.raw += w;
        if (r.recurring && r.kind === "event") s.prob.recurring++;
      }
    }
    for (const s of allStreams) {
      s.value = Math.min(cap, s.raw);
      s.prob.energy += s.value;
      if (s.prob.level === 0) s.org.energy += s.value;
    }
    if (intoBase) {
      for (const s of allStreams) s.base = s.value;
      for (const p of probs.values()) p.base = p.energy;
      for (const o of orgList) o.base = o.energy;
      for (const lv of [0, 1, 2]) levelMax[lv] = d3.max([...probs.values()].filter((p) => p.level === lv && p.parent !== BROAD), (p) => p.base) || 1;
    }
    // glow: how much energy reaches a topic, compared with the busiest topic at the same depth
    for (const p of probs.values()) p.glow = Math.min(1, Math.sqrt(p.energy / levelMax[p.level]));
  }

  // ---------- DOM ----------
  const el = h("div", { class: "cr" });
  const bar = h("div", { class: "cr-bar" });
  const seg = (name: string, opts: [string, string][], cur: () => string, set: (v: string) => void) => {
    const g = h("div", { class: "cr-seg", role: "group", "aria-label": name });
    g.appendChild(h("span", { class: "cr-seg-label" }, name));
    const btns: HTMLButtonElement[] = [];
    for (const [v, label] of opts) {
      const b = h("button", { type: "button", "data-v": v }, label) as HTMLButtonElement;
      b.addEventListener("click", () => {
        set(v);
        sync();
      });
      btns.push(b);
      g.appendChild(b);
    }
    const sync = () => {
      for (const x of btns) x.classList.toggle("on", x.dataset.v === cur());
    };
    sync();
    return { g, sync };
  };
  const layoutSeg = seg("Layout", [["center", "Groups in the middle"], ["sides", "Groups ← → topics"]], () => layout, (v) => {
    layout = v as Layout;
    save();
    resetZoom();
    relayout(true);
  });
  const styleSeg = seg("Style", [["comets", "Comets + shields"], ["watershed", "Watershed"]], () => style, (v) => {
    style = v as Style;
    save();
    el.dataset.style = style;
    legendText();
    relayout(false);
  });
  let splitAll = false;
  let zoomLevel = 0; // 0: main topics, 1: sub-topics, 2: bills + items
  const splitSeg = seg("Topics", [["parents", "Main topics"], ["split", "Split all"]], () => (splitAll || zoomLevel >= 1 ? "split" : "parents"), (v) => {
    splitAll = v === "split";
    if (!splitAll && zoomLevel > 0) resetZoom();
    relayout(true);
  });
  bar.append(layoutSeg.g, styleSeg.g, splitSeg.g);
  el.appendChild(bar);

  const viewport = h("div", { class: "cr-viewport" });
  const canvas = document.createElement("canvas");
  canvas.className = "cr-canvas";
  const base = document.createElement("canvas");
  viewport.appendChild(canvas);
  const svg = d3.select(viewport).append("svg").attr("class", "cr-svg");
  const tip = h("div", { class: "cr-tip" });
  const legend = h("div", { class: "cr-legend" });
  const zoomBox = h("div", { class: "cr-zoom" });
  const zIn = h("button", { type: "button", "aria-label": "Zoom in", title: "Zoom in" }, "+") as HTMLButtonElement;
  const zOut = h("button", { type: "button", "aria-label": "Zoom out", title: "Zoom out" }, "−") as HTMLButtonElement;
  const zReset = h("button", { type: "button", "aria-label": "Reset view", title: "Reset view" }, "⟲") as HTMLButtonElement;
  const depthLbl = h("div", { class: "cr-depth" }, "");
  zoomBox.append(zIn, zOut, zReset, depthLbl);
  viewport.append(tip, legend, zoomBox);
  el.appendChild(viewport);
  el.dataset.style = style;

  // playback
  const play = h("div", { class: "cr-play" });
  const playBtn = h("button", { type: "button", class: "cr-playbtn", "aria-label": "Play the year" }, "▶") as HTMLButtonElement;
  const range = h("input", { type: "range", min: "0", max: String(Math.max(1, Math.round((T1 - T0) / DAY))), step: "1", value: "0", class: "slider cr-range", "aria-label": "Date" }) as HTMLInputElement;
  const dateLbl = h("span", { class: "cr-date" }, "");
  const allBtn = h("button", { type: "button", class: "cr-all on" }, "Whole year") as HTMLButtonElement;
  play.append(playBtn, range, dateLbl, allBtn);
  if (hasTime) el.insertBefore(play, viewport);
  const infoBtn = h("button", { type: "button", class: "cr-info", "aria-expanded": "false" }, "How to read") as HTMLButtonElement;
  infoBtn.addEventListener("click", () => {
    const on = !legend.classList.contains("on");
    legend.classList.toggle("on", on);
    infoBtn.setAttribute("aria-expanded", String(on));
  });
  bar.appendChild(infoBtn);

  const defs = svg.append("defs");
  defs.append("filter").attr("id", "cr-blur").attr("x", "-100%").attr("y", "-100%").attr("width", "300%").attr("height", "300%")
    .append("feGaussianBlur").attr("stdDeviation", 7);
  const wet = defs.append("radialGradient").attr("id", "cr-wet");
  wet.append("stop").attr("offset", "0%").attr("stop-color", "#38bdf8").attr("stop-opacity", 0.9);
  wet.append("stop").attr("offset", "55%").attr("stop-color", "#2dd4bf").attr("stop-opacity", 0.75);
  wet.append("stop").attr("offset", "100%").attr("stop-color", "#4ade80").attr("stop-opacity", 0.55);
  const crack = defs.append("pattern").attr("id", "cr-cracks").attr("width", 14).attr("height", 14).attr("patternUnits", "userSpaceOnUse");
  crack.append("path").attr("d", "M0 7 L5 5 L7 0 M5 5 L9 9 L14 8 M9 9 L8 14").attr("stroke", "#7c6a50").attr("stroke-width", 0.7).attr("fill", "none");
  defs.append("clipPath").attr("id", "cr-logo-clip").attr("clipPathUnits", "objectBoundingBox")
    .append("circle").attr("cx", 0.5).attr("cy", 0.5).attr("r", 0.5);
  const bg = svg.append("rect").attr("class", "cr-bg");
  const zg = svg.append("g");
  const gHits = zg.append("g").attr("class", "cr-hits");
  const gGroups = zg.append("g").attr("class", "cr-groups");
  // nodes are not scaled by the zoom, only moved: zooming spreads things out instead of blowing them up
  const gItems = svg.append("g").attr("class", "cr-items");
  const gProbs = svg.append("g").attr("class", "cr-probs");
  const gOrgs = svg.append("g").attr("class", "cr-orgs");

  // ---------- State ----------
  let W = 800, H = 600, dpr = 1;
  let tr = d3.zoomIdentity;
  const expanded = new Set<string>();
  let selOrg: Org | null = null;
  let selProb: Problem | null = null;
  let selItem: TopicRecord | null = null;
  let hover: Stream | null = null;
  let visProbs: Problem[] = [];
  let visStreams: Stream[] = [];
  let items: Item[] = [];
  let baseDirty = true;
  let baseStale = false;
  let lastBase = 0;
  let ripples: Ripple[] = [];
  let playing = false;
  let shown = false;
  let anim: { t0: number; from: Map<string, [number, number]>; dur: number } | null = null;
  const target = new Map<string, [number, number]>();
  let R = 200, cx = 400, cy = 300, xo = 150, xp = 600;
  const stats = { frames: 0, workMs: 0, avgMs: 0, maxMs: 0, intervalMs: 0, particles: 0, dayMs: 0, paintMs: 0, baseMs: 0, drawMs: 0, onDayMs: 0 };
  (window as unknown as { __commandRoom: typeof stats }).__commandRoom = stats;

  /** Does this topic show its finer topics instead of itself? */
  const isOpen = (p: Problem) =>
    p.kids.filter((k) => k.base > 0).length > 1 && (expanded.has(p.id) || zoomLevel > p.level || (splitAll && p.level === 0));

  // ---------- Layout ----------
  function measure() {
    const r = viewport.getBoundingClientRect();
    W = Math.max(320, r.width);
    H = Math.max(300, r.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [canvas, base]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    svg.attr("width", W).attr("height", H).attr("viewBox", `0 0 ${W} ${H}`);
    bg.attr("width", W).attr("height", H);
  }

  function computeTargets() {
    visProbs = [];
    const groups: Problem[][] = [];
    const emit = (p: Problem, out: Problem[]) => {
      if (!isOpen(p)) {
        out.push(p);
        return;
      }
      for (const k of p.kids) if (k.base > 0) emit(k, out);
    };
    for (const p of parents) {
      if (p.base <= 0) continue;
      const g: Problem[] = [];
      emit(p, g);
      groups.push(g);
      visProbs.push(...g);
    }
    for (const p of probs.values()) p.visible = false;
    for (const p of visProbs) p.visible = true;
    const small = Math.min(W, H) < 520;
    const sizeBy = [small ? [4, 10] : [5, 15], small ? [3, 6] : [3, 9], small ? [2.5, 4] : [3, 6]];
    for (const p of visProbs) {
      const [a, b] = sizeBy[p.level];
      p.r = a + b * Math.sqrt(Math.min(1, p.base / levelMax[p.level]));
    }
    if (layout === "sides") {
      const room = (H - 48) / Math.max(1, visProbs.length + 2);
      for (const p of visProbs) p.r = Math.min(p.r, Math.max(3, room * 0.36));
    }
    // slots: one per visible topic, with a gap between main topics (wider around split ones)
    const units: number[] = [];
    let u = 0;
    for (const g of groups) {
      const gap = g.length > 1 || g[0].level > 0 ? 1.1 : 0.35;
      u += gap / 2;
      for (let i = 0; i < g.length; i++) {
        // a small extra gap where a sub-topic's bills start and end
        if (i > 0 && g[i].up !== g[i - 1].up) u += 0.4;
        units.push(u + 0.5);
        u += 1;
      }
      u += gap / 2;
    }
    const total = u || 1;
    if (layout === "center") {
      // leave room for labels at the top and for the site's round + button at the bottom
      const top = 30, bottom = H - 100;
      cx = W / 2;
      R = Math.max(105, Math.min((bottom - top) / 2 - 18, W / 2 - (W < 640 ? 80 : 190)));
      cy = (top + bottom) / 2;
      visProbs.forEach((p, i) => {
        p.angle = -Math.PI / 2 + (units[i] / total) * Math.PI * 2;
        target.set(p.id, [cx + R * Math.cos(p.angle), cy + R * Math.sin(p.angle)]);
        p.qx = cx + R * 0.72 * Math.cos(p.angle);
        p.qy = cy + R * 0.72 * Math.sin(p.angle);
      });
    } else {
      xo = W < 640 ? 70 : Math.max(170, W * 0.2);
      xp = W - (W < 640 ? 110 : Math.max(220, W * 0.24));
      const top = 26, bot = H - 22;
      visProbs.forEach((p, i) => {
        const y = top + (units[i] / total) * (bot - top);
        target.set(p.id, [xp, y]);
        p.qx = xp - (xp - xo) * 0.28;
        p.qy = y;
      });
    }
    // organizations: placed by where their energy goes
    const maxO = d3.max(orgList, (o) => o.base) || 1;
    const live = orgList.filter((o) => o.base > 0);
    const visIndex = new Map(visProbs.map((p, i) => [p.id, i]));
    const byOrg = d3.group(allStreams.filter((s) => s.base > 0 && s.prob.visible), (s) => s.org.key);
    for (const o of orgList) o.r = o.base > 0 ? (small ? 2 : 3) + (small ? 4 : 7) * Math.sqrt(o.base / maxO) : 0;
    if (layout === "center") {
      const Rin = R * 0.6;
      const nodes = live.map((o) => {
        let sx = 0, sy = 0, sw = 0;
        for (const s of byOrg.get(o.key) ?? []) {
          sx += Math.cos(s.prob.angle) * s.base;
          sy += Math.sin(s.prob.angle) * s.base;
          sw += s.base;
        }
        const rho = sw ? Math.hypot(sx, sy) / sw : 0;
        const a = Math.atan2(sy, sx);
        const dist = Rin * (0.12 + 0.88 * Math.pow(rho, 1.3));
        const tx = cx + dist * Math.cos(a), ty = cy + dist * Math.sin(a);
        const prev = target.get(o.key);
        return { o, tx, ty, x: prev ? prev[0] : tx, y: prev ? prev[1] : ty } as { o: Org; tx: number; ty: number; x: number; y: number };
      });
      const sim = d3.forceSimulation(nodes)
        .force("x", d3.forceX<(typeof nodes)[number]>((d) => d.tx).strength(0.25))
        .force("y", d3.forceY<(typeof nodes)[number]>((d) => d.ty).strength(0.25))
        .force("c", d3.forceCollide<(typeof nodes)[number]>((d) => d.o.r + 2.2))
        .stop();
      for (let i = 0; i < 90; i++) sim.tick();
      for (const n of nodes) {
        const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy), lim = R * 0.66;
        const k = d > lim ? lim / d : 1;
        target.set(n.o.key, [cx + dx * k, cy + dy * k]);
      }
    } else {
      for (const o of live) {
        let sy = 0, sw = 0;
        for (const s of byOrg.get(o.key) ?? []) {
          sy += (visIndex.get(s.prob.id) ?? 0) * s.base;
          sw += s.base;
        }
        o.order = sw ? sy / sw : 0;
      }
      live.sort((a, b) => a.order - b.order || b.base - a.base);
      const top = 26, bot = H - 22;
      const step = (bot - top) / Math.max(1, live.length);
      const cols = step < 9 ? 3 : step < 14 ? 2 : 1; // stagger crowded columns so the dots don't overlap
      live.forEach((o, i) => target.set(o.key, [xo - (i % cols) * 13, top + (i + 0.5) * step]));
    }
  }

  function applyPositions(t: number) {
    const e = d3.easeCubicInOut(t);
    const lerp = (id: string, obj: { x: number; y: number }, fallback?: [number, number]) => {
      const to = target.get(id);
      if (!to) return;
      const from = anim?.from.get(id) ?? fallback ?? to;
      obj.x = from[0] + (to[0] - from[0]) * e;
      obj.y = from[1] + (to[1] - from[1]) * e;
    };
    for (const p of visProbs) lerp(p.id, p);
    for (const o of orgList) if (o.base > 0) lerp(o.key, o, [layout === "center" ? cx : xo, layout === "center" ? cy : H / 2]);
    for (const s of visStreams) buildGeom(s);
    geomVer++;
  }
  let geomVer = 0;
  let paintedGeom = -1;

  function bez(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, n: number) {
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = 1 - t;
      out.push(a * a * a * x0 + 3 * a * a * t * x1 + 3 * a * t * t * x2 + t * t * t * x3, a * a * a * y0 + 3 * a * a * t * y1 + 3 * a * t * t * y2 + t * t * t * y3);
    }
  }

  function buildGeom(s: Stream) {
    const o = s.org, p = s.prob;
    const pts: number[] = [];
    const px = p.x, py = p.y;
    if (style === "comets") {
      if (layout === "center") {
        const dx = px - o.x, dy = py - o.y, L = Math.hypot(dx, dy) || 1;
        const bend = 0.22 * L * (s.seed > 0.5 ? 1 : 0.8);
        const mx = (o.x + px) / 2 - (dy / L) * bend, my = (o.y + py) / 2 + (dx / L) * bend;
        bez(pts, o.x, o.y, o.x + (2 / 3) * (mx - o.x), o.y + (2 / 3) * (my - o.y), px + (2 / 3) * (mx - px), py + (2 / 3) * (my - py), px, py, 36);
      } else {
        const dx = px - o.x;
        bez(pts, o.x, o.y, o.x + dx * 0.45, o.y, px - dx * 0.45, py, px, py, 36);
      }
      s.riverAt = pts.length / 2;
    } else {
      const qx = p.qx, qy = p.qy;
      const ux = px - qx, uy = py - qy, ul = Math.hypot(ux, uy) || 1;
      const d = Math.hypot(qx - o.x, qy - o.y);
      const c1x = layout === "sides" ? o.x + (qx - o.x) * 0.5 : o.x + (qx - o.x) * 0.3;
      const c1y = layout === "sides" ? o.y : o.y + (qy - o.y) * 0.3;
      bez(pts, o.x, o.y, c1x, c1y, qx - (ux / ul) * d * 0.45, qy - (uy / ul) * d * 0.45, qx, qy, 30);
      s.riverAt = pts.length / 2 - 1;
      for (let i = 1; i <= 8; i++) pts.push(qx + (ux * i) / 8, qy + (uy * i) / 8);
    }
    s.pts = Float32Array.from(pts);
    const n = pts.length / 2;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    s.cum = cum;
    s.len = Math.max(1, cum[n - 1]);
    const U = 64, uni = new Float32Array((U + 1) * 2);
    let j = 0;
    for (let i = 0; i <= U; i++) {
      const tgt = (i / U) * cum[n - 1];
      while (j < n - 2 && cum[j + 1] < tgt) j++;
      const seg = cum[j + 1] - cum[j] || 1, t = Math.min(1, Math.max(0, (tgt - cum[j]) / seg));
      uni[2 * i] = pts[2 * j] + (pts[2 * j + 2] - pts[2 * j]) * t;
      uni[2 * i + 1] = pts[2 * j + 1] + (pts[2 * j + 3] - pts[2 * j + 1]) * t;
    }
    s.uni = uni;
  }

  /** Position at arc length fraction f (0..1) of a stream. */
  function at(s: Stream, f: number, out: [number, number]) {
    const u = s.uni, x = Math.max(0, Math.min(1, f)) * 64, i = Math.min(63, x | 0), t = x - i;
    out[0] = u[2 * i] + (u[2 * i + 2] - u[2 * i]) * t;
    out[1] = u[2 * i + 1] + (u[2 * i + 3] - u[2 * i + 1]) * t;
  }

  // ---------- Visibility, dimming, particle budget ----------
  function streamAlpha(s: Stream): number {
    if (selOrg && s.org !== selOrg) return 0;
    if (selProb && !within(s.prob, selProb)) return 0;
    let a = 1;
    if (selItem && !s.recs.includes(selItem)) a *= 0.12;
    if (s.prob.parent === BROAD) a *= 0.4;
    if (hover && hover !== s) a *= 0.45;
    return a;
  }
  /** Like streamAlpha, but ignoring the hover (for deciding what is part of the current selection). */
  function shownAlpha(s: Stream): number {
    const h0 = hover;
    hover = null;
    const a = streamAlpha(s);
    hover = h0;
    return a;
  }
  function probAlpha(p: Problem): number {
    if (selItem) return visStreams.some((s) => s.prob === p && s.recs.includes(selItem!)) ? 1 : 0.3;
    if (selProb && !within(p, selProb)) return selOrg ? 1 : 0.45;
    if (selOrg && !visStreams.some((s) => s.org === selOrg && s.prob === p && s.value > 0)) return 0.3;
    return 1;
  }

  function allocate() {
    const budget = Math.round(Math.min(style === "comets" ? 650 : 850, Math.max(240, (W * H) / 700))); // fixed particle budget
    visStreams = allStreams.filter((s) => s.prob.visible && s.base > 0);
    const vmax = d3.max(visStreams, (s) => s.value) || 1;
    const eff = visStreams.map((s) => (s.value > 0 ? s.value * Math.max(0.08, streamAlpha(s) * (hover ? 1 / 0.45 : 1)) : 0));
    const tot = d3.sum(eff) || 1;
    let used = 0;
    // every live stream gets one particle; the rest of the budget is shared by weight, so the total never exceeds it
    const extra = Math.max(0, budget - eff.filter((e) => e > 0).length);
    visStreams.forEach((s, i) => {
      s.n = eff[i] > 0 ? 1 + Math.floor((extra * eff[i]) / tot) : 0;
      used += s.n;
      const pxps = (reduced ? 0 : 1) * (12 + 26 * Math.sqrt(s.value / vmax)); // slow
      s.speed = pxps / Math.max(60, s.len || 200);
    });
    stats.particles = used;
  }

  /** The items that make up the streams: shown when zoomed in deep, or for the selected group, topic or item. */
  function computeItems() {
    const show = zoomLevel >= 2 || !!selOrg || !!selProb || !!selItem;
    items = [];
    if (!show) return;
    for (const s of visStreams) {
      if (s.value <= 0 || shownAlpha(s) < 0.2) continue;
      const list = s.recs.filter((r) => (recWeight.get(r.id) ?? 0) > 0).sort((a, b) => (recWeight.get(b.id) ?? 0) - (recWeight.get(a.id) ?? 0));
      list.forEach((r, i) => items.push({ key: `${s.org.key}|${s.prob.id}|${r.id}`, s, r, f: 0.3 + (0.45 * (i + 0.5)) / list.length }));
    }
  }

  // ---------- SVG nodes ----------
  const color = (p: Problem) => (p.parent === BROAD ? "#6b7280" : ctx.colorOf(p.parent));
  function paintSvg(labels = true) {
    computeItems();
    // hit paths for hovering streams
    const hits = gHits.selectAll<SVGPathElement, Stream>("path").data(visStreams.filter((s) => s.value > 0 && streamAlpha(s) > 0), (s) => `${s.org.key}|${s.prob.id}`);
    hits.exit().remove();
    const hitsIn = hits.enter().append("path")
      .on("mouseenter", (ev: MouseEvent, s) => {
        hover = s;
        baseDirty = true;
        allocate();
        showTip(ev, s);
      })
      .on("mousemove", (ev: MouseEvent, s) => showTip(ev, s))
      .on("mouseleave", () => {
        hover = null;
        baseDirty = true;
        allocate();
        tip.classList.remove("on");
      })
      .on("click", (ev: MouseEvent, s) => {
        ev.stopPropagation();
        selectProb(s.prob);
      });
    // stream paths only change when things move; playback ticks skip rebuilding them
    const moved = paintedGeom !== geomVer;
    paintedGeom = geomVer;
    (moved ? hitsIn.merge(hits) : hitsIn)
      .attr("d", (s) => {
        let d = "";
        for (let i = 0; i < s.pts.length; i += 2) d += `${i ? "L" : "M"}${s.pts[i].toFixed(1)},${s.pts[i + 1].toFixed(1)}`;
        return d;
      });

    // arcs / brackets around split topics (click to fold back)
    const split = [...probs.values()].filter((p) => p.base > 0 && !p.visible && visProbs.some((q) => q.up && within(q, p)));
    const gs = gGroups.selectAll<SVGGElement, Problem>("g.cr-grp").data(split, (p) => p.id);
    gs.exit().remove();
    const ge = gs.enter().append("g").attr("class", (p) => `cr-grp lv${p.level}`).on("click", (ev: MouseEvent, p) => {
      ev.stopPropagation();
      expanded.delete(p.id);
      for (const k of p.kids) expanded.delete(k.id);
      if (selProb && within(selProb, p)) selProb = null;
      relayout(true);
      renderDetail();
    });
    ge.append("path");
    ge.append("text");
    ge.append("title").text("Click to fold back into one topic");
    ge.merge(gs).each(function (p) {
      const kids = visProbs.filter((q) => q !== p && within(q, p));
      if (!kids.length) return;
      const g = d3.select(this);
      g.select("path").attr("stroke", color(p));
      const inset = 16 + p.level * 14;
      if (layout === "center") {
        const a0 = kids[0].angle - 0.04, a1 = kids[kids.length - 1].angle + 0.04, rr = R - inset;
        g.select("path").attr("d", `M${cx + rr * Math.cos(a0)},${cy + rr * Math.sin(a0)} A${rr},${rr} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${cx + rr * Math.cos(a1)},${cy + rr * Math.sin(a1)}`);
        const am = (a0 + a1) / 2;
        g.select("text").attr("x", cx + (rr - 12) * Math.cos(am)).attr("y", cy + (rr - 12) * Math.sin(am)).attr("text-anchor", "middle").attr("dy", "0.35em").text(`${p.label} ⌃`);
      } else {
        const y0 = (target.get(kids[0].id)?.[1] ?? 0) - 8, y1 = (target.get(kids[kids.length - 1].id)?.[1] ?? 0) + 8;
        const x = xp - 22 - p.level * 8;
        g.select("path").attr("d", `M${x},${y0} L${x - 4},${y0} L${x - 4},${y1} L${x},${y1}`);
        // watershed: put the name where the rivulets gather, not on top of the rivers
        const lx = style === "watershed" ? xp - (xp - xo) * 0.28 - 10 - p.level * 8 : x - 10;
        g.select("text").attr("x", lx).attr("y", (y0 + y1) / 2).attr("text-anchor", "end").attr("dy", "0.35em").text(p.label);
      }
    });

    // items along the streams
    const is = gItems.selectAll<SVGCircleElement, Item>("circle").data(items, (d) => d.key);
    is.exit().remove();
    is.enter().append("circle")
      .on("mouseenter", (ev: MouseEvent, d) => showItemTip(ev, d))
      .on("mousemove", (ev: MouseEvent, d) => showItemTip(ev, d))
      .on("mouseleave", () => tip.classList.remove("on"))
      .on("click", (ev: MouseEvent, d) => {
        ev.stopPropagation();
        selectItem(d.r);
      })
      .merge(is)
      .attr("class", (d) => `cr-item k-${kindKey(d.r)}${d.r === selItem ? " sel" : ""}`)
      .attr("r", (d) => (d.r === selItem ? 4.5 : isMission(d.r) ? 2.4 : 3))
      .attr("fill", (d) => (isMission(d.r) ? "none" : KIND_COLOR[kindKey(d.r)]))
      .attr("stroke", (d) => (isMission(d.r) ? KIND_COLOR.mission : "rgba(10,10,15,0.85)"))
      .attr("opacity", (d) => (selItem && d.r !== selItem ? 0.35 : 0.9));

    // topics
    const ps = gProbs.selectAll<SVGGElement, Problem>("g.cr-prob").data(visProbs, (p) => p.id);
    ps.exit().remove();
    const pe = ps.enter().append("g").attr("class", (p) => `cr-prob lv${p.level}${p.level === 0 ? " parent" : " child"}${p.parent === BROAD ? " broad" : ""}`).attr("data-id", (p) => p.id);
    pe.append("circle").attr("class", "glow").attr("filter", "url(#cr-blur)");
    pe.append("circle").attr("class", "shield");
    pe.append("path").attr("class", "cover");
    pe.append("circle").attr("class", "core");
    pe.append("circle").attr("class", "dry");
    pe.append("circle").attr("class", "cracks");
    pe.append("circle").attr("class", "wet");
    pe.append("g").attr("class", "reeds");
    pe.append("circle").attr("class", "hit");
    pe.append("text").attr("class", "lbl");
    pe.on("click", (ev: MouseEvent, p) => {
      ev.stopPropagation();
      openProb(p);
    })
      .on("mouseenter", (ev: MouseEvent, p) => showProbTip(ev, p))
      .on("mousemove", (ev: MouseEvent, p) => showProbTip(ev, p))
      .on("mouseleave", () => tip.classList.remove("on"));
    const all = pe.merge(ps);
    all.attr("opacity", (p) => probAlpha(p)).classed("sel", (p) => p === selProb).classed("has-kids", (p) => p.kids.filter((k) => k.base > 0).length > 1);
    all.each(function (p) {
      const g = d3.select(this);
      const c = color(p), r = p.r, glow = p.glow;
      g.select(".glow").attr("r", layout === "sides" ? Math.min(r * 1.9, r + 14) : r * 2.2).attr("fill", c).attr("opacity", p.parent === BROAD ? 0 : 0.04 + 0.5 * glow);
      g.select(".shield").attr("r", r + 4).attr("stroke", c).attr("stroke-opacity", 0.12 + 0.75 * glow);
      const arc = d3.arc()({ innerRadius: r + 6, outerRadius: r + 7.5, startAngle: 0, endAngle: 2 * Math.PI * glow }) ?? "";
      g.select(".cover").attr("d", arc).attr("fill", c).attr("opacity", 0.35 + 0.5 * glow);
      g.select(".core").attr("r", r).attr("fill", c).attr("fill-opacity", 0.1 + 0.65 * glow).attr("stroke", c);
      g.select(".dry").attr("r", r + 5);
      g.select(".cracks").attr("r", r + 5).attr("opacity", 0.95 * (1 - glow));
      g.select(".wet").attr("r", (r + 5) * Math.sqrt(glow)).attr("opacity", 0.2 + 0.75 * glow);
      const reeds = g.select(".reeds").selectAll<SVGCircleElement, number>("circle").data(d3.range(Math.floor(glow * 7)).slice(0, 9));
      reeds.exit().remove();
      reeds.enter().append("circle").attr("r", 1.4).merge(reeds)
        .attr("cx", (i) => (r + 6) * Math.cos(i * 2.4 + hash(p.id) * 6))
        .attr("cy", (i) => (r + 6) * Math.sin(i * 2.4 + hash(p.id) * 6));
      g.select(".hit").attr("r", r + 8);
      // fit the label in the space left on screen on its side
      let room = 34;
      const cw = p.level === 0 ? 6.4 : 5.6;
      const sx = tr.applyX(target.get(p.id)?.[0] ?? p.x);
      if (layout === "center") {
        const ca0 = Math.cos(p.angle);
        room = Math.abs(ca0) < 0.1 ? 40 : Math.floor((ca0 > 0 ? W - sx - r - 16 : sx - r - 16) / cw);
      } else room = Math.floor((W - sx - r - 16) / cw);
      room = Math.max(10, Math.min(40, room));
      const lbl = g.select<SVGTextElement>(".lbl").text(p.label.length > room ? `${p.label.slice(0, room - 1)}…` : p.label);
      if (layout === "center") {
        const ca = Math.cos(p.angle), sa = Math.sin(p.angle), d = r + 11;
        const vert = Math.abs(ca) < 0.1;
        lbl.attr("x", vert ? 0 : ca * d).attr("y", vert ? (sa > 0 ? d + 4 : -d - 4) : sa * d).attr("dy", "0.35em")
          .attr("text-anchor", vert ? "middle" : ca > 0 ? "start" : "end");
      } else lbl.attr("x", r + 11).attr("y", 0).attr("dy", "0.35em").attr("text-anchor", "start");
      // crowded: smaller labels so neighbours don't overlap
      const spacing = layout === "sides" ? ((H - 48) * tr.k) / Math.max(1, visProbs.length) : (2 * Math.PI * R * tr.k) / Math.max(1, visProbs.length);
      if (spacing < 16) lbl.style("font-size", `${Math.max(7.5, Math.min(p.level === 0 ? 12 : 10.5, spacing * 0.92))}px`);
      else lbl.style("font-size", null);
    });

    // organizations, with their logos
    const live = orgList.filter((o) => o.base > 0);
    const os = gOrgs.selectAll<SVGGElement, Org>("g.cr-org").data(live, (o) => o.key);
    os.exit().remove();
    const oe = os.enter().append("g").attr("class", (o) => `cr-org${o.logo ? " has-logo" : ""}`).attr("data-key", (o) => o.key);
    oe.append("circle").attr("class", "dot");
    oe.filter((o) => !!o.logo).append("image").attr("class", "logo").attr("href", (o) => o.logo!).attr("clip-path", "url(#cr-logo-clip)").attr("preserveAspectRatio", "xMidYMid meet");
    oe.append("circle").attr("class", "hit");
    oe.append("text").attr("class", "lbl");
    oe.on("click", (ev: MouseEvent, o) => {
      ev.stopPropagation();
      selectOrg(o);
    })
      .on("mouseenter", (ev: MouseEvent, o) => showOrgTip(ev, o))
      .on("mousemove", (ev: MouseEvent, o) => showOrgTip(ev, o))
      .on("mouseleave", () => tip.classList.remove("on"));
    const oall = oe.merge(os);
    feeding = selProb || selItem ? new Set(visStreams.filter((s) => shownAlpha(s) > 0.2 && s.value > 0).map((s) => s.org.key)) : null;
    oall.classed("sel", (o) => o === selOrg).attr("opacity", orgOpacity);
    const osz = moved ? oall : oe;
    osz.select(".dot").attr("r", (o) => o.r);
    osz.select(".logo").attr("x", (o) => -o.r * 0.86).attr("y", (o) => -o.r * 0.86).attr("width", (o) => o.r * 1.72).attr("height", (o) => o.r * 1.72);
    osz.select(".hit").attr("r", (o) => Math.max(6, o.r + 3));
    placeSvg();
    if (labels) placeOrgLabels();
  }
  let feeding: Set<string> | null = null;
  const orgOpacity = (o: Org) => (selOrg ? (o === selOrg ? 1 : 0.25) : feeding ? (feeding.has(o.key) ? 1 : 0.2) : o.energy > 0 ? 1 : 0.35);

  /** How much group nodes grow as you zoom in, so logos become readable. */
  const orgScale = () => Math.max(1, Math.min(2.6, Math.pow(tr.k, 0.75)));

  /** Group names, in screen space: more fit as you zoom in. */
  function placeOrgLabels() {
    const live = orgList.filter((o) => o.base > 0);
    const s = orgScale();
    const cand = new Set<string>();
    if (tr.k >= 1.5) for (const o of live) cand.add(o.key);
    else for (const o of [...live].sort((a, b) => b.base - a.base).slice(0, layout === "center" ? 8 : 14)) cand.add(o.key);
    if (selOrg) cand.add(selOrg.key);
    if (selProb || selItem) for (const st of visStreams.filter((x) => shownAlpha(x) > 0.2 && x.value > 0).sort((a, b) => b.value - a.value).slice(0, 14)) cand.add(st.org.key);
    for (const o of live) if (orgOpacity(o) < 0.3) cand.delete(o.key);
    const boxes: [number, number, number, number][] = [];
    const show = new Set<string>();
    const order = [...live].sort((a, b) => (a === selOrg ? -1 : b === selOrg ? 1 : b.base - a.base));
    for (const o of order) {
      if (!cand.has(o.key)) continue;
      const [lx, ly] = target.get(o.key) ?? [o.x, o.y];
      const x = tr.applyX(lx), y = tr.applyY(ly);
      if (x < -50 || x > W + 50 || y < -20 || y > H + 20) continue;
      const w = Math.min(30, o.name.length) * 5.6;
      const box: [number, number, number, number] = layout === "center"
        ? [x - w / 2, y - o.r * s - 16, x + w / 2, y - o.r * s - 3]
        : [x - o.r * s - 8 - w, y - 7, x - o.r * s - 6, y + 7];
      if (boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
      boxes.push(box);
      show.add(o.key);
    }
    gOrgs.selectAll<SVGGElement, Org>("g.cr-org").select<SVGTextElement>(".lbl")
      .text((o) => (o.name.length > 30 ? `${o.name.slice(0, 28)}…` : o.name))
      .style("display", (o) => (show.has(o.key) ? null : "none"))
      .attr("text-anchor", layout === "center" ? "middle" : "end")
      .attr("x", (o) => (layout === "center" ? 0 : Math.min(-o.r - 6, (xo - 26 - 8 - (target.get(o.key)?.[0] ?? o.x)) * tr.k / s)))
      .attr("y", (o) => (layout === "center" ? -o.r - 5 : 0))
      .attr("dy", layout === "center" ? "0" : "0.35em")
      .style("font-size", `${10 / s}px`)
      .style("stroke-width", `${3 / s}px`);
  }

  const IP: [number, number] = [0, 0];
  function placeSvg() {
    const s = orgScale();
    gProbs.selectAll<SVGGElement, Problem>("g.cr-prob").attr("transform", (p) => `translate(${tr.applyX(p.x)},${tr.applyY(p.y)})`);
    gOrgs.selectAll<SVGGElement, Org>("g.cr-org").attr("transform", (o) => `translate(${tr.applyX(o.x)},${tr.applyY(o.y)}) scale(${s})`);
    gGroups.selectAll<SVGTextElement, unknown>("text").style("font-size", `${10 / tr.k}px`).style("stroke-width", `${3 / tr.k}px`);
    gItems.selectAll<SVGCircleElement, Item>("circle").each(function (d) {
      at(d.s, d.f, IP);
      this.setAttribute("cx", String(tr.applyX(IP[0])));
      this.setAttribute("cy", String(tr.applyY(IP[1])));
    });
  }

  // ---------- Tooltips ----------
  function placeTip(ev: MouseEvent) {
    const r = viewport.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    tip.classList.add("on");
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.min(W - tw - 8, x + 14)}px`;
    tip.style.top = `${Math.max(8, Math.min(H - th - 8, y + 14))}px`;
  }
  function topItems(list: TopicRecord[], n: number): TopicRecord[] {
    return [...list].filter((r) => (recWeight.get(r.id) ?? 0) > 0).sort((a, b) => (recWeight.get(b.id) ?? 0) - (recWeight.get(a.id) ?? 0)).slice(0, n);
  }
  const path = (p: Problem) => {
    const out: string[] = [];
    for (let x: Problem | null = p.up; x; x = x.up) out.unshift(x.label);
    return out.join(" › ");
  };
  function showTip(ev: MouseEvent, s: Stream) {
    clear(tip);
    tip.append(h("div", { class: "cr-tip-title" }, `${s.org.name} → ${s.prob.label}`), h("div", { class: "cr-tip-meta" }, `energy ${s.value.toFixed(2)} · ${s.recs.length} item${s.recs.length === 1 ? "" : "s"}`));
    for (const r of topItems(s.recs, 3)) tip.appendChild(h("div", { class: "cr-tip-item" }, `${KIND_LABEL[r.kind]}: ${isMission(r) ? "mission statement" : r.name}`));
    placeTip(ev);
  }
  function showProbTip(ev: MouseEvent, p: Problem) {
    clear(tip);
    const n = new Set(allStreams.filter((s) => s.prob === p && s.value > 0).map((s) => s.org)).size;
    const finer = p.kids.filter((k) => k.base > 0).length;
    tip.append(
      h("div", { class: "cr-tip-meta" }, path(p) || "Main topic"),
      h("div", { class: "cr-tip-title" }, p.label),
      h("div", { class: "cr-tip-meta" }, `energy ${p.energy.toFixed(1)} from ${n} group${n === 1 ? "" : "s"}`),
      h("div", { class: "cr-tip-item" }, finer > 1 ? `Click to zoom into its ${finer} ${p.level === 1 ? "bills" : "topics"} and see who feeds it` : "Click to see who feeds it"),
    );
    placeTip(ev);
  }
  function showOrgTip(ev: MouseEvent, o: Org) {
    clear(tip);
    const n = allStreams.filter((s) => s.org === o && s.prob.level === 0 && s.value > 0).length;
    tip.append(h("div", { class: "cr-tip-title" }, o.name), h("div", { class: "cr-tip-meta" }, `energy ${o.energy.toFixed(1)} into ${n} main topic${n === 1 ? "" : "s"}`), h("div", { class: "cr-tip-item" }, "Click to show only its streams and items"));
    placeTip(ev);
  }
  function showItemTip(ev: MouseEvent, d: Item) {
    clear(tip);
    const r = d.r;
    tip.append(
      h("div", { class: "cr-tip-meta" }, `${KIND_LABEL[r.kind]}${r.date ? ` · ${r.date}` : ""}${r.recurring ? " · repeats" : ""}`),
      h("div", { class: "cr-tip-title" }, isMission(r) ? `Mission of ${r.host_name}` : r.name),
      h("div", { class: "cr-tip-meta" }, isMission(r) ? "" : r.host_name),
      h("div", { class: "cr-tip-item" }, `→ ${d.s.prob.label}`),
    );
    placeTip(ev);
  }

  // ---------- Selection + detail panel ----------
  /** Click a topic: select it, and if it holds finer topics, split it and zoom in on it. */
  function openProb(p: Problem) {
    const finer = p.kids.filter((k) => k.base > 0).length > 1;
    if (finer) expanded.add(p.id);
    selOrg = null;
    selItem = null;
    selProb = selProb === p && !finer ? null : p;
    relayout(true);
    renderDetail();
    if (finer) focusOn(p);
  }
  function focusOn(p: Problem) {
    const kids = visProbs.filter((q) => within(q, p));
    if (!kids.length) return;
    const mx = d3.mean(kids, (q) => target.get(q.id)![0])!, my = d3.mean(kids, (q) => target.get(q.id)![1])!;
    let fx: number, fy: number;
    if (layout === "center") {
      fx = cx + (mx - cx) * 0.62;
      fy = cy + (my - cy) * 0.62;
    } else {
      fx = xp - (xp - xo) * 0.3;
      fy = my;
    }
    // stay below the zoom that splits everything, so only this topic opens
    const k = tr.k >= 1.5 ? tr.k : 1.55;
    const t = d3.zoomIdentity.translate(W / 2 - k * fx, H / 2 - k * fy).scale(k);
    if (reduced) svg.call(zoom.transform, t);
    else svg.transition().duration(800).ease(d3.easeCubicInOut).call(zoom.transform, t);
  }
  function selectProb(p: Problem) {
    selOrg = null;
    selItem = null;
    selProb = selProb === p ? null : p;
    refresh();
    renderDetail();
  }
  function selectOrg(o: Org) {
    selProb = null;
    selItem = null;
    selOrg = selOrg === o ? null : o;
    refresh();
    renderDetail();
  }
  function selectItem(r: TopicRecord) {
    selProb = null;
    selOrg = null;
    selItem = selItem === r ? null : r;
    refresh();
    renderDetail();
  }
  function clearSel() {
    selOrg = null;
    selProb = null;
    selItem = null;
    refresh();
    renderDetail();
  }

  function recordRow(r: TopicRecord, showHost: boolean): HTMLElement {
    const w = recWeight.get(r.id) ?? 0;
    const groupBtn = h("button", { class: "topics-group", type: "button", title: "See this group on the map" }, r.host_name);
    if (ctx.cb.hasGroup(r.host)) groupBtn.addEventListener("click", () => ctx.cb.onGroupClick(r.host));
    else groupBtn.setAttribute("disabled", "true");
    const m = isMission(r);
    return h("div", { class: `topics-record${w <= 0 ? " zero" : ""}${r.climate_relevance !== "core" ? " related" : ""}` },
      h("div", { class: "meta-row" },
        h("span", { class: `pill k-${m ? "mission" : r.kind}` }, KIND_LABEL[r.kind]),
        r.recurring ? h("span", { class: "pill" }, "repeats") : null,
        r.date ? h("span", { class: "pill deadline" }, r.date) : null,
        r.climate_relevance !== "core" ? h("span", { class: "pill" }, "related issue") : null),
      m ? null : h("div", { class: "name" }, r.link ? h("a", { href: r.link, target: "_blank", rel: "noopener noreferrer" }, `${r.name} ↗`) : r.name),
      showHost || m ? h("div", { class: "topics-host" }, m ? "Mission of " : "", groupBtn) : null);
  }
  function mapButton(host: string, label: string, cls: string): HTMLElement {
    const b = h("button", { type: "button", class: cls, title: "See this group on the map" }, label);
    if (ctx.cb.hasGroup(host)) b.addEventListener("click", () => ctx.cb.onGroupClick(host));
    else b.setAttribute("disabled", "true");
    return b;
  }
  function logoImg(o: Org): HTMLElement | null {
    return o.logo ? h("img", { class: "cr-detail-logo", src: o.logo, alt: "" }) : null;
  }

  function renderDetail() {
    const d = ctx.detail;
    clear(d);
    if (!selOrg && !selProb && !selItem) {
      d.classList.remove("open");
      return;
    }
    d.classList.add("open");
    const close = h("button", { class: "detail-close", type: "button", "aria-label": "Close" }, "×");
    close.addEventListener("click", clearSel);
    d.appendChild(close);
    if (selProb) {
      const p = selProb;
      const feeders = allStreams.filter((s) => s.prob === p && s.value > 0).sort((a, b) => b.value - a.value);
      d.append(h("div", { class: "topics-detail-parent" }, path(p) || "Topic"), h("h3", {}, p.label),
        h("div", { class: "topics-detail-meta" }, `energy ${p.energy.toFixed(1)} from ${feeders.length} group${feeders.length === 1 ? "" : "s"}`));
      const finer = p.kids.filter((k) => k.base > 0).sort((a, b) => b.energy - a.energy);
      if (finer.length > 1) {
        d.appendChild(h("div", { class: "cr-sub" }, p.level === 1 ? "Bills inside it" : "Topics inside it"));
        const box = h("div", { class: "cr-chips" });
        for (const k of finer) {
          const b = h("button", { type: "button" }, `${k.label} · ${k.energy.toFixed(1)}`);
          b.addEventListener("click", () => openProb(k));
          box.appendChild(b);
        }
        d.appendChild(box);
      }
      d.appendChild(h("div", { class: "cr-sub" }, "Who feeds it"));
      const max = feeders[0]?.value || 1;
      const fl = h("div", { class: "cr-feeders" });
      for (const s of feeders) {
        const name = h("button", { type: "button", class: "cr-feeder-name", title: "Show only this group's streams" }, s.org.name);
        name.addEventListener("click", () => selectOrg(s.org));
        fl.appendChild(h("div", { class: "cr-feeder" }, logoImg(s.org) ?? h("span", { class: "cr-feeder-dot" }), name,
          h("span", { class: "cr-feeder-bar", style: `width:${Math.max(3, (60 * s.value) / max)}px` }), mapButton(s.org.host, "map ↗", "cr-feeder-map")));
      }
      d.appendChild(fl);
      const its = [...new Set(feeders.flatMap((s) => s.recs))].sort((a, b) => (recWeight.get(b.id) ?? 0) - (recWeight.get(a.id) ?? 0) || a.name.localeCompare(b.name));
      d.appendChild(h("div", { class: "cr-sub" }, `Items (${its.length})`));
      const list = h("div", { class: "topics-records" });
      for (const r of its) list.appendChild(recordRow(r, true));
      d.appendChild(list);
    } else if (selOrg) {
      const o = selOrg;
      const mine = visStreams.filter((s) => s.org === o && s.value > 0).sort((a, b) => b.value - a.value);
      d.append(h("div", { class: "cr-detail-head" }, logoImg(o), h("div", {}, h("div", { class: "topics-detail-parent" }, "Group"), h("h3", {}, o.name))),
        h("div", { class: "topics-detail-meta" }, `energy ${o.energy.toFixed(1)} into ${mine.length} topic${mine.length === 1 ? "" : "s"}`),
        mapButton(o.host, "See this group on the map ↗", "cr-mapbtn"));
      for (const s of mine) {
        d.appendChild(h("div", { class: "cr-sub" }, `→ ${s.prob.label} · ${s.value.toFixed(2)}`));
        const list = h("div", { class: "topics-records" });
        for (const r of [...s.recs].sort((a, b) => (recWeight.get(b.id) ?? 0) - (recWeight.get(a.id) ?? 0))) list.appendChild(recordRow(r, false));
        d.appendChild(list);
      }
    } else if (selItem) {
      const r = selItem;
      const org = orgs.get(`${r.map}:${r.host}`);
      d.append(h("div", { class: "topics-detail-parent" }, KIND_LABEL[r.kind]), h("h3", {}, isMission(r) ? `Mission of ${r.host_name}` : r.name));
      d.appendChild(recordRow(r, true));
      if (org) {
        const b = h("button", { type: "button", class: "cr-mapbtn" }, `Show all of ${org.name}'s streams`);
        b.addEventListener("click", () => selectOrg(org));
        d.appendChild(b);
      }
      d.appendChild(h("div", { class: "cr-sub" }, "Feeds these topics"));
      const box = h("div", { class: "cr-chips" });
      for (const s of (recStreams.get(r.id) ?? []).slice().sort((a, b) => a.prob.level - b.prob.level)) {
        const b = h("button", { type: "button" }, `${"· ".repeat(s.prob.level)}${s.prob.label}`);
        b.addEventListener("click", () => openProb(s.prob));
        box.appendChild(b);
      }
      d.appendChild(box);
    }
  }

  // ---------- Canvas ----------
  const sprites = new Map<string, HTMLCanvasElement>();
  function sprite(col0: string): HTMLCanvasElement {
    let c = sprites.get(col0);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    const col = d3.color(col0)!;
    rg.addColorStop(0, "rgba(255,255,255,0.95)");
    rg.addColorStop(0.18, col.copy({ opacity: 0.9 }).formatRgb());
    rg.addColorStop(0.5, col.copy({ opacity: 0.25 }).formatRgb());
    rg.addColorStop(1, col.copy({ opacity: 0 }).formatRgb());
    g.fillStyle = rg;
    g.fillRect(0, 0, 32, 32);
    sprites.set(col0, c);
    return c;
  }
  const colorCache = new Map<string, string>();
  const pColor = (p: Problem) => {
    let c = colorCache.get(p.parent);
    if (!c) colorCache.set(p.parent, (c = p.parent === BROAD ? "#9ca3af" : ctx.colorOf(p.parent)));
    return c;
  };

  function drawBase() {
    const tb = performance.now();
    const g = base.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, base.width, base.height);
    g.setTransform(dpr * tr.k, 0, 0, dpr * tr.k, dpr * tr.x, dpr * tr.y);
    g.lineCap = "round";
    g.lineJoin = "round";
    const vmax = d3.max(visStreams, (s) => s.value) || 1;
    const line = (s: Stream, from: number, to: number) => {
      g.beginPath();
      g.moveTo(s.pts[2 * from], s.pts[2 * from + 1]);
      for (let i = from + 1; i <= to; i++) g.lineTo(s.pts[2 * i], s.pts[2 * i + 1]);
      g.stroke();
    };
    // faint rings so the field has structure
    g.strokeStyle = "rgba(148,163,184,0.07)";
    g.lineWidth = 1 / tr.k;
    if (layout === "center") {
      for (const rr of [R, R * 0.66]) {
        g.beginPath();
        g.arc(cx, cy, rr, 0, Math.PI * 2);
        g.stroke();
      }
    }
    const list = visStreams.filter((s) => s.value > 0);
    if (style === "comets") {
      g.globalCompositeOperation = "lighter";
      for (const s of list) {
        const a = streamAlpha(s);
        if (a <= 0) continue;
        const k = Math.sqrt(s.value / vmax);
        const c = d3.color(pColor(s.prob))!;
        c.opacity = (s === hover ? 0.75 : (0.035 + 0.16 * k) * a) * (reduced ? 1.6 : 1);
        g.strokeStyle = c.formatRgb();
        g.lineWidth = (s === hover ? 2.2 : 0.5 + 1.6 * k) / tr.k;
        line(s, 0, s.pts.length / 2 - 1);
      }
    } else {
      // rivulets
      for (const s of list) {
        const a = streamAlpha(s);
        if (a <= 0) continue;
        const k = Math.sqrt(s.value / vmax);
        g.strokeStyle = s === hover ? "rgba(186,230,253,0.85)" : `rgba(96,165,250,${(0.08 + 0.3 * k) * a})`;
        g.lineWidth = (s === hover ? 2.6 : 0.5 + 2.4 * k) / tr.k;
        line(s, 0, s.riverAt);
      }
      // rivers: one per topic, as wide as the water reaching it
      const flow = new Map<Problem, number>();
      for (const s of list) if (streamAlpha(s) > 0) flow.set(s.prob, (flow.get(s.prob) ?? 0) + s.value * Math.min(1, streamAlpha(s) * 2.5));
      const fmax = d3.max([...flow.values()]) || 1;
      for (const [p, f] of flow) {
        const k = Math.sqrt(f / fmax);
        for (const [wd, col] of [[2 + 9 * k, "rgba(37,99,235,0.35)"], [1 + 4 * k, "rgba(56,189,248,0.45)"], [0.6 + 1.2 * k, "rgba(186,230,253,0.35)"]] as [number, string][]) {
          g.strokeStyle = col;
          g.lineWidth = wd / tr.k;
          g.beginPath();
          g.moveTo(p.qx, p.qy);
          g.lineTo(p.x, p.y);
          g.stroke();
        }
      }
    }
    g.globalCompositeOperation = "source-over";
    baseDirty = false;
    baseStale = false;
    lastBase = performance.now();
    stats.baseMs = performance.now() - tb;
  }

  const P: [number, number] = [0, 0];
  function drawFrame(time: number) {
    const g = canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (baseDirty) drawBase();
    g.drawImage(base, 0, 0);
    g.setTransform(dpr * tr.k, 0, 0, dpr * tr.k, dpr * tr.x, dpr * tr.y);
    g.globalCompositeOperation = "lighter";
    const sz = 1 / tr.k;
    const comets = style === "comets";
    const water = sprite("#7dd3fc");
    for (const s of visStreams) {
      if (!s.n || s.value <= 0) continue;
      const a = streamAlpha(s) * (s === hover ? 1.6 : 1);
      if (a <= 0) continue;
      const spr = comets ? sprite(pColor(s.prob)) : water;
      const tail = 16 / s.len;
      for (let i = 0; i < s.n; i++) {
        const ph = (time * s.speed + i / s.n + s.seed * 0.618) % 1;
        if (comets) {
          for (let k = 2; k >= 0; k--) {
            const f = ph - k * tail * 0.6;
            if (f < 0) continue;
            at(s, f, P);
            const size = (7.5 - k * 1.8) * sz;
            g.globalAlpha = Math.min(1, (0.6 - k * 0.2) * a);
            g.drawImage(spr, P[0] - size / 2, P[1] - size / 2, size, size);
          }
        } else {
          at(s, ph, P);
          const size = (ph * s.len > (s.cum[s.riverAt] ?? 0) ? 6 : 4.5) * sz;
          g.globalAlpha = Math.min(1, 0.4 * a);
          g.drawImage(spr, P[0] - size / 2, P[1] - size / 2, size, size);
        }
      }
    }
    // ripples: new items arriving, recurring events pulsing
    const now = performance.now();
    ripples = ripples.filter((r) => now - r.t0 < 2600);
    for (const r of ripples) {
      if (!r.prob.visible) continue;
      const age = (now - r.t0) / 2600;
      g.globalAlpha = (r.big ? 0.5 : 0.28) * (1 - age) * probAlpha(r.prob);
      g.strokeStyle = style === "comets" ? pColor(r.prob) : "#7dd3fc";
      g.lineWidth = (r.big ? 1.6 : 1) * sz;
      g.beginPath();
      g.arc(r.prob.x, r.prob.y, (r.prob.r + 4 + age * (r.big ? 26 : 16)) * sz, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  // ---------- Animation loop ----------
  let last = 0;
  let clock = 0;
  let raf = 0;
  const pulsePhase = new Map<string, number>();
  function frame(now: number) {
    raf = 0;
    if (!shown || !el.isConnected || el.offsetParent === null) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    if (last) stats.intervalMs = stats.intervalMs ? stats.intervalMs * 0.95 + (now - last) * 0.05 : now - last;
    last = now;
    const t0 = performance.now();
    clock += dt;
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.dur);
      applyPositions(t);
      placeSvg();
      baseDirty = true;
      if (t >= 1) {
        anim = null;
        allocate();
        paintSvg();
      }
    }
    if (playing && tNow !== null) {
      const before = Math.floor((tNow - T0) / DAY);
      tNow = Math.min(T1, tNow + dt * 9 * DAY); // about 9 days a second
      const after = Math.floor((tNow - T0) / DAY);
      if (after !== before) {
        const td = performance.now();
        onDay(before, after);
        stats.onDayMs = performance.now() - td;
      }
      if (tNow >= T1) setPlaying(false);
    }
    // whole-year view: topics with recurring events pulse gently
    if (tNow === null) {
      for (const p of visProbs) {
        if (!p.recurring) continue;
        const period = 7 + hash(p.id) * 4;
        const ph = Math.floor((clock + hash(p.id) * period) / period);
        if (pulsePhase.get(p.id) !== ph) {
          if (pulsePhase.has(p.id)) ripples.push({ prob: p, t0: performance.now(), big: false });
          pulsePhase.set(p.id, ph);
        }
      }
    }
    if (baseStale && now - lastBase > 400) baseDirty = true;
    const tdraw = performance.now();
    drawFrame(clock);
    stats.drawMs = stats.drawMs * 0.9 + (performance.now() - tdraw) * 0.1;
    const work = performance.now() - t0;
    stats.frames++;
    stats.workMs += work;
    stats.avgMs = stats.workMs / stats.frames;
    stats.maxMs = Math.max(stats.maxMs, work);
    raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (reduced) {
      if (anim) {
        applyPositions(1);
        anim = null;
        allocate();
        paintSvg();
      }
      drawFrame(0);
      return;
    }
    if (!raf && shown) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  // ---------- Time playback ----------
  function onDay(before: number, after: number) {
    const t0 = performance.now();
    compute(tNow, false);
    allocate();
    const t1 = performance.now();
    paintSvg(false);
    stats.paintMs = performance.now() - t1;
    stats.dayMs = t1 - t0;
    // stream widths change slowly while playing: redraw the stream layer a few times a second, not every day
    if (reduced || !playing) baseDirty = true;
    else baseStale = true;
    syncTimeUi();
    // ripples for items that start today, and weekly pulses for repeating events
    const hit = new Set<Problem>();
    const small = new Set<Problem>();
    for (const r of recs) {
      if (!r.date) continue;
      const day = Math.floor((Date.parse(r.date) - T0) / DAY);
      const fresh = day > before && day <= after;
      const pulse = r.recurring && day <= after && (after - day) % 7 === 0 && !fresh;
      if (!fresh && !pulse) continue;
      for (const s of recStreams.get(r.id) ?? []) if (s.prob.visible) (fresh ? hit : small).add(s.prob);
    }
    const now = performance.now();
    for (const p of hit) ripples.push({ prob: p, t0: now, big: true });
    for (const p of small) if (!hit.has(p)) ripples.push({ prob: p, t0: now, big: false });
    if (reduced) drawFrame(0);
  }
  let stepTimer = 0;
  function setPlaying(v: boolean) {
    playing = v;
    playBtn.textContent = v ? "❚❚" : "▶";
    playBtn.setAttribute("aria-label", v ? "Pause" : "Play the year");
    if (v) {
      if (tNow === null || tNow >= T1) {
        tNow = T0;
        onDay(-1, 0);
      }
      if (reduced) {
        stepTimer = window.setInterval(() => {
          if (tNow === null) return;
          const before = Math.floor((tNow - T0) / DAY);
          tNow = Math.min(T1, tNow + 4 * DAY);
          onDay(before, Math.floor((tNow - T0) / DAY));
          if (tNow >= T1) setPlaying(false);
        }, 400);
      } else kick();
    } else {
      if (stepTimer) clearInterval(stepTimer);
      stepTimer = 0;
      baseDirty = true;
      kick();
    }
    syncTimeUi();
  }
  function syncTimeUi() {
    allBtn.classList.toggle("on", tNow === null);
    if (tNow === null) {
      range.value = range.max;
      dateLbl.textContent = `${d3.timeFormat("%b %Y")(new Date(T0))} – ${d3.timeFormat("%b %Y")(new Date(T1))}`;
    } else {
      range.value = String(Math.round((tNow - T0) / DAY));
      dateLbl.textContent = fmtDay(new Date(tNow));
    }
  }
  playBtn.addEventListener("click", () => setPlaying(!playing));
  range.addEventListener("input", () => {
    setPlaying(false);
    const before = tNow === null ? -1 : Math.floor((tNow - T0) / DAY);
    tNow = T0 + parseInt(range.value, 10) * DAY;
    onDay(before, Math.floor((tNow - T0) / DAY));
  });
  allBtn.addEventListener("click", () => {
    setPlaying(false);
    tNow = null;
    refresh();
    syncTimeUi();
  });

  // ---------- Zoom: main topics → sub-topics → bills and items ----------
  const DEPTH = ["Main topics", "Sub-topics", "Bills and items"];
  const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.7, 6]).on("zoom", (ev: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
    tr = ev.transform;
    zg.attr("transform", tr.toString());
    placeSvg();
    tip.classList.remove("on");
    baseDirty = true;
    // hysteresis so the view doesn't flicker at the thresholds
    const k = tr.k;
    let want = zoomLevel;
    if (k >= DEEP_K) want = 2;
    else if (k >= SPLIT_K) want = zoomLevel === 2 && k > DEEP_K - 0.25 ? 2 : 1;
    else if (k < SPLIT_K - 0.25) want = 0;
    else if (zoomLevel === 2) want = 1;
    if (want !== zoomLevel) {
      zoomLevel = want;
      depthLbl.textContent = DEPTH[zoomLevel];
      splitSeg.sync();
      relayout(true);
    }
    kick();
  }).on("end", () => {
    paintSvg();
    baseDirty = true;
    kick();
  });
  svg.call(zoom).on("dblclick.zoom", null);
  function resetZoom() {
    if (tr.k === 1 && tr.x === 0 && tr.y === 0) return;
    svg.call(zoom.transform, d3.zoomIdentity);
  }
  const zoomBy = (f: number) => (reduced ? svg : svg.transition().duration(450)).call(zoom.scaleBy as never, f);
  zIn.addEventListener("click", () => zoomBy(1.6));
  zOut.addEventListener("click", () => zoomBy(1 / 1.6));
  zReset.addEventListener("click", () => {
    expanded.clear();
    splitAll = false;
    splitSeg.sync();
    if (tr.k === 1 && tr.x === 0 && tr.y === 0) relayout(true);
    else (reduced ? svg : svg.transition().duration(600)).call(zoom.transform as never, d3.zoomIdentity);
  });
  bg.on("dblclick", resetZoom);
  bg.on("click", () => {
    if (selOrg || selProb || selItem) clearSel();
    else if (expanded.size) {
      expanded.clear();
      relayout(true);
    }
  });

  // ---------- Updates ----------
  /** Selection or time changed: repaint without moving anything. */
  function refresh() {
    compute(tNow, false);
    allocate();
    paintSvg();
    baseDirty = true;
    kick();
  }
  /** Layout, style or the set of shown topics changed: move things to their new places. */
  function relayout(animate: boolean) {
    const from = new Map<string, [number, number]>();
    for (const p of probs.values()) if (p.visible && Number.isFinite(p.x)) from.set(p.id, [p.x, p.y]);
    for (const o of orgList) if (Number.isFinite(o.x)) from.set(o.key, [o.x, o.y]);
    // a split topic's finer topics start from where it was; a folded topic from its first finer topic
    const spread = (p: Problem) => {
      for (const k of p.kids) {
        if (!from.has(k.id) && from.has(p.id)) from.set(k.id, from.get(p.id)!);
        spread(k);
      }
      if (!from.has(p.id)) {
        const k = p.kids.find((x) => from.has(x.id));
        if (k) from.set(p.id, from.get(k.id)!);
      }
    };
    for (const p of parents) spread(p);
    computeTargets();
    compute(tNow, false);
    visStreams = allStreams.filter((s) => s.prob.visible && s.base > 0);
    if (animate && !reduced && from.size) {
      anim = { t0: performance.now(), from, dur: 750 };
      applyPositions(0);
    } else {
      anim = null;
      applyPositions(1);
    }
    if (selProb && !selProb.visible && !visProbs.some((q) => within(q, selProb!))) {
      selProb = null;
      renderDetail();
    }
    allocate();
    paintSvg();
    baseDirty = true;
    kick();
  }

  function legendText() {
    clear(legend);
    legend.append(
      h("div", {}, style === "comets" ? "Each comet stream: one group → one topic, sized by its weighted activity (the sliders on the left)." : "Rivulets from each group join into one river per topic, sized by weighted activity (the sliders on the left)."),
      h("div", {}, style === "comets" ? "A topic's shield glows brighter the more energy reaches it." : "A topic's delta turns greener and wetter the more energy reaches it; quiet ones stay dry."),
      h("div", {}, "Zoom in (scroll, or the + button) to split main topics into sub-topics, then into individual bills, with each project, event, action and mission statement as a dot on its stream: pink events, green projects, yellow actions, hollow missions."),
      h("div", {}, "Undated projects, actions and mission statements are always on; events appear at their dates when you play the year, and repeating events pulse."),
      h("div", { class: "cr-legend-hint" }, "Hover a stream or dot · click a group, topic or dot · drag to pan · double-click the background to reset the zoom"),
    );
  }

  function full() {
    measure();
    compute(null, true);
    for (const o of orgList) {
      o.x = NaN;
      o.y = NaN;
    }
    depthLbl.textContent = DEPTH[0];
    relayout(false);
    legendText();
    syncTimeUi();
  }
  let first = true;
  new ResizeObserver(() => {
    if (!shown || el.offsetParent === null) return;
    const r = viewport.getBoundingClientRect();
    if (Math.abs(r.width - W) < 2 && Math.abs(r.height - H) < 2) return;
    measure();
    target.clear();
    relayout(false);
  }).observe(viewport);

  return {
    el,
    /** Slider weights changed. */
    update() {
      if (first) return;
      compute(null, true);
      target.clear();
      relayout(true);
      if (selOrg || selProb || selItem) renderDetail();
    },
    show() {
      shown = true;
      if (first) {
        first = false;
        full();
      } else {
        measure();
        relayout(false);
      }
      kick();
    },
    hide() {
      shown = false;
      setPlaying(false);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      tip.classList.remove("on");
    },
  };
}
