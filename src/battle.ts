// Topics page, "Command room" view: problems on the left, under fire from the groups in the centre, while the same
// groups pour bright energy along rivers into what they are building on the right.
// Each record's weight (the Topics sliders) is split by its strategies: confronting ones (advocacy, organizing,
// elections, legal, finance) fire at the problem; building ones (education, community building, stewardship,
// service, training, individual action, research) feed the vision. "Every item both ways" shows the full weight on
// both sides instead.
// Calm by design: a fixed particle budget on canvas, low opacity, additive glow, and a still picture for
// prefers-reduced-motion. Buttons switch between projectile, river and garden styles.
import * as d3 from "d3";
import { h, clear } from "./dom";
import type { TopicRecord, TopicsFile, TopicsCallbacks } from "./topics";
import { PROBLEMS, VISIONS, FIGHT_STRATEGIES } from "./problems";

export interface BattleCtx {
  file: TopicsFile;
  mapIds: string[];
  weight(r: TopicRecord): number;
  cap(): number;
  colorOf(parentId: string): string;
  detail: HTMLElement;
  cb: TopicsCallbacks;
}

type Attack = "comets" | "arrows" | "seeds";
type Feed = "rainbow" | "aurora" | "fireflies";
type Garden = "blooms" | "stars";
type Split = "strategy" | "both";
type Show = "both" | "fight" | "feed";

interface Org {
  key: string;
  host: string;
  name: string;
  logo?: string;
  fight: number;
  build: number;
  base: number;
  x: number;
  y: number;
  r: number;
}
interface Target {
  id: string;
  kind: "prob" | "vis";
  topic: string; // main topic id (colour)
  label: string;
  level: 0 | 1;
  up: Target | null;
  kids: Target[];
  energy: number;
  base: number;
  glow: number;
  x: number;
  y: number;
  r: number;
  qx: number; // where a vision's rivulets join (feed side)
  visible: boolean;
}
interface Stream {
  kind: "fight" | "feed";
  org: Org;
  t: Target;
  recs: TopicRecord[];
  raw: number;
  value: number;
  base: number;
  pts: Float32Array;
  uni: Float32Array;
  len: number;
  riverAt: number;
  n: number;
  speed: number;
  seed: number;
}
interface Fx {
  x: number;
  y: number;
  t0: number;
  life: number;
  kind: "spark" | "flash" | "bloom";
  color: string;
  a: number; // direction of travel (radians)
}

const BROAD = "broad";
const BILLS = "bills";
const STORE = "openthink.topics.battle.v1";
const SPLIT_K = 1.7;
const KIND_LABEL: Record<TopicRecord["kind"], string> = {
  event: "Event",
  project: "Project",
  action: "Action",
  org_mission: "Mission statement",
  coalition_mission: "Mission statement",
};

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return ((x >>> 0) % 10000) / 10000;
}
/** Small deterministic random generator (for crack shapes). */
function rng(seed: number) {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const isMission = (r: TopicRecord) => r.kind === "org_mission" || r.kind === "coalition_mission";
function within(p: Target, q: Target): boolean {
  for (let x: Target | null = p; x; x = x.up) if (x === q) return true;
  return false;
}

export function createBattle(ctx: BattleCtx): { el: HTMLElement; update(): void; show(): void; hide(): void } {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "{}") as Partial<{ attack: Attack; feed: Feed; garden: Garden; split: Split; show: Show }>;
    } catch {
      return {};
    }
  })();
  let attack: Attack = saved.attack ?? "comets";
  let feed: Feed = saved.feed ?? "rainbow";
  let garden: Garden = saved.garden ?? "blooms";
  let split: Split = saved.split ?? "strategy";
  let showing: Show = saved.show ?? "both";
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ attack, feed, garden, split, show: showing }));
    } catch {
      /* ignore */
    }
  };
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // ---------- Data ----------
  const recs = ctx.file.records.filter((r) => ctx.mapIds.includes(r.map) && (r.topics.length || r.bills.length));
  const c2p = new Map<string, string>();
  for (const p of ctx.file.parents) for (const c of p.children) c2p.set(c.id, p.id);
  const targets = new Map<string, Target>();
  const getT = (id: string, kind: Target["kind"], topic: string, label: string, level: 0 | 1, up: Target | null): Target => {
    let t = targets.get(id);
    if (!t) {
      t = { id, kind, topic, label, level, up, kids: [], energy: 0, base: 0, glow: 0, x: 0, y: 0, r: 5, qx: 0, visible: false };
      targets.set(id, t);
      up?.kids.push(t);
    }
    return t;
  };
  const orgs = new Map<string, Org>();
  const streams = new Map<string, Stream>();
  const recStreams = new Map<string, Stream[]>();
  for (const r of recs) {
    const okey = `${r.map}:${r.host}`;
    let org = orgs.get(okey);
    if (!org) {
      org = { key: okey, host: r.host, name: r.host_name, logo: ctx.cb.logoOf?.(r.host), fight: 0, build: 0, base: 0, x: NaN, y: NaN, r: 3 };
      orgs.set(okey, org);
    }
    const topics = new Set(r.topics);
    if (r.bills.length && c2p.has(BILLS)) topics.add(BILLS);
    const hit = new Set<Target>();
    for (const t of topics) {
      const pid = c2p.get(t);
      if (!pid) continue;
      const pm = getT(`p:${pid}`, "prob", pid, PROBLEMS[pid] ?? pid, 0, null);
      hit.add(pm);
      hit.add(getT(`p:${pid}/${t}`, "prob", pid, PROBLEMS[`${pid}/${t}`] ?? t, 1, pm));
      hit.add(getT(`v:${pid}`, "vis", pid, VISIONS[pid] ?? pid, 0, null));
    }
    const list: Stream[] = [];
    for (const t of hit) {
      const kind = t.kind === "prob" ? "fight" : "feed";
      const k = `${kind}|${okey}|${t.id}`;
      let s = streams.get(k);
      if (!s) {
        s = { kind, org, t, recs: [], raw: 0, value: 0, base: 0, pts: new Float32Array(0), uni: new Float32Array(0), len: 1, riverAt: 0, n: 0, speed: 0, seed: hash(k) };
        streams.set(k, s);
      }
      s.recs.push(r);
      list.push(s);
    }
    recStreams.set(r.id, list);
  }
  const order = ctx.file.parents.map((p) => p.id);
  const mainProbs = order.map((id) => targets.get(`p:${id}`)).filter((t): t is Target => !!t);
  const visions = order.map((id) => targets.get(`v:${id}`)).filter((t): t is Target => !!t);
  for (const p of mainProbs) {
    const kidOrder = ctx.file.parents.find((x) => x.id === p.topic)!.children.map((c) => `p:${p.topic}/${c.id}`);
    p.kids.sort((a, b) => kidOrder.indexOf(a.id) - kidOrder.indexOf(b.id));
  }
  const allStreams = [...streams.values()];
  const orgList = [...orgs.values()];
  const recW = new Map<string, number>();
  const recFight = new Map<string, number>(); // share of the weight that confronts the problem

  function fightShare(r: TopicRecord): number {
    if (!r.strategies.length) return 0.5;
    return r.strategies.filter((s) => FIGHT_STRATEGIES.has(s)).length / r.strategies.length;
  }

  const levelMax = { p0: 1, p1: 1, v: 1 };
  function compute(intoBase: boolean) {
    const cap = ctx.cap();
    for (const s of allStreams) s.raw = 0;
    for (const t of targets.values()) t.energy = 0;
    for (const o of orgList) {
      o.fight = 0;
      o.build = 0;
    }
    for (const r of recs) {
      const w = ctx.weight(r);
      const f = fightShare(r);
      recW.set(r.id, w);
      recFight.set(r.id, f);
      if (w <= 0) continue;
      const wf = split === "both" ? w : w * f;
      const wb = split === "both" ? w : w * (1 - f);
      for (const s of recStreams.get(r.id) ?? []) s.raw += s.kind === "fight" ? wf : wb;
    }
    for (const s of allStreams) {
      s.value = Math.min(cap, s.raw);
      s.t.energy += s.value;
      if (s.kind === "feed") s.org.build += s.value;
      else if (s.t.level === 0) s.org.fight += s.value;
    }
    if (intoBase) {
      for (const s of allStreams) s.base = s.value;
      for (const t of targets.values()) t.base = t.energy;
      for (const o of orgList) o.base = o.fight + o.build;
      const live = [...targets.values()].filter((t) => t.topic !== BROAD);
      levelMax.p0 = d3.max(live.filter((t) => t.kind === "prob" && t.level === 0), (t) => t.base) || 1;
      levelMax.p1 = d3.max(live.filter((t) => t.kind === "prob" && t.level === 1), (t) => t.base) || 1;
      levelMax.v = d3.max(live.filter((t) => t.kind === "vis"), (t) => t.base) || 1;
    }
    for (const t of targets.values()) {
      const m = t.kind === "vis" ? levelMax.v : t.level === 0 ? levelMax.p0 : levelMax.p1;
      t.glow = Math.min(1, Math.sqrt(t.energy / m));
    }
  }

  // ---------- DOM ----------
  const el = h("div", { class: "cr bt" });
  const bar = h("div", { class: "cr-bar" });
  const seg = (name: string, opts: [string, string][], cur: () => string, set: (v: string) => void) => {
    const g = h("div", { class: "cr-seg", role: "group", "aria-label": name });
    g.appendChild(h("span", { class: "cr-seg-label" }, name));
    const btns: HTMLButtonElement[] = [];
    const sync = () => {
      for (const x of btns) x.classList.toggle("on", x.dataset.v === cur());
    };
    for (const [v, label] of opts) {
      const b = h("button", { type: "button", "data-v": v }, label) as HTMLButtonElement;
      b.addEventListener("click", () => {
        set(v);
        save();
        sync();
      });
      btns.push(b);
      g.appendChild(b);
    }
    sync();
    return { g, sync };
  };
  bar.appendChild(seg("Attack", [["comets", "Comets"], ["arrows", "Arrows of light"], ["seeds", "Seed bombs"]], () => attack, (v) => {
    attack = v as Attack;
    allocate();
    baseDirty = true;
    kick();
  }).g);
  bar.appendChild(seg("Feed", [["rainbow", "Rainbow rivers"], ["aurora", "Aurora"], ["fireflies", "Fireflies"]], () => feed, (v) => {
    feed = v as Feed;
    allocate();
    baseDirty = true;
    kick();
  }).g);
  bar.appendChild(seg("Garden", [["blooms", "Blooms"], ["stars", "Stars"]], () => garden, (v) => {
    garden = v as Garden;
    el.dataset.garden = garden;
  }).g);
  bar.appendChild(seg("Show", [["both", "Both"], ["fight", "Attack only"], ["feed", "Building only"]], () => showing, (v) => {
    showing = v as Show;
    el.dataset.show = showing;
    refresh();
  }).g);
  bar.appendChild(seg("Energy", [["strategy", "Split by strategy"], ["both", "Every item both ways"]], () => split, (v) => {
    split = v as Split;
    compute(true);
    relayout(true);
  }).g);
  let splitAll = false;
  let zoomSplit = false;
  const splitSeg = seg("Problems", [["main", "Main"], ["split", "Split all"]], () => (splitAll || zoomSplit ? "split" : "main"), (v) => {
    splitAll = v === "split";
    relayout(true);
  });
  bar.appendChild(splitSeg.g);
  const legend = h("div", { class: "cr-legend" });
  const infoBtn = h("button", { type: "button", class: "cr-info", "aria-expanded": "false" }, "How to read") as HTMLButtonElement;
  infoBtn.addEventListener("click", () => {
    const on = !legend.classList.contains("on");
    legend.classList.toggle("on", on);
    infoBtn.setAttribute("aria-expanded", String(on));
  });
  bar.appendChild(infoBtn);
  el.appendChild(bar);
  el.dataset.garden = garden;
  el.dataset.show = showing;

  const viewport = h("div", { class: "cr-viewport" });
  const canvas = document.createElement("canvas");
  canvas.className = "cr-canvas";
  const base = document.createElement("canvas");
  viewport.appendChild(canvas);
  const svg = d3.select(viewport).append("svg").attr("class", "cr-svg bt-svg");
  const tip = h("div", { class: "cr-tip" });
  const heads = h("div", { class: "bt-heads" }, h("span", {}, "Problems we push back on"), h("span", {}, "The groups"), h("span", {}, "What we're building"));
  const zoomBox = h("div", { class: "cr-zoom" });
  const zIn = h("button", { type: "button", "aria-label": "Zoom in", title: "Zoom in" }, "+") as HTMLButtonElement;
  const zOut = h("button", { type: "button", "aria-label": "Zoom out", title: "Zoom out" }, "−") as HTMLButtonElement;
  const zReset = h("button", { type: "button", "aria-label": "Reset view", title: "Reset view" }, "⟲") as HTMLButtonElement;
  zoomBox.append(zIn, zOut, zReset);
  viewport.append(heads, tip, legend, zoomBox);
  el.appendChild(viewport);

  const defs = svg.append("defs");
  defs.append("filter").attr("id", "bt-blur").attr("x", "-100%").attr("y", "-100%").attr("width", "300%").attr("height", "300%")
    .append("feGaussianBlur").attr("stdDeviation", 6);
  const orb = defs.append("radialGradient").attr("id", "bt-orb").attr("cx", "40%").attr("cy", "35%");
  orb.append("stop").attr("offset", "0%").attr("stop-color", "#3b1d3a");
  orb.append("stop").attr("offset", "70%").attr("stop-color", "#160b17");
  orb.append("stop").attr("offset", "100%").attr("stop-color", "#0a0610");
  defs.append("clipPath").attr("id", "bt-logo-clip").attr("clipPathUnits", "objectBoundingBox")
    .append("circle").attr("cx", 0.5).attr("cy", 0.5).attr("r", 0.5);
  const bg = svg.append("rect").attr("class", "cr-bg");
  const zg = svg.append("g");
  const gHits = zg.append("g").attr("class", "cr-hits");
  const gProbs = svg.append("g").attr("class", "bt-probs");
  const gVis = svg.append("g").attr("class", "bt-visions");
  const gOrgs = svg.append("g").attr("class", "cr-orgs");

  // ---------- State ----------
  let W = 800, H = 600, dpr = 1;
  let tr = d3.zoomIdentity;
  const expanded = new Set<string>();
  let selOrg: Org | null = null;
  let selT: Target | null = null;
  let hover: Stream | null = null;
  let visProbs: Target[] = [];
  let visStreams: Stream[] = [];
  let baseDirty = true;
  let fx: Fx[] = [];
  let shown = false;
  let anim: { t0: number; from: Map<string, [number, number]>; dur: number } | null = null;
  const target = new Map<string, [number, number]>();
  let xP = 200, xV = 600, cx = 400, band = 120, top = 34, bot = 560;
  let geomVer = 0;
  let paintedGeom = -1;
  const stats = { frames: 0, workMs: 0, avgMs: 0, maxMs: 0, intervalMs: 0, particles: 0, fx: 0 };
  (window as unknown as { __battle: typeof stats }).__battle = stats;

  const isOpen = (p: Target) => p.kids.filter((k) => k.base > 0).length > 1 && (expanded.has(p.id) || zoomSplit || splitAll);
  const showKind = (k: Stream["kind"]) => showing === "both" || showing === k;

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
    const small = W < 760;
    top = 40;
    bot = H - 26;
    xP = small ? Math.max(90, W * 0.24) : Math.min(300, Math.max(180, W * 0.2));
    xV = W - xP;
    cx = W / 2;
    band = Math.min(W * 0.12, 170);
    // problems: main ones, or their sub-problems when split
    visProbs = [];
    const groups: Target[][] = [];
    for (const p of mainProbs) {
      if (p.base <= 0) continue;
      const g = isOpen(p) ? p.kids.filter((k) => k.base > 0) : [p];
      groups.push(g);
      visProbs.push(...g);
    }
    for (const t of targets.values()) t.visible = false;
    for (const t of visProbs) t.visible = true;
    const units: number[] = [];
    let u = 0;
    for (const g of groups) {
      const gap = g.length > 1 || g[0].level > 0 ? 1 : 0.3;
      u += gap / 2;
      for (let i = 0; i < g.length; i++) units.push(u + i + 0.5);
      u += g.length + gap / 2;
    }
    const total = u || 1;
    const room = (bot - top) / Math.max(1, visProbs.length + 1);
    visProbs.forEach((p, i) => {
      target.set(p.id, [xP, top + (units[i] / total) * (bot - top)]);
      p.r = Math.min(Math.max(3, room * 0.4), p.level === 0 ? 6 + 13 * Math.sqrt(p.base / levelMax.p0) : 3.5 + 8 * Math.sqrt(p.base / levelMax.p1));
    });
    const vis = visions.filter((v) => v.base > 0);
    for (const v of visions) v.visible = v.base > 0;
    const vroom = (bot - top) / Math.max(1, vis.length);
    vis.forEach((v, i) => {
      target.set(v.id, [xV, top + (i + 0.5) * vroom]);
      v.r = Math.min(vroom * 0.32, 7 + 13 * Math.sqrt(v.base / levelMax.v));
      v.qx = xV - (xV - cx) * 0.34;
    });
    // groups: between the problems they push on and the visions they feed; fighters lean left, builders right
    const maxO = d3.max(orgList, (o) => o.base) || 1;
    const live = orgList.filter((o) => o.base > 0);
    for (const o of orgList) o.r = o.base > 0 ? (small ? 2.5 : 3) + (small ? 4 : 7) * Math.sqrt(o.base / maxO) : 0;
    const byOrg = d3.group(allStreams.filter((s) => s.base > 0 && s.t.visible), (s) => s.org.key);
    const oBot = H - 96; // the site's round + button sits at the bottom centre
    const nodes = live.map((o) => {
      let sy = 0, sw = 0;
      for (const s of byOrg.get(o.key) ?? []) {
        const ty = target.get(s.t.id)?.[1] ?? (top + bot) / 2;
        sy += ty * s.base;
        sw += s.base;
      }
      const y0 = sw ? sy / sw : (top + bot) / 2;
      const ty = top + ((y0 - top) * (oBot - top)) / (bot - top);
      const lean = o.fight + o.build > 0 ? (o.build - o.fight) / (o.build + o.fight) : 0;
      const tx = cx + lean * band * 0.85;
      const prev = target.get(o.key);
      return { o, tx, ty, x: prev ? prev[0] : tx, y: prev ? prev[1] : ty };
    });
    const sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX<(typeof nodes)[number]>((d) => d.tx).strength(0.18))
      .force("y", d3.forceY<(typeof nodes)[number]>((d) => d.ty).strength(0.3))
      .force("c", d3.forceCollide<(typeof nodes)[number]>((d) => d.o.r + 2.2))
      .stop();
    for (let i = 0; i < 100; i++) sim.tick();
    for (const n of nodes) target.set(n.o.key, [Math.max(cx - band * 1.6, Math.min(cx + band * 1.6, n.x)), Math.max(top, Math.min(oBot, n.y))]);
  }

  function applyPositions(t: number) {
    const e = d3.easeCubicInOut(t);
    const lerp = (id: string, obj: { x: number; y: number }, fb: [number, number]) => {
      const to = target.get(id);
      if (!to) return;
      const from = anim?.from.get(id) ?? fb;
      obj.x = from[0] + (to[0] - from[0]) * e;
      obj.y = from[1] + (to[1] - from[1]) * e;
    };
    for (const p of visProbs) lerp(p.id, p, anim?.from.get(p.up?.id ?? "") ?? target.get(p.id)!);
    for (const v of visions) if (v.visible) lerp(v.id, v, target.get(v.id)!);
    for (const o of orgList) if (o.base > 0) lerp(o.key, o, [cx, (top + bot) / 2]);
    for (const s of visStreams) buildGeom(s);
    geomVer++;
  }

  function bez(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, n: number) {
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = 1 - t;
      out.push(a * a * a * x0 + 3 * a * a * t * x1 + 3 * a * t * t * x2 + t * t * t * x3, a * a * a * y0 + 3 * a * a * t * y1 + 3 * a * t * t * y2 + t * t * t * y3);
    }
  }
  function buildGeom(s: Stream) {
    const o = s.org, t = s.t;
    const pts: number[] = [];
    if (s.kind === "fight") {
      // a ballistic arc, lobbed up and over toward the problem
      const dx = t.x - o.x;
      const lift = Math.min(140, Math.abs(dx) * (0.22 + 0.16 * s.seed));
      const mx = (o.x + t.x) / 2, my = Math.min(o.y, t.y) - lift;
      bez(pts, o.x, o.y, o.x + (2 / 3) * (mx - o.x), o.y + (2 / 3) * (my - o.y), t.x + (2 / 3) * (mx - t.x), t.y + (2 / 3) * (my - t.y), t.x, t.y, 36);
      s.riverAt = pts.length / 2;
    } else {
      // a rivulet that joins its vision's river, then flows in
      const qx = t.qx, qy = t.y;
      bez(pts, o.x, o.y, o.x + (qx - o.x) * 0.5, o.y, qx - (qx - o.x) * 0.35, qy, qx, qy, 30);
      s.riverAt = pts.length / 2 - 1;
      for (let i = 1; i <= 10; i++) pts.push(qx + ((t.x - qx) * i) / 10, qy);
    }
    s.pts = Float32Array.from(pts);
    const n = pts.length / 2;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    s.len = Math.max(1, cum[n - 1]);
    const U = 64, uni = new Float32Array((U + 1) * 2);
    let j = 0;
    for (let i = 0; i <= U; i++) {
      const tgt = (i / U) * cum[n - 1];
      while (j < n - 2 && cum[j + 1] < tgt) j++;
      const sg = cum[j + 1] - cum[j] || 1, f = Math.min(1, Math.max(0, (tgt - cum[j]) / sg));
      uni[2 * i] = pts[2 * j] + (pts[2 * j + 2] - pts[2 * j]) * f;
      uni[2 * i + 1] = pts[2 * j + 1] + (pts[2 * j + 3] - pts[2 * j + 1]) * f;
    }
    s.uni = uni;
  }
  const P: [number, number] = [0, 0];
  const Q: [number, number] = [0, 0];
  function at(s: Stream, f: number, out: [number, number]) {
    const u = s.uni, x = Math.max(0, Math.min(1, f)) * 64, i = Math.min(63, x | 0), t = x - i;
    out[0] = u[2 * i] + (u[2 * i + 2] - u[2 * i]) * t;
    out[1] = u[2 * i + 1] + (u[2 * i + 3] - u[2 * i + 1]) * t;
  }

  // ---------- Dimming and particle budget ----------
  function streamAlpha(s: Stream, withHover = true): number {
    if (!showKind(s.kind)) return 0;
    if (selOrg && s.org !== selOrg) return 0;
    if (selT) {
      if (selT.kind === "vis" && s.t !== selT) return 0;
      if (selT.kind === "prob" && (s.kind !== "fight" || !within(s.t, selT))) return 0;
    }
    let a = 1;
    if (s.t.topic === BROAD) a *= 0.4;
    if (withHover && hover && hover !== s) a *= 0.45;
    return a;
  }
  function allocate() {
    visStreams = allStreams.filter((s) => s.base > 0 && s.t.visible);
    const area = (W * H) / 900;
    for (const kind of ["fight", "feed"] as const) {
      const list = visStreams.filter((s) => s.kind === kind);
      const budget = Math.round(Math.min(kind === "fight" ? (attack === "arrows" ? 200 : 320) : feed === "fireflies" ? 180 : feed === "aurora" ? 360 : 420, Math.max(150, area)));
      const vmax = d3.max(list, (s) => s.value) || 1;
      const eff = list.map((s) => (s.value > 0 ? s.value * Math.max(0.08, streamAlpha(s, false)) : 0));
      const tot = d3.sum(eff) || 1;
      const live = eff.filter((e) => e > 0).length;
      const extra = Math.max(0, budget - live);
      list.forEach((s, i) => {
        s.n = eff[i] > 0 ? (live > budget ? (hash(s.org.key + s.t.id) < budget / live ? 1 : 0) : 1 + Math.floor((extra * eff[i]) / tot)) : 0;
        const k = Math.sqrt(s.value / vmax);
        const pxps = reduced ? 0 : kind === "fight"
          ? attack === "arrows" ? 120 + 60 * k : attack === "seeds" ? 26 + 22 * k : 45 + 40 * k
          : feed === "fireflies" ? 9 + 8 * k : feed === "aurora" ? 10 + 12 * k : 14 + 22 * k;
        s.speed = pxps / Math.max(60, s.len || 200);
      });
    }
    stats.particles = d3.sum(visStreams, (s) => s.n);
  }

  // ---------- SVG ----------
  const crackCache = new Map<string, [number, number][][]>();
  function cracks(id: string): [number, number][][] {
    let c = crackCache.get(id);
    if (c) return c;
    const rand = rng(hash(id));
    c = [];
    for (let i = 0; i < 6; i++) {
      const a0 = rand() * Math.PI * 2;
      const line: [number, number][] = [[Math.cos(a0) * 0.12, Math.sin(a0) * 0.12]];
      let a = a0;
      for (let d = 0.3; d <= 1.001; d += 0.22) {
        a += (rand() - 0.5) * 0.9;
        line.push([Math.cos(a) * d, Math.sin(a) * d]);
      }
      c.push(line);
    }
    crackCache.set(id, c);
    return c;
  }
  const hue = (t: Target) => (t.topic === BROAD ? "#9ca3af" : ctx.colorOf(t.topic));
  const orgScale = () => Math.max(1, Math.min(2.4, Math.pow(tr.k, 0.75)));
  let feeding: Set<string> | null = null;
  const orgOpacity = (o: Org) => (selOrg ? (o === selOrg ? 1 : 0.25) : feeding ? (feeding.has(o.key) ? 1 : 0.18) : 1);

  function paintSvg() {
    const moved = paintedGeom !== geomVer;
    paintedGeom = geomVer;
    // hover paths
    const hits = gHits.selectAll<SVGPathElement, Stream>("path").data(visStreams.filter((s) => s.value > 0 && streamAlpha(s, false) > 0), (s) => `${s.kind}|${s.org.key}|${s.t.id}`);
    hits.exit().remove();
    const hitsIn = hits.enter().append("path")
      .on("mouseenter", (ev: MouseEvent, s) => {
        hover = s;
        baseDirty = true;
        showStreamTip(ev, s);
      })
      .on("mousemove", (ev: MouseEvent, s) => showStreamTip(ev, s))
      .on("mouseleave", () => {
        hover = null;
        baseDirty = true;
        tip.classList.remove("on");
      })
      .on("click", (ev: MouseEvent, s) => {
        ev.stopPropagation();
        selectTarget(s.t);
      });
    (moved ? hitsIn.merge(hits) : hitsIn).attr("d", (s) => {
      let d = "";
      for (let i = 0; i < s.pts.length; i += 2) d += `${i ? "L" : "M"}${s.pts[i].toFixed(1)},${s.pts[i + 1].toFixed(1)}`;
      return d;
    });

    // problems: dark orbs that crack open with gold as energy hits them
    const ps = gProbs.selectAll<SVGGElement, Target>("g.bt-prob").data(visProbs, (p) => p.id);
    ps.exit().remove();
    const pe = ps.enter().append("g").attr("class", (p) => `bt-prob lv${p.level}${p.topic === BROAD ? " broad" : ""}`).attr("data-id", (p) => p.id);
    pe.append("circle").attr("class", "aura").attr("filter", "url(#bt-blur)");
    pe.append("circle").attr("class", "orb");
    pe.append("g").attr("class", "cracks");
    pe.append("circle").attr("class", "rim");
    pe.append("circle").attr("class", "hit");
    pe.append("text").attr("class", "lbl");
    pe.on("click", (ev: MouseEvent, p) => {
      ev.stopPropagation();
      if (p.kids.filter((k) => k.base > 0).length > 1) {
        if (expanded.has(p.id)) expanded.delete(p.id);
        else expanded.add(p.id);
        selT = p;
        selOrg = null;
        relayout(true);
        renderDetail();
      } else selectTarget(p);
    })
      .on("mouseenter", (ev: MouseEvent, p) => showTargetTip(ev, p))
      .on("mousemove", (ev: MouseEvent, p) => showTargetTip(ev, p))
      .on("mouseleave", () => tip.classList.remove("on"));
    const pall = pe.merge(ps);
    pall.classed("sel", (p) => p === selT || (!!selT && within(p, selT)))
      .attr("opacity", (p) => (selT && selT.kind === "vis" ? 0.35 : selT && !within(p, selT) ? 0.4 : selOrg && !visStreams.some((s) => s.org === selOrg && s.t === p && s.value > 0) ? 0.3 : 1));
    pall.each(function (p) {
      const g = d3.select(this);
      const r = p.r, glow = p.glow;
      g.select(".aura").attr("r", r * 1.8).attr("opacity", 0.1 + 0.45 * glow);
      g.select(".orb").attr("r", r);
      g.select(".rim").attr("r", r + 2.5).attr("stroke-opacity", 0.25 + 0.6 * glow);
      const cs = g.select(".cracks").selectAll<SVGPathElement, [number, number][]>("path").data(cracks(p.id));
      cs.enter().append("path").attr("pathLength", 1).merge(cs)
        .attr("d", (l) => `M${l.map(([x, y]) => `${(x * r).toFixed(1)},${(y * r).toFixed(1)}`).join("L")}`)
        .attr("stroke-dasharray", `${(0.08 + 0.92 * glow).toFixed(3)} 1`)
        .attr("opacity", 0.35 + 0.65 * glow);
      g.select(".hit").attr("r", r + 8);
      const room = Math.max(10, Math.min(46, Math.floor((tr.applyX(target.get(p.id)?.[0] ?? p.x) - r - 14) / (p.level ? 5.6 : 6.3))));
      g.select(".lbl").text(p.label.length > room ? `${p.label.slice(0, room - 1)}…` : p.label)
        .attr("x", -r - 9).attr("y", 0).attr("dy", "0.35em");
    });

    // crowded column: keep the labels of the busiest problems that fit, hide the rest (they show on hover)
    const keep = new Set<string>();
    const ys: number[] = [];
    for (const p of [...visProbs].sort((a, b) => b.energy - a.energy)) {
      const y = tr.applyY(target.get(p.id)?.[1] ?? p.y);
      if (ys.some((v) => Math.abs(v - y) < (p.level ? 11 : 13))) continue;
      ys.push(y);
      keep.add(p.id);
    }
    pall.select(".lbl").style("display", (p) => (keep.has(p.id) ? null : "none"));

    // visions: blooms or stars that open up as energy reaches them
    const vs = gVis.selectAll<SVGGElement, Target>("g.bt-vis").data(visions.filter((v) => v.visible), (v) => v.id);
    vs.exit().remove();
    const ve = vs.enter().append("g").attr("class", (v) => `bt-vis${v.topic === BROAD ? " broad" : ""}`).attr("data-id", (v) => v.id);
    ve.append("circle").attr("class", "halo").attr("filter", "url(#bt-blur)");
    const bloom = ve.append("g").attr("class", "bloom").append("g").attr("class", "spin");
    bloom.selectAll("ellipse").data(d3.range(8)).enter().append("ellipse");
    ve.select(".bloom").append("circle").attr("class", "heart");
    ve.append("g").attr("class", "star").append("g").attr("class", "spin").append("path");
    ve.append("circle").attr("class", "hit");
    ve.append("text").attr("class", "lbl");
    ve.on("click", (ev: MouseEvent, v) => {
      ev.stopPropagation();
      selectTarget(v);
    })
      .on("mouseenter", (ev: MouseEvent, v) => showTargetTip(ev, v))
      .on("mousemove", (ev: MouseEvent, v) => showTargetTip(ev, v))
      .on("mouseleave", () => tip.classList.remove("on"));
    const vall = ve.merge(vs);
    vall.classed("sel", (v) => v === selT)
      .attr("opacity", (v) => (selT && selT !== v ? 0.35 : selOrg && !visStreams.some((s) => s.org === selOrg && s.t === v && s.value > 0) ? 0.3 : 1));
    vall.each(function (v) {
      const g = d3.select(this);
      const r = v.r, glow = v.glow, c = hue(v);
      const light = d3.hsl(c);
      light.l = 0.72;
      g.select(".halo").attr("r", r * 1.7).attr("fill", c).attr("opacity", 0.08 + 0.5 * glow);
      g.select(".spin").style("animation-duration", `${60 - 30 * glow}s`);
      g.select(".bloom").selectAll<SVGEllipseElement, number>("ellipse")
        .attr("rx", r * (0.2 + 0.12 * glow)).attr("ry", r * (0.35 + 0.5 * glow))
        .attr("cy", -r * (0.3 + 0.45 * glow))
        .attr("transform", (i) => `rotate(${i * 45})`)
        .attr("fill", light.formatHex()).attr("opacity", 0.35 + 0.5 * glow);
      g.select(".heart").attr("r", r * 0.32).attr("fill", "#fde68a").attr("opacity", 0.6 + 0.4 * glow);
      const outer = r * (0.6 + 0.8 * glow), inner = r * 0.3, pts: string[] = [];
      for (let i = 0; i < 16; i++) {
        const rr = i % 2 ? inner : outer * (i % 4 === 0 ? 1 : 0.7), a = (i * Math.PI) / 8 - Math.PI / 2;
        pts.push(`${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`);
      }
      g.select(".star path").attr("d", `M${pts.join("L")}Z`).attr("fill", light.formatHex()).attr("opacity", 0.45 + 0.5 * glow);
      g.select(".hit").attr("r", r + 8);
      const room = Math.max(10, Math.min(46, Math.floor((W - tr.applyX(target.get(v.id)?.[0] ?? v.x) - r - 14) / 6.3)));
      g.select(".lbl").text(v.label.length > room ? `${v.label.slice(0, room - 1)}…` : v.label).attr("x", r + 10).attr("y", 0).attr("dy", "0.35em");
    });

    // groups, with logos
    const live = orgList.filter((o) => o.base > 0);
    const os = gOrgs.selectAll<SVGGElement, Org>("g.cr-org").data(live, (o) => o.key);
    os.exit().remove();
    const oe = os.enter().append("g").attr("class", (o) => `cr-org${o.logo ? " has-logo" : ""}`).attr("data-key", (o) => o.key);
    oe.append("circle").attr("class", "dot");
    oe.filter((o) => !!o.logo).append("image").attr("class", "logo").attr("href", (o) => o.logo!).attr("clip-path", "url(#bt-logo-clip)").attr("preserveAspectRatio", "xMidYMid meet");
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
    feeding = selT ? new Set(visStreams.filter((s) => streamAlpha(s, false) > 0.2 && s.value > 0).map((s) => s.org.key)) : null;
    oall.classed("sel", (o) => o === selOrg).attr("opacity", orgOpacity);
    const osz = moved ? oall : oe;
    osz.select(".dot").attr("r", (o) => o.r);
    osz.select(".logo").attr("x", (o) => -o.r * 0.86).attr("y", (o) => -o.r * 0.86).attr("width", (o) => o.r * 1.72).attr("height", (o) => o.r * 1.72);
    osz.select(".hit").attr("r", (o) => Math.max(6, o.r + 3));
    placeSvg();
    placeOrgLabels();
  }

  function placeOrgLabels() {
    const live = orgList.filter((o) => o.base > 0);
    const s = orgScale();
    const cand = new Set<string>();
    for (const o of [...live].sort((a, b) => b.base - a.base).slice(0, tr.k >= 1.5 ? 400 : 10)) cand.add(o.key);
    if (selOrg) cand.add(selOrg.key);
    if (selT) for (const st of visStreams.filter((x) => streamAlpha(x, false) > 0.2 && x.value > 0).sort((a, b) => b.value - a.value).slice(0, 14)) cand.add(st.org.key);
    for (const o of live) if (orgOpacity(o) < 0.3) cand.delete(o.key);
    const boxes: [number, number, number, number][] = [];
    const show = new Set<string>();
    for (const o of [...live].sort((a, b) => (a === selOrg ? -1 : b === selOrg ? 1 : b.base - a.base))) {
      if (!cand.has(o.key)) continue;
      const [lx, ly] = target.get(o.key) ?? [o.x, o.y];
      const x = tr.applyX(lx), y = tr.applyY(ly);
      if (x < -50 || x > W + 50 || y < -20 || y > H + 20) continue;
      const w = Math.min(30, o.name.length) * 5.6;
      const box: [number, number, number, number] = [x - w / 2, y - o.r * s - 16, x + w / 2, y - o.r * s - 3];
      if (boxes.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
      boxes.push(box);
      show.add(o.key);
    }
    gOrgs.selectAll<SVGGElement, Org>("g.cr-org").select<SVGTextElement>(".lbl")
      .text((o) => (o.name.length > 30 ? `${o.name.slice(0, 28)}…` : o.name))
      .style("display", (o) => (show.has(o.key) ? null : "none"))
      .attr("text-anchor", "middle").attr("x", 0).attr("y", (o) => -o.r - 5)
      .style("font-size", `${10 / s}px`).style("stroke-width", `${3 / s}px`);
  }

  function placeSvg() {
    const s = orgScale();
    gProbs.selectAll<SVGGElement, Target>("g.bt-prob").attr("transform", (p) => `translate(${tr.applyX(p.x)},${tr.applyY(p.y)})`);
    gVis.selectAll<SVGGElement, Target>("g.bt-vis").attr("transform", (v) => `translate(${tr.applyX(v.x)},${tr.applyY(v.y)})`);
    gOrgs.selectAll<SVGGElement, Org>("g.cr-org").attr("transform", (o) => `translate(${tr.applyX(o.x)},${tr.applyY(o.y)}) scale(${s})`);
  }

  // ---------- Tooltips ----------
  function placeTip(ev: MouseEvent) {
    const r = viewport.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    tip.classList.add("on");
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(W - tw - 8, x + 14))}px`;
    tip.style.top = `${Math.max(8, Math.min(H - th - 8, y + 14))}px`;
  }
  const topRecs = (list: TopicRecord[], n: number) => [...list].filter((r) => (recW.get(r.id) ?? 0) > 0).sort((a, b) => (recW.get(b.id) ?? 0) - (recW.get(a.id) ?? 0)).slice(0, n);
  function showStreamTip(ev: MouseEvent, s: Stream) {
    clear(tip);
    tip.append(
      h("div", { class: "cr-tip-meta" }, s.kind === "fight" ? "pushing back on" : "helping build"),
      h("div", { class: "cr-tip-title" }, `${s.org.name} → ${s.t.label}`),
      h("div", { class: "cr-tip-meta" }, `energy ${s.value.toFixed(2)} · ${s.recs.length} item${s.recs.length === 1 ? "" : "s"}`),
    );
    for (const r of topRecs(s.recs, 3)) tip.appendChild(h("div", { class: "cr-tip-item" }, `${KIND_LABEL[r.kind]}: ${isMission(r) ? "mission statement" : r.name}`));
    placeTip(ev);
  }
  function showTargetTip(ev: MouseEvent, t: Target) {
    clear(tip);
    const n = new Set(allStreams.filter((s) => s.t === t && s.value > 0).map((s) => s.org)).size;
    const finer = t.kids.filter((k) => k.base > 0).length;
    tip.append(
      h("div", { class: "cr-tip-meta" }, t.kind === "vis" ? "What we're building" : t.up ? `Problem · part of “${t.up.label}”` : "Problem"),
      h("div", { class: "cr-tip-title" }, t.label),
      h("div", { class: "cr-tip-meta" }, `${t.kind === "vis" ? "fed" : "pushed on"} by ${n} group${n === 1 ? "" : "s"} · energy ${t.energy.toFixed(1)}`),
      h("div", { class: "cr-tip-item" }, finer > 1 ? `Click to split into ${finer} sharper problems` : "Click to see who is on it"),
    );
    placeTip(ev);
  }
  function showOrgTip(ev: MouseEvent, o: Org) {
    clear(tip);
    tip.append(h("div", { class: "cr-tip-title" }, o.name),
      h("div", { class: "cr-tip-meta" }, `pushing back ${o.fight.toFixed(1)} · building ${o.build.toFixed(1)}`),
      h("div", { class: "cr-tip-item" }, "Click to show only its streams"));
    placeTip(ev);
  }

  // ---------- Selection + detail ----------
  function selectTarget(t: Target) {
    selOrg = null;
    selT = selT === t ? null : t;
    refresh();
    renderDetail();
  }
  function selectOrg(o: Org) {
    selT = null;
    selOrg = selOrg === o ? null : o;
    refresh();
    renderDetail();
  }
  function clearSel() {
    selOrg = null;
    selT = null;
    refresh();
    renderDetail();
  }
  function mapButton(host: string, label: string, cls: string): HTMLElement {
    const b = h("button", { type: "button", class: cls, title: "See this group on the map" }, label);
    if (ctx.cb.hasGroup(host)) b.addEventListener("click", () => ctx.cb.onGroupClick(host));
    else b.setAttribute("disabled", "true");
    return b;
  }
  const logoImg = (o: Org) => (o.logo ? h("img", { class: "cr-detail-logo", src: o.logo, alt: "" }) : h("span", { class: "cr-feeder-dot" }));
  function recordRow(r: TopicRecord): HTMLElement {
    const m = isMission(r);
    const f = recFight.get(r.id) ?? 0.5;
    const groupBtn = mapButton(r.host, r.host_name, "topics-group");
    return h("div", { class: `topics-record${(recW.get(r.id) ?? 0) <= 0 ? " zero" : ""}` },
      h("div", { class: "meta-row" },
        h("span", { class: `pill k-${m ? "mission" : r.kind}` }, KIND_LABEL[r.kind]),
        h("span", { class: "pill" }, f >= 0.99 ? "pushes back" : f <= 0.01 ? "builds" : "pushes back + builds"),
        r.recurring ? h("span", { class: "pill" }, "repeats") : null,
        r.date ? h("span", { class: "pill deadline" }, r.date) : null),
      m ? h("div", { class: "topics-host" }, "Mission of ", groupBtn)
        : h("div", {}, h("div", { class: "name" }, r.link ? h("a", { href: r.link, target: "_blank", rel: "noopener noreferrer" }, `${r.name} ↗`) : r.name), h("div", { class: "topics-host" }, groupBtn)));
  }
  function renderDetail() {
    const d = ctx.detail;
    clear(d);
    if (!selOrg && !selT) {
      d.classList.remove("open");
      return;
    }
    d.classList.add("open");
    const close = h("button", { class: "detail-close", type: "button", "aria-label": "Close" }, "×");
    close.addEventListener("click", clearSel);
    d.appendChild(close);
    if (selT) {
      const t = selT;
      const list = allStreams.filter((s) => (t.kind === "vis" ? s.t === t : s.kind === "fight" && s.t === t) && s.value > 0).sort((a, b) => b.value - a.value);
      d.append(h("div", { class: "topics-detail-parent" }, t.kind === "vis" ? "What we're building" : t.up ? `Problem · ${t.up.label}` : "Problem"), h("h3", {}, t.label),
        h("div", { class: "topics-detail-meta" }, `${t.kind === "vis" ? "fed" : "pushed on"} by ${list.length} group${list.length === 1 ? "" : "s"} · energy ${t.energy.toFixed(1)}`));
      const finer = t.kids.filter((k) => k.base > 0).sort((a, b) => b.energy - a.energy);
      if (finer.length > 1) {
        d.appendChild(h("div", { class: "cr-sub" }, "Sharper problems inside it"));
        const box = h("div", { class: "cr-chips" });
        for (const k of finer) {
          const b = h("button", { type: "button" }, `${k.label} · ${k.energy.toFixed(1)}`);
          b.addEventListener("click", () => {
            expanded.add(t.id);
            selT = k;
            relayout(true);
            renderDetail();
          });
          box.appendChild(b);
        }
        d.appendChild(box);
      }
      d.appendChild(h("div", { class: "cr-sub" }, t.kind === "vis" ? "Who feeds it" : "Who pushes back on it"));
      const max = list[0]?.value || 1;
      const fl = h("div", { class: "cr-feeders" });
      for (const s of list) {
        const name = h("button", { type: "button", class: "cr-feeder-name" }, s.org.name);
        name.addEventListener("click", () => selectOrg(s.org));
        fl.appendChild(h("div", { class: "cr-feeder" }, logoImg(s.org), name, h("span", { class: "cr-feeder-bar", style: `width:${Math.max(3, (60 * s.value) / max)}px` }), mapButton(s.org.host, "map ↗", "cr-feeder-map")));
      }
      d.appendChild(fl);
      const items = [...new Set(list.flatMap((s) => s.recs))].sort((a, b) => (recW.get(b.id) ?? 0) - (recW.get(a.id) ?? 0) || a.name.localeCompare(b.name));
      d.appendChild(h("div", { class: "cr-sub" }, `Items (${items.length})`));
      const box = h("div", { class: "topics-records" });
      for (const r of items) box.appendChild(recordRow(r));
      d.appendChild(box);
    } else if (selOrg) {
      const o = selOrg;
      d.append(h("div", { class: "cr-detail-head" }, logoImg(o), h("div", {}, h("div", { class: "topics-detail-parent" }, "Group"), h("h3", {}, o.name))),
        h("div", { class: "topics-detail-meta" }, `pushing back ${o.fight.toFixed(1)} · building ${o.build.toFixed(1)}`),
        mapButton(o.host, "See this group on the map ↗", "cr-mapbtn"));
      for (const kind of ["fight", "feed"] as const) {
        const mine = visStreams.filter((s) => s.org === o && s.kind === kind && s.value > 0).sort((a, b) => b.value - a.value);
        if (!mine.length) continue;
        d.appendChild(h("div", { class: "cr-sub" }, kind === "fight" ? "Pushing back on" : "Helping build"));
        const box = h("div", { class: "cr-chips" });
        for (const s of mine) {
          const b = h("button", { type: "button" }, `${s.t.label} · ${s.value.toFixed(2)}`);
          b.addEventListener("click", () => selectTarget(s.t));
          box.appendChild(b);
        }
        d.appendChild(box);
      }
      const items = [...new Set(allStreams.filter((s) => s.org === o).flatMap((s) => s.recs))];
      d.appendChild(h("div", { class: "cr-sub" }, `Items (${items.length})`));
      const box = h("div", { class: "topics-records" });
      for (const r of items) box.appendChild(recordRow(r));
      d.appendChild(box);
    }
  }

  // ---------- Canvas ----------
  const sprites = new Map<string, HTMLCanvasElement>();
  function sprite(col0: string, core = 0.95): HTMLCanvasElement {
    const key = `${col0}|${core}`;
    let c = sprites.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    const col = d3.color(col0)!;
    rg.addColorStop(0, `rgba(255,255,255,${core})`);
    rg.addColorStop(0.2, col.copy({ opacity: 0.9 }).formatRgb());
    rg.addColorStop(0.5, col.copy({ opacity: 0.25 }).formatRgb());
    rg.addColorStop(1, col.copy({ opacity: 0 }).formatRgb());
    g.fillStyle = rg;
    g.fillRect(0, 0, 32, 32);
    sprites.set(key, c);
    return c;
  }
  const rainbow = d3.range(24).map((i) => sprite(d3.hsl((i * 15) % 360, 0.9, 0.65).formatHex()));
  const auroraCols = ["#34d399", "#2dd4bf", "#22d3ee", "#818cf8", "#c084fc"].map((c) => sprite(c, 0.4));
  const firefly = sprite("#fde047");
  const seedSpr = sprite("#bef264");
  const colorCache = new Map<string, string>();
  const tColor = (t: Target) => {
    let c = colorCache.get(t.topic);
    if (!c) colorCache.set(t.topic, (c = hue(t)));
    return c;
  };

  function drawBase() {
    const g = base.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, base.width, base.height);
    g.setTransform(dpr * tr.k, 0, 0, dpr * tr.k, dpr * tr.x, dpr * tr.y);
    g.lineCap = "round";
    g.lineJoin = "round";
    const line = (s: Stream, from: number, to: number) => {
      g.beginPath();
      g.moveTo(s.pts[2 * from], s.pts[2 * from + 1]);
      for (let i = from + 1; i <= to; i++) g.lineTo(s.pts[2 * i], s.pts[2 * i + 1]);
      g.stroke();
    };
    const fights = visStreams.filter((s) => s.kind === "fight" && s.value > 0);
    const feeds = visStreams.filter((s) => s.kind === "feed" && s.value > 0);
    const fmax = d3.max(fights, (s) => s.value) || 1;
    g.globalCompositeOperation = "lighter";
    for (const s of fights) {
      const a = streamAlpha(s);
      if (a <= 0) continue;
      const k = Math.sqrt(s.value / fmax);
      const c = d3.color(attack === "arrows" ? "#e0f2fe" : attack === "seeds" ? "#bef264" : tColor(s.t))!;
      c.opacity = (s === hover ? 0.7 : (attack === "arrows" ? 0.025 + 0.06 * k : 0.03 + 0.12 * k) * a) * (reduced ? 1.6 : 1);
      g.strokeStyle = c.formatRgb();
      g.lineWidth = (s === hover ? 2 : 0.5 + 1.3 * k) / tr.k;
      if (attack === "seeds") g.setLineDash([2 / tr.k, 6 / tr.k]);
      line(s, 0, s.pts.length / 2 - 1);
      g.setLineDash([]);
    }
    // feed: rivulets, then one river per vision
    const bmax = d3.max(feeds, (s) => s.value) || 1;
    const rivCol = feed === "aurora" ? "rgba(52,211,153," : feed === "fireflies" ? "rgba(253,224,71," : "rgba(196,181,253,";
    for (const s of feeds) {
      const a = streamAlpha(s);
      if (a <= 0) continue;
      const k = Math.sqrt(s.value / bmax);
      g.strokeStyle = s === hover ? "rgba(255,255,255,0.8)" : `${rivCol}${((feed === "fireflies" ? 0.03 : 0.05) + 0.16 * k) * a})`;
      g.lineWidth = (s === hover ? 2.4 : (feed === "aurora" ? 1.5 : 0.5) + (feed === "aurora" ? 4 : 2) * k) / tr.k;
      line(s, 0, s.riverAt);
    }
    const flow = new Map<Target, number>();
    for (const s of feeds) if (streamAlpha(s) > 0) flow.set(s.t, (flow.get(s.t) ?? 0) + s.value * Math.min(1, streamAlpha(s) * 2.5));
    const vmax = d3.max([...flow.values()]) || 1;
    for (const [v, f] of flow) {
      const k = Math.sqrt(f / vmax);
      const grad = g.createLinearGradient(v.qx, v.y, v.x, v.y);
      if (feed === "rainbow") ["#f472b6", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa"].forEach((c, i) => grad.addColorStop(i / 5, c));
      else if (feed === "aurora") ["#34d399", "#22d3ee", "#a78bfa"].forEach((c, i) => grad.addColorStop(i / 2, c));
      else ["#78350f", "#fde047"].forEach((c, i) => grad.addColorStop(i, c));
      g.strokeStyle = grad;
      for (const [wd, al] of [[3 + (feed === "aurora" ? 16 : 9) * k, 0.16], [1 + 3 * k, 0.35]] as [number, number][]) {
        g.globalAlpha = al;
        g.lineWidth = wd / tr.k;
        g.beginPath();
        g.moveTo(v.qx, v.y);
        g.lineTo(v.x, v.y);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = "source-over";
    baseDirty = false;
  }

  function drawFrame(time: number, dt: number) {
    const g = canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (baseDirty) drawBase();
    g.drawImage(base, 0, 0);
    g.setTransform(dpr * tr.k, 0, 0, dpr * tr.k, dpr * tr.x, dpr * tr.y);
    g.globalCompositeOperation = "lighter";
    const sz = 1 / tr.k;
    const now = performance.now();
    for (const s of visStreams) {
      if (!s.n || s.value <= 0) continue;
      const a = streamAlpha(s) * (s === hover ? 1.6 : 1);
      if (a <= 0) continue;
      if (s.kind === "fight") {
        const col = tColor(s.t);
        const spr = attack === "seeds" ? seedSpr : sprite(col);
        for (let i = 0; i < s.n; i++) {
          const off = i / s.n + s.seed * 0.618;
          const ph = (time * s.speed + off) % 1;
          // a projectile arriving: a small effect on the problem (not every one, to stay calm)
          if (!reduced && dt > 0 && ph < s.speed * dt && fx.length < 70 && hash(`${s.seed}${i}${Math.floor(time * s.speed + off)}`) < 0.45) {
            at(s, 0.985, P);
            at(s, 0.94, Q);
            fx.push({ x: P[0], y: P[1], t0: now, life: attack === "seeds" ? 1100 : attack === "arrows" ? 380 : 650, kind: attack === "seeds" ? "bloom" : attack === "arrows" ? "flash" : "spark", color: col, a: Math.atan2(P[1] - Q[1], P[0] - Q[0]) });
          }
          if (attack === "arrows") {
            at(s, ph, P);
            at(s, Math.max(0, ph - 34 / s.len), Q);
            g.globalAlpha = Math.min(1, 0.55 * a);
            g.strokeStyle = "#e0f2fe";
            g.lineWidth = 1.1 * sz;
            g.beginPath();
            g.moveTo(Q[0], Q[1]);
            g.lineTo(P[0], P[1]);
            g.stroke();
            g.globalAlpha = Math.min(1, 0.5 * a);
            g.drawImage(spr, P[0] - 3 * sz, P[1] - 3 * sz, 6 * sz, 6 * sz);
          } else if (attack === "seeds") {
            at(s, ph, P);
            const size = (5 + 1.5 * Math.sin(time * 6 + i)) * sz;
            g.globalAlpha = Math.min(1, 0.6 * a);
            g.drawImage(spr, P[0] - size / 2, P[1] - size / 2, size, size);
          } else {
            const tail = 16 / s.len;
            for (let k = 2; k >= 0; k--) {
              const f = ph - k * tail * 0.6;
              if (f < 0) continue;
              at(s, f, P);
              const size = (7.5 - k * 1.8) * sz;
              g.globalAlpha = Math.min(1, (0.6 - k * 0.2) * a);
              g.drawImage(spr, P[0] - size / 2, P[1] - size / 2, size, size);
            }
          }
        }
      } else {
        for (let i = 0; i < s.n; i++) {
          const ph = (time * s.speed + i / s.n + s.seed * 0.618) % 1;
          at(s, ph, P);
          // drift sideways a little, like dust in a current
          at(s, Math.min(1, ph + 0.01), Q);
          const dx = Q[0] - P[0], dy = Q[1] - P[1], dl = Math.hypot(dx, dy) || 1;
          const wob = feed === "fireflies" ? 6 : feed === "aurora" ? 3 : 2;
          const w = Math.sin(time * (feed === "fireflies" ? 1.3 : 2.2) + i * 1.7 + s.seed * 9) * wob;
          const x = P[0] - (dy / dl) * w, y = P[1] + (dx / dl) * w;
          if (feed === "rainbow") {
            const hi = Math.floor(((s.seed * 24 + i * 5 + time * 2.5 + ph * 18) % 24 + 24) % 24);
            const tw = 0.55 + 0.45 * Math.sin(time * 5 + i * 2.3);
            const size = (3.5 + 2 * tw) * sz;
            g.globalAlpha = Math.min(1, 0.5 * tw * a);
            g.drawImage(rainbow[hi], x - size / 2, y - size / 2, size, size);
          } else if (feed === "aurora") {
            const ci = Math.floor((s.seed * 5 + time * 0.15 + ph * 2) % 5);
            const size = 15 * sz;
            g.globalAlpha = Math.min(1, 0.09 * a);
            g.drawImage(auroraCols[ci], x - size / 2, y - size / 2, size, size);
          } else {
            const blink = Math.max(0, Math.sin(time * 2.4 + i * 3.1 + s.seed * 20));
            const size = 5 * sz;
            g.globalAlpha = Math.min(1, (0.1 + 0.7 * blink) * a);
            g.drawImage(firefly, x - size / 2, y - size / 2, size, size);
          }
        }
      }
    }
    // impact effects
    fx = fx.filter((f) => now - f.t0 < f.life);
    for (const f of fx) {
      const age = (now - f.t0) / f.life;
      if (f.kind === "flash") {
        g.globalAlpha = 0.5 * (1 - age);
        g.drawImage(sprite("#ffffff"), f.x - 9 * sz, f.y - 9 * sz, 18 * sz, 18 * sz);
      } else if (f.kind === "spark") {
        g.globalAlpha = 0.6 * (1 - age);
        g.strokeStyle = "#fcd34d";
        g.lineWidth = 1 * sz;
        g.beginPath();
        for (let k = 0; k < 5; k++) {
          const a = f.a + Math.PI + (k - 2) * 0.5;
          const r0 = (2 + age * 6) * sz, r1 = (4 + age * 12) * sz;
          g.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0);
          g.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1);
        }
        g.stroke();
      } else {
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3 + f.a;
          const r = (2 + age * 11) * sz;
          g.globalAlpha = 0.55 * (1 - age);
          const spr = k % 2 ? sprite("#f9a8d4") : sprite("#fde68a");
          g.drawImage(spr, f.x + Math.cos(a) * r - 3 * sz, f.y + Math.sin(a) * r - 3 * sz, 6 * sz, 6 * sz);
        }
      }
    }
    stats.fx = fx.length;
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  // ---------- Loop ----------
  let last = 0;
  let clock = 0;
  let raf = 0;
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
    drawFrame(clock, dt);
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
      drawFrame(0, 0);
      return;
    }
    if (!raf && shown) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  // ---------- Zoom ----------
  const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.7, 5]).on("zoom", (ev: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
    tr = ev.transform;
    zg.attr("transform", tr.toString());
    placeSvg();
    tip.classList.remove("on");
    baseDirty = true;
    const want = tr.k >= SPLIT_K ? true : tr.k < SPLIT_K - 0.25 ? false : zoomSplit;
    if (want !== zoomSplit) {
      zoomSplit = want;
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
  bg.on("dblclick", () => svg.call(zoom.transform, d3.zoomIdentity));
  bg.on("click", () => {
    if (selOrg || selT) clearSel();
    else if (expanded.size) {
      expanded.clear();
      relayout(true);
    }
  });

  // ---------- Updates ----------
  function refresh() {
    compute(false);
    allocate();
    paintSvg();
    baseDirty = true;
    kick();
  }
  function relayout(animate: boolean) {
    const from = new Map<string, [number, number]>();
    for (const t of targets.values()) if (t.visible && Number.isFinite(t.x)) from.set(t.id, [t.x, t.y]);
    for (const p of mainProbs) {
      if (from.has(p.id)) for (const k of p.kids) if (!from.has(k.id)) from.set(k.id, from.get(p.id)!);
      if (!from.has(p.id)) {
        const k = p.kids.find((x) => from.has(x.id));
        if (k) from.set(p.id, from.get(k.id)!);
      }
    }
    for (const o of orgList) if (Number.isFinite(o.x)) from.set(o.key, [o.x, o.y]);
    computeTargets();
    compute(false);
    visStreams = allStreams.filter((s) => s.base > 0 && s.t.visible);
    if (animate && !reduced && from.size) {
      anim = { t0: performance.now(), from, dur: 750 };
      applyPositions(0);
    } else {
      anim = null;
      applyPositions(1);
    }
    if (selT && selT.kind === "prob" && !selT.visible && !visProbs.some((q) => within(q, selT!))) {
      selT = null;
      renderDetail();
    }
    allocate();
    paintSvg();
    baseDirty = true;
    kick();
  }

  clear(legend);
  legend.append(
    h("div", {}, "Left: problems the groups push back on. Each is a dark orb that cracks open with gold as more energy hits it."),
    h("div", {}, "Centre: the groups (with their logos). Groups that mostly confront problems lean left; groups that mostly build lean right."),
    h("div", {}, "Right: what the groups are building. Their energy flows along rivers and the blooms open (or the stars grow) as it arrives."),
    h("div", {}, "Each item's weight (the sliders) is split by how it works: advocacy, organizing, elections, legal and finance push back; education, community building, stewardship, service, training, individual action and research build. “Every item both ways” shows the full weight on both sides."),
    h("div", { class: "cr-legend-hint" }, "The problem and vision names are a draft for the team to review. Click a problem to split it into sharper ones; zoom in to split them all."),
  );

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
    update() {
      if (first) return;
      compute(true);
      target.clear();
      relayout(true);
      if (selOrg || selT) renderDetail();
    },
    show() {
      shown = true;
      if (first) {
        first = false;
        measure();
        compute(true);
        relayout(false);
      } else {
        measure();
        relayout(false);
      }
      kick();
    },
    hide() {
      shown = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      tip.classList.remove("on");
      selOrg = null;
      selT = null;
      renderDetail();
    },
  };
}
