// Topics page, "Command room" view: problems on the left, solutions on the right, and the groups in between.
// Groups send comets at the problems they are solving (each problem has a forcefield that shows every hit) and
// lob seed bombs at the solutions they are nurturing. Buttons choose what a hit and a nourishment look like.
// Each record's weight (the Topics sliders) is split by its strategies: confronting ones (advocacy, organizing,
// elections, legal, finance) go to the problem; building ones (education, community building, stewardship, service,
// training, individual action, research) go to the solution. "Every item both ways" sends the full weight to both.
// Calm by design: comets and seeds are launched at a slow, steady rate (each problem is hit about 1–3 times every
// few seconds), drawn on canvas with additive glow; prefers-reduced-motion shows a still picture.
import * as d3 from "d3";
import { h, clear } from "./dom";
import type { TopicRecord, TopicsFile, TopicsCallbacks } from "./topics";
import { PROBLEMS, VISIONS, SUB_SOLUTIONS, FIGHT_STRATEGIES } from "./problems";
import { PROBLEM_ICONS, SOLUTION_ICONS } from "./topicIcons";

export interface BattleCtx {
  file: TopicsFile;
  mapIds: string[];
  weight(r: TopicRecord): number;
  cap(): number;
  colorOf(parentId: string): string;
  detail: HTMLElement;
  cb: TopicsCallbacks;
}

type Show = "both" | "problems" | "solutions";
type Hit = "ripple" | "push" | "light";
type Feed = "grow" | "bloom" | "glow";
type Split = "strategy" | "both";

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
  topic: string; // main topic id
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
  visible: boolean;
  // live animation state (hits and nourishment)
  kx: number;
  ky: number;
  vx: number;
  vy: number;
  pulse: number;
  light: number;
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
  seed: number;
}
interface Shot {
  s: Stream;
  t0: number;
  dur: number;
}
interface Fx {
  t: Target;
  x: number; // offset from the target's centre, in screen pixels
  y: number;
  a: number; // direction the shot was travelling
  t0: number;
  life: number;
  kind: Hit | Feed;
  seed: number;
}

const BROAD = "broad";
const BILLS = "bills";
const STORE = "openthink.topics.battle.v2";
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
const isMission = (r: TopicRecord) => r.kind === "org_mission" || r.kind === "coalition_mission";
function within(p: Target, q: Target): boolean {
  for (let x: Target | null = p; x; x = x.up) if (x === q) return true;
  return false;
}

export function createBattle(ctx: BattleCtx): { el: HTMLElement; update(): void; show(): void; hide(): void } {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "{}") as Partial<{ show: Show; hit: Hit; feed: Feed; split: Split }>;
    } catch {
      return {};
    }
  })();
  let showing: Show = saved.show ?? "both";
  let hitMode: Hit = saved.hit ?? "ripple";
  let feedMode: Feed = saved.feed ?? "grow";
  let split: Split = saved.split ?? "strategy";
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ show: showing, hit: hitMode, feed: feedMode, split }));
    } catch {
      /* ignore */
    }
  };
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // ---------- Data ----------
  const recs = ctx.file.records.filter((r) => ctx.mapIds.includes(r.map) && (r.topics.length || r.bills.length));
  const c2p = new Map<string, string>();
  for (const p of ctx.file.parents) for (const c of p.children) c2p.set(c.id, p.id);
  const childLabel = new Map<string, string>();
  for (const p of ctx.file.parents) for (const c of p.children) childLabel.set(`${p.id}/${c.id}`, c.label);
  const targets = new Map<string, Target>();
  const getT = (id: string, kind: Target["kind"], topic: string, label: string, level: 0 | 1, up: Target | null): Target => {
    let t = targets.get(id);
    if (!t) {
      t = { id, kind, topic, label, level, up, kids: [], energy: 0, base: 0, glow: 0, x: 0, y: 0, r: 8, visible: false, kx: 0, ky: 0, vx: 0, vy: 0, pulse: 0, light: 0 };
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
      const key = `${pid}/${t}`;
      const pm = getT(`p:${pid}`, "prob", pid, PROBLEMS[pid] ?? pid, 0, null);
      const vm = getT(`v:${pid}`, "vis", pid, VISIONS[pid] ?? pid, 0, null);
      hit.add(pm);
      hit.add(vm);
      hit.add(getT(`p:${key}`, "prob", pid, PROBLEMS[key] ?? childLabel.get(key) ?? t, 1, pm));
      hit.add(getT(`v:${key}`, "vis", pid, SUB_SOLUTIONS[key] ?? childLabel.get(key) ?? t, 1, vm));
    }
    const list: Stream[] = [];
    for (const t of hit) {
      const kind = t.kind === "prob" ? "fight" : "feed";
      const k = `${kind}|${okey}|${t.id}`;
      let s = streams.get(k);
      if (!s) {
        s = { kind, org, t, recs: [], raw: 0, value: 0, base: 0, pts: new Float32Array(0), uni: new Float32Array(0), len: 1, seed: hash(k) };
        streams.set(k, s);
      }
      s.recs.push(r);
      list.push(s);
    }
    recStreams.set(r.id, list);
  }
  const order = ctx.file.parents.map((p) => p.id);
  const mainProbs = order.map((id) => targets.get(`p:${id}`)).filter((t): t is Target => !!t);
  const mainVis = order.map((id) => targets.get(`v:${id}`)).filter((t): t is Target => !!t);
  for (const m of [...mainProbs, ...mainVis]) {
    const prefix = m.kind === "prob" ? "p:" : "v:";
    const kidOrder = ctx.file.parents.find((x) => x.id === m.topic)!.children.map((c) => `${prefix}${m.topic}/${c.id}`);
    m.kids.sort((a, b) => kidOrder.indexOf(a.id) - kidOrder.indexOf(b.id));
  }
  const allStreams = [...streams.values()];
  const orgList = [...orgs.values()];
  const recW = new Map<string, number>();
  const recFight = new Map<string, number>();

  function fightShare(r: TopicRecord): number {
    if (!r.strategies.length) return 0.5;
    return r.strategies.filter((s) => FIGHT_STRATEGIES.has(s)).length / r.strategies.length;
  }

  const levelMax: Record<string, number> = { prob0: 1, prob1: 1, vis0: 1, vis1: 1 };
  let baseVer = 0;
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
      if (s.t.level === 0) {
        if (s.kind === "feed") s.org.build += s.value;
        else s.org.fight += s.value;
      }
    }
    if (intoBase) {
      baseVer++;
      for (const s of allStreams) s.base = s.value;
      for (const t of targets.values()) t.base = t.energy;
      for (const o of orgList) o.base = o.fight + o.build;
      for (const k of Object.keys(levelMax)) levelMax[k] = 0;
      for (const t of targets.values()) if (t.topic !== BROAD) levelMax[`${t.kind}${t.level}`] = Math.max(levelMax[`${t.kind}${t.level}`], t.base);
      for (const k of Object.keys(levelMax)) if (!levelMax[k]) levelMax[k] = 1;
    }
    // how much energy reaches a target, compared with the busiest one at the same depth
    for (const t of targets.values()) t.glow = Math.min(1, Math.sqrt(t.energy / levelMax[`${t.kind}${t.level}`]));
  }

  // ---------- DOM ----------
  const el = h("div", { class: "cr bt" });
  const bar = h("div", { class: "cr-bar" });
  const seg = (name: string, opts: [string, string][], cur: () => string, set: (v: string) => void) => {
    // the title sits outside the pill, as plain text, so it doesn't look like another button
    const g = h("div", { class: "cr-seg", role: "group", "aria-label": name });
    const box = h("div", { class: "cr-ctl" }, h("span", { class: "cr-ctl-label" }, name), g);
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
    return { g: box, sync };
  };
  bar.appendChild(seg("Show", [["problems", "Problems"], ["solutions", "Solutions"], ["both", "Both"]], () => showing, (v) => {
    showing = v as Show;
    el.dataset.show = showing;
    shots = [];
    refresh();
  }).g);
  bar.appendChild(seg("When a problem is hit", [["ripple", "Shield ripples"], ["push", "Pushed back"], ["light", "Light breaks in"]], () => hitMode, (v) => {
    hitMode = v as Hit;
    el.dataset.hit = hitMode;
    paintSvg();
  }).g);
  bar.appendChild(seg("When a solution is fed", [["grow", "Grows"], ["bloom", "Blooms"], ["glow", "Lights up"]], () => feedMode, (v) => {
    feedMode = v as Feed;
    el.dataset.feed = feedMode;
    paintSvg();
  }).g);
  bar.appendChild(seg("Energy", [["strategy", "Split by strategy"], ["both", "Every item both ways"]], () => split, (v) => {
    split = v as Split;
    compute(true);
    relayout(true);
  }).g);
  let splitAll = false;
  let zoomSplit = false;
  const splitSeg = seg("Detail", [["main", "Main"], ["split", "Split all"]], () => (splitAll || zoomSplit ? "split" : "main"), (v) => {
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
  el.dataset.show = showing;
  el.dataset.hit = hitMode;
  el.dataset.feed = feedMode;

  const viewport = h("div", { class: "cr-viewport" });
  const canvas = document.createElement("canvas");
  canvas.className = "cr-canvas";
  const base = document.createElement("canvas");
  viewport.appendChild(canvas);
  const svg = d3.select(viewport).append("svg").attr("class", "cr-svg bt-svg");
  const tip = h("div", { class: "cr-tip" });
  const heads = h("div", { class: "bt-heads" }, h("span", { class: "h-prob" }, "Problems we are solving"), h("span", {}, "The groups"), h("span", { class: "h-vis" }, "Solutions we are nurturing"));
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
  const field = defs.append("radialGradient").attr("id", "bt-field");
  field.append("stop").attr("offset", "55%").attr("stop-color", "#f472b6").attr("stop-opacity", 0);
  field.append("stop").attr("offset", "88%").attr("stop-color", "#f472b6").attr("stop-opacity", 0.16);
  field.append("stop").attr("offset", "100%").attr("stop-color", "#fda4af").attr("stop-opacity", 0.45);
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
  // zooming stretches the rows vertically only, so problems, groups and solutions all stay in view
  const Y = (y: number) => tr.k * y + tr.y;
  const expanded = new Set<string>();
  let selOrg: Org | null = null;
  let selT: Target | null = null;
  let hover: Stream | null = null;
  let visProbs: Target[] = [];
  let visVis: Target[] = [];
  let visStreams: Stream[] = [];
  let baseDirty = true;
  let shots: Shot[] = [];
  let fx: Fx[] = [];
  let shown = false;
  let anim: { t0: number; from: Map<string, [number, number]>; dur: number } | null = null;
  const target = new Map<string, [number, number]>();
  let xP = 200, xV = 600, cx = 400, band = 120, top = 40, bot = 560;
  let geomVer = 0;
  let paintedGeom = -1;
  let orgKey = "";
  const stats = { frames: 0, workMs: 0, avgMs: 0, maxMs: 0, intervalMs: 0, shots: 0, hits: 0, fx: 0 };
  (window as unknown as { __battle: typeof stats }).__battle = stats;

  const liveKids = (t: Target) => t.kids.filter((k) => k.base > 0);
  const isOpen = (t: Target) => liveKids(t).length > 1 && (expanded.has(t.id) || zoomSplit || splitAll);
  const showKind = (k: Stream["kind"]) => showing === "both" || (k === "fight" ? showing === "problems" : showing === "solutions");
  const sideShown = (t: Target) => showKind(t.kind === "prob" ? "fight" : "feed");

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
    top = 46;
    bot = H - 30;
    xP = small ? Math.max(100, W * 0.25) : Math.min(320, Math.max(200, W * 0.22));
    xV = W - xP;
    cx = W / 2;
    band = Math.min(W * 0.11, 160);
    // Each main topic owns a fixed band of rows, shared by its problem (left) and its solution (right) and sized
    // for its sub-topics, so splitting one topic fans it out inside its band and nothing else moves.
    const bands = new Map<string, [number, number]>();
    let u = 0;
    for (const id of order) {
      const p = targets.get(`p:${id}`), v = targets.get(`v:${id}`);
      if (!(p && p.base > 0) && !(v && v.base > 0)) continue;
      const kids = Math.max(p ? liveKids(p).length : 0, v ? liveKids(v).length : 0);
      const size = kids > 1 ? 0.55 + 0.5 * kids : 1;
      bands.set(id, [u + 0.15, u + 0.15 + size]);
      u += size + 0.3;
    }
    const total = u || 1;
    const yOf = (unit: number) => top + (unit / total) * (bot - top);
    const placeSide = (mains: Target[], x: number): Target[] => {
      const vis: Target[] = [];
      for (const m of mains) {
        const b = bands.get(m.topic);
        if (!b || m.base <= 0) continue;
        const g = isOpen(m) ? liveKids(m) : [m];
        g.forEach((t, i) => target.set(t.id, [x, yOf(b[0] + ((i + 0.5) * (b[1] - b[0])) / g.length)]));
        vis.push(...g);
      }
      return vis;
    };
    visProbs = placeSide(mainProbs, xP);
    visVis = placeSide(mainVis, xV);
    for (const t of targets.values()) t.visible = false;
    for (const t of [...visProbs, ...visVis]) t.visible = true;
    // size: area grows with the energy reaching it (vs. the busiest at the same depth), never too small for its
    // icon, never bigger than its row
    for (const t of [...visProbs, ...visVis]) {
      const b = bands.get(t.topic)!;
      const n = t.level && t.up && isOpen(t.up) ? liveKids(t.up).length : 1;
      const row = ((b[1] - b[0]) / n / total) * (bot - top);
      const k = Math.sqrt(Math.min(1, t.base / levelMax[`${t.kind}${t.level}`]));
      const want = t.level ? 7 + 6 * k : 10 + 10 * k;
      t.r = Math.max(5, Math.min(want, row * 0.42));
    }
    // groups: between the topics they work on (main topics only), fighters lean left, builders right;
    // recomputed only when the size or weights change, so zooming and splitting don't move them
    const maxO = d3.max(orgList, (o) => o.base) || 1;
    for (const o of orgList) o.r = o.base > 0 ? (small ? 2.5 : 3) + (small ? 4 : 7) * Math.sqrt(o.base / maxO) : 0;
    const key = `${Math.round(W)}|${Math.round(H)}|${baseVer}`;
    if (key === orgKey) return;
    orgKey = key;
    const oBot = H - 96; // the site's round + button sits at the bottom centre
    const live = orgList.filter((o) => o.base > 0);
    const byOrg = d3.group(allStreams.filter((s) => s.base > 0 && s.t.level === 0), (s) => s.org.key);
    const nodes = live.map((o) => {
      let sy = 0, sw = 0;
      for (const s of byOrg.get(o.key) ?? []) {
        const b = bands.get(s.t.topic);
        if (!b) continue;
        sy += yOf((b[0] + b[1]) / 2) * s.base;
        sw += s.base;
      }
      const y0 = sw ? sy / sw : (top + bot) / 2;
      const ty = top + ((y0 - top) * (oBot - top)) / (bot - top);
      const lean = o.fight + o.build > 0 ? (o.build - o.fight) / (o.build + o.fight) : 0;
      const tx = cx + lean * band * 0.85;
      return { o, tx, ty, x: tx, y: ty };
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
    for (const p of [...visProbs, ...visVis]) lerp(p.id, p, anim?.from.get(p.up?.id ?? "") ?? target.get(p.id)!);
    for (const o of orgList) if (o.base > 0) lerp(o.key, o, [cx, (top + bot) / 2]);
    for (const s of visStreams) buildGeom(s);
    geomVer++;
  }

  function buildGeom(s: Stream) {
    const o = s.org, t = s.t;
    const pts: number[] = [];
    // a lobbed arc, up and over to the target
    const dx = t.x - o.x;
    const lift = Math.min(130, Math.abs(dx) * (0.2 + 0.16 * s.seed));
    const mx = (o.x + t.x) / 2, my = Math.min(o.y, t.y) - lift;
    const c1x = o.x + (2 / 3) * (mx - o.x), c1y = o.y + (2 / 3) * (my - o.y), c2x = t.x + (2 / 3) * (mx - t.x), c2y = t.y + (2 / 3) * (my - t.y);
    for (let i = 0; i <= 36; i++) {
      const f = i / 36, a = 1 - f;
      pts.push(a * a * a * o.x + 3 * a * a * f * c1x + 3 * a * f * f * c2x + f * f * f * t.x, a * a * a * o.y + 3 * a * a * f * c1y + 3 * a * f * f * c2y + f * f * f * t.y);
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

  /** Like at(), in screen space (with the vertical zoom). */
  function atS(s: Stream, f: number, out: [number, number]) {
    at(s, f, out);
    out[1] = Y(out[1]);
  }

  // ---------- Dimming ----------
  function streamAlpha(s: Stream, withHover = true): number {
    if (!showKind(s.kind)) return 0;
    if (selOrg && s.org !== selOrg) return 0;
    if (selT && !within(s.t, selT)) return 0;
    let a = 1;
    if (s.t.topic === BROAD) a *= 0.4;
    if (withHover && hover && hover !== s) a *= 0.45;
    return a;
  }
  function refreshStreams() {
    visStreams = allStreams.filter((s) => s.base > 0 && s.t.visible);
  }

  // ---------- SVG ----------
  const hue = (t: Target) => (t.topic === BROAD ? "#9ca3af" : ctx.colorOf(t.topic));
  const orgScale = () => Math.max(1, Math.min(1.7, Math.pow(tr.k, 0.5)));
  let feeding: Set<string> | null = null;
  const orgOpacity = (o: Org) => (selOrg ? (o === selOrg ? 1 : 0.25) : feeding ? (feeding.has(o.key) ? 1 : 0.18) : 1);
  const iconPaths = (t: Target) => (t.kind === "prob" ? PROBLEM_ICONS : SOLUTION_ICONS)[t.topic] ?? [];
  const targetOpacity = (t: Target) => {
    if (selT) return within(t, selT) || within(selT, t) ? 1 : 0.3;
    if (selOrg) return visStreams.some((s) => s.org === selOrg && s.t === t && s.value > 0) ? 1 : 0.28;
    return 1;
  };

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

    for (const [layer, list, kind] of [[gProbs, visProbs, "prob"], [gVis, visVis, "vis"]] as const) {
      const sel = layer.selectAll<SVGGElement, Target>("g.bt-node").data(list, (t) => t.id);
      sel.exit().remove();
      const en = sel.enter().append("g").attr("class", (t) => `bt-node bt-${kind} lv${t.level}${t.topic === BROAD ? " broad" : ""}`).attr("data-id", (t) => t.id);
      const inner = en.append("g").attr("class", "inner");
      inner.append("circle").attr("class", "halo").attr("filter", "url(#bt-blur)");
      if (kind === "vis") inner.append("g").attr("class", "petals").selectAll("ellipse").data(d3.range(8)).enter().append("ellipse");
      if (kind === "prob") inner.append("circle").attr("class", "field");
      inner.append("circle").attr("class", "core");
      inner.append("g").attr("class", "icon").each(function (t) {
        const g = d3.select(this);
        for (const d of iconPaths(t)) g.append("path").attr("d", d);
      });
      en.append("circle").attr("class", "hit");
      en.append("text").attr("class", "lbl");
      en.on("click", (ev: MouseEvent, t) => {
        ev.stopPropagation();
        if (liveKids(t).length > 1 && !isOpen(t)) {
          expanded.add(t.id);
          selOrg = null;
          selT = t;
          relayout(true);
          renderDetail();
        } else selectTarget(t);
      })
        .on("mouseenter", (ev: MouseEvent, t) => showTargetTip(ev, t))
        .on("mousemove", (ev: MouseEvent, t) => showTargetTip(ev, t))
        .on("mouseleave", () => tip.classList.remove("on"));
      const all = en.merge(sel);
      all.classed("sel", (t) => t === selT).attr("opacity", targetOpacity).style("display", (t) => (sideShown(t) ? null : "none"));
      all.each(function (t) {
        const g = d3.select(this);
        const r = t.r, glow = t.glow, c = hue(t);
        g.select(".halo").attr("r", r * 1.7).attr("fill", kind === "prob" ? "#f43f5e" : c).attr("opacity", kind === "prob" ? 0.06 + 0.25 * glow : 0.08 + 0.45 * glow);
        g.select(".field").attr("r", r + 7);
        g.select(".core").attr("r", r);
        const s = (r * 1.25) / 24;
        g.select(".icon").attr("transform", `translate(${-12 * s},${-12 * s}) scale(${s})`);
        g.select(".petals").selectAll<SVGEllipseElement, number>("ellipse")
          .attr("rx", r * (0.26 + 0.1 * glow)).attr("ry", r * (0.4 + 0.45 * glow))
          .attr("cy", -r * (0.85 + 0.35 * glow))
          .attr("transform", (i) => `rotate(${i * 45})`)
          .attr("fill", d3.hsl(c).brighter(0.6).formatHex()).attr("opacity", 0.25 + 0.55 * glow);
        g.select(".hit").attr("r", r + 9);
        const side = kind === "prob" ? -1 : 1;
        const sx = (target.get(t.id)?.[0] ?? t.x);
        const room = Math.max(10, Math.min(46, Math.floor((kind === "prob" ? sx - r - 18 : W - sx - r - 18) / (t.level ? 6 : 6.6))));
        g.select(".lbl").text(t.label.length > room ? `${t.label.slice(0, room - 1)}…` : t.label)
          .attr("x", side * (r + (kind === "prob" ? 13 : 12))).attr("y", 0).attr("dy", "0.35em").attr("text-anchor", kind === "prob" ? "end" : "start");
      });
      // crowded column: keep the labels of the busiest targets that fit, hide the rest (they show on hover)
      const keep = new Set<string>();
      const ys: number[] = [];
      for (const t of [...list].sort((a, b) => b.energy - a.energy)) {
        const y = Y(target.get(t.id)?.[1] ?? t.y);
        if (ys.some((v) => Math.abs(v - y) < 14)) continue;
        ys.push(y);
        keep.add(t.id);
      }
      all.select(".lbl").style("display", (t) => (keep.has(t.id) ? null : "none"));
    }

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
      const x = (lx), y = Y(ly);
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

  /** Where a target is drawn now: its place, plus any knock-back, with its pulse/shrink as a scale. */
  function nodeTransform(t: Target): string {
    let sc = 1 + 0.14 * t.pulse;
    if (t.kind === "prob" && hitMode === "push") sc = (1 - 0.22 * t.glow) * (1 - 0.1 * t.pulse);
    return `translate(${t.kx.toFixed(2)},${t.ky.toFixed(2)}) scale(${sc.toFixed(3)})`;
  }
  function placeSvg() {
    const s = orgScale();
    for (const layer of [gProbs, gVis]) {
      layer.selectAll<SVGGElement, Target>("g.bt-node").attr("transform", (t) => `translate(${(t.x)},${Y(t.y)})`)
        .select(".inner").attr("transform", nodeTransform).style("--light", (t) => t.light.toFixed(2));
    }
    gOrgs.selectAll<SVGGElement, Org>("g.cr-org").attr("transform", (o) => `translate(${(o.x)},${Y(o.y)}) scale(${s})`);
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
  const verb = (t: Target) => (t.kind === "prob" ? "solving" : "nurturing");
  function showStreamTip(ev: MouseEvent, s: Stream) {
    clear(tip);
    tip.append(
      h("div", { class: "cr-tip-meta" }, s.kind === "fight" ? "solving a problem" : "nurturing a solution"),
      h("div", { class: "cr-tip-title" }, `${s.org.name} → ${s.t.label}`),
      h("div", { class: "cr-tip-meta" }, `energy ${s.value.toFixed(2)} · ${s.recs.length} item${s.recs.length === 1 ? "" : "s"}`),
    );
    for (const r of topRecs(s.recs, 3)) tip.appendChild(h("div", { class: "cr-tip-item" }, `${KIND_LABEL[r.kind]}: ${isMission(r) ? "mission statement" : r.name}`));
    placeTip(ev);
  }
  function showTargetTip(ev: MouseEvent, t: Target) {
    clear(tip);
    const n = new Set(allStreams.filter((s) => s.t === t && s.value > 0).map((s) => s.org)).size;
    const finer = liveKids(t).length;
    tip.append(
      h("div", { class: "cr-tip-meta" }, t.kind === "prob" ? (t.up ? `Problem · part of “${t.up.label}”` : "Problem") : t.up ? `Solution · part of “${t.up.label}”` : "Solution"),
      h("div", { class: "cr-tip-title" }, t.label),
      h("div", { class: "cr-tip-meta" }, `${n} group${n === 1 ? "" : "s"} ${verb(t)} it · energy ${t.energy.toFixed(1)}`),
      h("div", { class: "cr-tip-item" }, finer > 1 && !isOpen(t) ? `Click to split it into ${finer} finer ${t.kind === "prob" ? "problems" : "solutions"}` : "Click to see who is on it"),
    );
    placeTip(ev);
  }
  function showOrgTip(ev: MouseEvent, o: Org) {
    clear(tip);
    tip.append(h("div", { class: "cr-tip-title" }, o.name),
      h("div", { class: "cr-tip-meta" }, `solving problems ${o.fight.toFixed(1)} · nurturing solutions ${o.build.toFixed(1)}`),
      h("div", { class: "cr-tip-item" }, "Click to show only its comets and seeds"));
    placeTip(ev);
  }

  // ---------- Selection + detail ----------
  function selectTarget(t: Target) {
    selOrg = null;
    selT = selT === t ? null : t;
    shots = [];
    refresh();
    renderDetail();
  }
  function selectOrg(o: Org) {
    selT = null;
    selOrg = selOrg === o ? null : o;
    shots = [];
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
        h("span", { class: "pill" }, f >= 0.99 ? "solves a problem" : f <= 0.01 ? "nurtures a solution" : "both"),
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
      const list = allStreams.filter((s) => s.t === t && s.value > 0).sort((a, b) => b.value - a.value);
      const kindName = t.kind === "prob" ? "Problem" : "Solution";
      d.append(h("div", { class: "topics-detail-parent" }, t.up ? `${kindName} · ${t.up.label}` : kindName), h("h3", {}, t.label),
        h("div", { class: "topics-detail-meta" }, `${list.length} group${list.length === 1 ? "" : "s"} ${verb(t)} it · energy ${t.energy.toFixed(1)}`));
      const finer = liveKids(t).sort((a, b) => b.energy - a.energy);
      if (finer.length > 1) {
        d.appendChild(h("div", { class: "cr-sub" }, t.kind === "prob" ? "Finer problems inside it" : "Finer solutions inside it"));
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
      d.appendChild(h("div", { class: "cr-sub" }, t.kind === "prob" ? "Who is solving it" : "Who is nurturing it"));
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
        h("div", { class: "topics-detail-meta" }, `solving problems ${o.fight.toFixed(1)} · nurturing solutions ${o.build.toFixed(1)}`),
        mapButton(o.host, "See this group on the map ↗", "cr-mapbtn"));
      for (const kind of ["fight", "feed"] as const) {
        const mine = allStreams.filter((s) => s.org === o && s.kind === kind && s.t.level === 0 && s.value > 0).sort((a, b) => b.value - a.value);
        if (!mine.length) continue;
        d.appendChild(h("div", { class: "cr-sub" }, kind === "fight" ? "Problems it is solving" : "Solutions it is nurturing"));
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
    g.setTransform(dpr, 0, 0, dpr * tr.k, 0, dpr * tr.y);
    g.lineCap = "round";
    const lw = 1 / Math.sqrt(tr.k);
    const live = visStreams.filter((s) => s.value > 0);
    const vmax = d3.max(live, (s) => s.value) || 1;
    g.globalCompositeOperation = "lighter";
    for (const s of live) {
      const a = streamAlpha(s);
      if (a <= 0) continue;
      const k = Math.sqrt(s.value / vmax);
      const c = d3.color(s.kind === "fight" ? tColor(s.t) : "#a3e635")!;
      c.opacity = (s === hover ? 0.7 : (s.kind === "fight" ? 0.025 + 0.09 * k : 0.02 + 0.07 * k) * a) * (reduced ? 2.2 : 1);
      g.strokeStyle = c.formatRgb();
      g.lineWidth = (s === hover ? 2 : 0.5 + 1.1 * k) * lw;
      if (s.kind === "feed") g.setLineDash([1.5, 5]);
      g.beginPath();
      g.moveTo(s.pts[0], s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) g.lineTo(s.pts[i], s.pts[i + 1]);
      g.stroke();
      g.setLineDash([]);
    }
    g.globalCompositeOperation = "source-over";
    baseDirty = false;
  }

  /** Launch comets and seeds at a slow, steady rate: each target gets about 1–3 every few seconds. */
  function launch(dt: number, now: number) {
    if (reduced || dt <= 0) return;
    const byTarget = new Map<Target, Stream[]>();
    for (const s of visStreams) {
      if (s.value <= 0 || streamAlpha(s, false) <= 0) continue;
      (byTarget.get(s.t) ?? byTarget.set(s.t, []).get(s.t)!).push(s);
    }
    for (const [t, list] of byTarget) {
      if (shots.length > 140) break;
      let rate = (t.kind === "prob" ? 0.18 + 0.55 * t.glow : 0.2 + 0.6 * t.glow) * (t.topic === BROAD ? 0.4 : 1);
      if (selOrg) rate = 0.35 * list.length; // one group selected: each of its streams fires now and then
      if (selT) rate *= 1.6;
      if (Math.random() >= rate * dt) continue;
      // pick one of its streams, weighted by energy
      const tot = d3.sum(list, (s) => s.value);
      let x = Math.random() * tot;
      let pick = list[0];
      for (const s of list) {
        x -= s.value;
        if (x <= 0) {
          pick = s;
          break;
        }
      }
      const speed = pick.kind === "fight" ? 120 : 75; // px per second: slow, so the eye can follow
      shots.push({ s: pick, t0: now, dur: (pick.len / speed) * 1000 });
    }
    if (hover && hover.value > 0 && Math.random() < 0.9 * dt && shots.length < 160) shots.push({ s: hover, t0: now, dur: (hover.len / (hover.kind === "fight" ? 120 : 75)) * 1000 });
  }

  function arrive(sh: Shot, now: number) {
    const s = sh.s, t = s.t;
    // where it struck, in screen space, as an offset from the target's centre
    atS(s, 0.96, Q);
    const a = Math.atan2(Y(t.y) - Q[1], t.x - Q[0]);
    const rr = t.r + (t.kind === "prob" ? 7 : 2);
    const x = -Math.cos(a) * rr, y = -Math.sin(a) * rr;
    stats.hits++;
    if (t.kind === "prob") {
      if (hitMode === "push") {
        t.vx += Math.cos(a) * 40;
        t.vy += Math.sin(a) * 40;
        t.pulse = Math.min(1, t.pulse + 0.6);
      } else if (hitMode === "light") t.light = Math.min(1, t.light + 0.55);
      else t.pulse = Math.min(1, t.pulse + 0.35);
      fx.push({ t, x, y, a, t0: now, life: hitMode === "light" ? 1800 : hitMode === "push" ? 700 : 1100, kind: hitMode, seed: Math.random() });
    } else {
      t.pulse = Math.min(1, t.pulse + (feedMode === "grow" ? 0.5 : 0.35));
      if (feedMode === "glow") t.light = Math.min(1, t.light + 0.6);
      fx.push({ t, x, y, a, t0: now, life: feedMode === "grow" ? 2200 : feedMode === "bloom" ? 1300 : 1500, kind: feedMode, seed: Math.random() });
    }
    if (fx.length > 90) fx.shift();
  }

  /** Springs and fades on the targets (knock-back, pulses, light). Returns true if anything moved. */
  function settle(dt: number): boolean {
    let any = false;
    for (const t of [...visProbs, ...visVis]) {
      if (!t.vx && !t.vy && !t.kx && !t.ky && !t.pulse && !t.light) continue;
      any = true;
      // a damped spring pulls a knocked-back problem home again
      t.vx += (-60 * t.kx - 9 * t.vx) * dt;
      t.vy += (-60 * t.ky - 9 * t.vy) * dt;
      t.kx += t.vx * dt;
      t.ky += t.vy * dt;
      t.pulse = Math.max(0, t.pulse - dt * 1.4);
      t.light = Math.max(0, t.light - dt * 0.6);
      if (Math.abs(t.kx) < 0.05 && Math.abs(t.vx) < 0.05) t.kx = t.vx = 0;
      if (Math.abs(t.ky) < 0.05 && Math.abs(t.vy) < 0.05) t.ky = t.vy = 0;
    }
    return any;
  }

  function drawFrame(now: number) {
    const g = canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (baseDirty) drawBase();
    g.drawImage(base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = "lighter";
    const sz = 1;

    if (reduced) {
      // still picture: one resting comet or seed along each stream
      for (const s of visStreams) {
        const a = streamAlpha(s);
        if (a <= 0 || s.value <= 0) continue;
        atS(s, 0.55 + 0.3 * s.seed, P);
        g.globalAlpha = 0.5 * a;
        const spr = s.kind === "fight" ? sprite(tColor(s.t)) : sprite("#bef264");
        g.drawImage(spr, P[0] - 3 * sz, P[1] - 3 * sz, 6 * sz, 6 * sz);
      }
    }

    // comets and seeds in flight
    const keep: Shot[] = [];
    for (const sh of shots) {
      const f = (now - sh.t0) / sh.dur;
      if (f >= 1) {
        if (sh.s.t.visible) arrive(sh, now);
        continue;
      }
      if (!sh.s.t.visible || !sh.s.uni.length) continue;
      keep.push(sh);
      const s = sh.s;
      const a = Math.max(0.25, streamAlpha(s));
      if (s.kind === "fight") {
        const spr = sprite(tColor(s.t));
        const tail = 26 / s.len;
        for (let k = 4; k >= 0; k--) {
          const ff = f - k * tail * 0.3;
          if (ff < 0) continue;
          atS(s, ff, P);
          const size = (8 - k * 1.3) * sz;
          g.globalAlpha = Math.min(1, (0.75 - k * 0.14) * a);
          g.drawImage(spr, P[0] - size / 2, P[1] - size / 2, size, size);
        }
      } else {
        // a seed bomb: a small tumbling seed with a faint trail of pollen
        atS(s, f, P);
        g.globalAlpha = Math.min(1, 0.85 * a);
        const size = (6 + Math.sin(now / 120 + s.seed * 9)) * sz;
        g.drawImage(sprite("#bef264"), P[0] - size / 2, P[1] - size / 2, size, size);
        for (let k = 1; k <= 3; k++) {
          atS(s, f - (k * 10) / s.len, Q);
          g.globalAlpha = (0.3 - k * 0.08) * a;
          g.drawImage(sprite("#fde68a"), Q[0] - 1.5 * sz, Q[1] - 1.5 * sz, 3 * sz, 3 * sz);
        }
      }
    }
    shots = keep;
    stats.shots = shots.length;

    // what a hit or a nourishment looks like
    fx = fx.filter((e) => now - e.t0 < e.life);
    for (const e of fx) {
      const age = (now - e.t0) / e.life;
      const t = e.t;
      if (!t.visible || !sideShown(t)) continue;
      const cx0 = t.x + t.kx, cy0 = Y(t.y) + t.ky;
      const ex = cx0 + e.x, ey = cy0 + e.y;
      if (e.kind === "ripple") {
        // the forcefield lights up where it was struck, and a ring runs around it
        const fr = t.r + 7;
        g.globalAlpha = 0.85 * (1 - age);
        g.strokeStyle = "#fda4af";
        g.lineWidth = (2.4 - 1.6 * age) * sz;
        g.beginPath();
        g.arc(cx0, cy0, fr, e.a + Math.PI - 0.7 - age * 1.6, e.a + Math.PI + 0.7 + age * 1.6);
        g.stroke();
        g.globalAlpha = 0.35 * (1 - age);
        g.lineWidth = 1 * sz;
        g.beginPath();
        g.arc(cx0, cy0, fr + age * 10, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 0.7 * (1 - age);
        g.drawImage(sprite("#ffe4e6"), ex - 7 * sz, ey - 7 * sz, 14 * sz, 14 * sz);
      } else if (e.kind === "push") {
        // a sharp spark at the point of impact; the problem itself is knocked back and shrinks (SVG)
        g.globalAlpha = 0.8 * (1 - age);
        g.strokeStyle = "#fcd34d";
        g.lineWidth = 1.2 * sz;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const an = e.a + Math.PI + (k - 2.5) * 0.45;
          g.moveTo(ex + Math.cos(an) * (2 + age * 4) * sz, ey + Math.sin(an) * (2 + age * 4) * sz);
          g.lineTo(ex + Math.cos(an) * (5 + age * 12) * sz, ey + Math.sin(an) * (5 + age * 12) * sz);
        }
        g.stroke();
      } else if (e.kind === "light") {
        // light seeps through the shield and into the problem
        const fr = t.r + 7;
        const p = Math.min(1, age * 2.2);
        const lx = ex + (cx0 - ex) * p, ly = ey + (cy0 - ey) * p;
        g.globalAlpha = 0.65 * (1 - age);
        g.drawImage(sprite("#fde68a"), lx - 9 * sz, ly - 9 * sz, 18 * sz, 18 * sz);
        g.globalAlpha = 0.35 * (1 - age);
        g.strokeStyle = "#fde68a";
        g.lineWidth = 1 * sz;
        for (let k = -1; k <= 1; k++) {
          const an = e.a + k * 0.35;
          g.beginPath();
          g.moveTo(cx0 - Math.cos(an) * fr * 1.6, cy0 - Math.sin(an) * fr * 1.6);
          g.lineTo(cx0 - Math.cos(an) * fr * (1 - p), cy0 - Math.sin(an) * fr * (1 - p));
          g.stroke();
        }
      } else if (e.kind === "grow") {
        // a sprout: two little stems with leaves grow out from where the seed landed, then fade
        const p = Math.min(1, age * 2.5);
        const fade = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.4;
        g.strokeStyle = "#86efac";
        g.lineWidth = 1.2 * sz;
        for (const side of [-1, 1]) {
          const an = e.a + Math.PI + side * (0.5 + e.seed * 0.4);
          const L = (5 + 6 * e.seed) * p * sz * 1.3;
          const tx2 = ex + Math.cos(an) * L, ty2 = ey + Math.sin(an) * L;
          g.globalAlpha = 0.85 * fade;
          g.beginPath();
          g.moveTo(ex, ey);
          g.quadraticCurveTo(ex + Math.cos(an + side * 0.6) * L * 0.6, ey + Math.sin(an + side * 0.6) * L * 0.6, tx2, ty2);
          g.stroke();
          g.globalAlpha = 0.7 * fade;
          g.drawImage(sprite("#4ade80", 0.5), tx2 - 3 * sz, ty2 - 3 * sz, 6 * sz, 6 * sz);
        }
      } else if (e.kind === "bloom") {
        // a burst of petals
        for (let k = 0; k < 7; k++) {
          const an = (k * Math.PI * 2) / 7 + e.seed * 6;
          const rr = (3 + age * 16) * sz;
          g.globalAlpha = 0.6 * (1 - age);
          g.drawImage(sprite(k % 2 ? "#f9a8d4" : "#fde68a"), ex + Math.cos(an) * rr - 3 * sz, ey + Math.sin(an) * rr - 3 * sz, 6 * sz, 6 * sz);
        }
      } else {
        // it lights up: a warm ring of light spreads out from the solution
        g.globalAlpha = 0.5 * (1 - age);
        g.strokeStyle = "#fde68a";
        g.lineWidth = 1.6 * sz;
        g.beginPath();
        g.arc(cx0, cy0, t.r + 3 + age * 22, 0, Math.PI * 2);
        g.stroke();
        for (let k = 0; k < 5; k++) {
          const an = e.seed * 6 + k * 1.3;
          const rr = t.r + 4 + age * 14;
          g.globalAlpha = 0.5 * (1 - age);
          g.drawImage(sprite("#fef9c3"), cx0 + Math.cos(an) * rr - 2 * sz, cy0 + Math.sin(an) * rr - 2 * sz, 4 * sz, 4 * sz);
        }
      }
    }
    // problems glowing gold while light is in them; solutions lit up
    for (const t of [...visProbs, ...visVis]) {
      if (t.light <= 0.01 || !sideShown(t)) continue;
      g.globalAlpha = 0.55 * t.light;
      const size = t.r * 3.2;
      g.drawImage(sprite("#fde68a", 0.6), t.x + t.kx - size / 2, Y(t.y) + t.ky - size / 2, size, size);
    }
    stats.fx = fx.length;
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }

  // ---------- Loop ----------
  let last = 0;
  let raf = 0;
  function frame(now: number) {
    raf = 0;
    if (!shown || !el.isConnected || el.offsetParent === null) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    if (last) stats.intervalMs = stats.intervalMs ? stats.intervalMs * 0.95 + (now - last) * 0.05 : now - last;
    last = now;
    const t0 = performance.now();
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.dur);
      applyPositions(t);
      baseDirty = true;
      if (t >= 1) {
        anim = null;
        paintSvg();
      }
    }
    launch(dt, now);
    const moving = settle(dt);
    drawFrame(now);
    if (moving || anim) placeSvg();
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
        paintSvg();
      }
      drawFrame(performance.now());
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
    zg.attr("transform", `matrix(1,0,0,${tr.k},0,${tr.y})`);
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
    refreshStreams();
    paintSvg();
    baseDirty = true;
    kick();
  }
  function relayout(animate: boolean) {
    const from = new Map<string, [number, number]>();
    for (const t of targets.values()) if (t.visible && Number.isFinite(t.x)) from.set(t.id, [t.x, t.y]);
    for (const m of [...mainProbs, ...mainVis]) {
      if (from.has(m.id)) for (const k of m.kids) if (!from.has(k.id)) from.set(k.id, from.get(m.id)!);
      if (!from.has(m.id)) {
        const k = m.kids.find((x) => from.has(x.id));
        if (k) from.set(m.id, from.get(k.id)!);
      }
    }
    for (const o of orgList) if (Number.isFinite(o.x)) from.set(o.key, [o.x, o.y]);
    computeTargets();
    compute(false);
    refreshStreams();
    shots = shots.filter((sh) => sh.s.t.visible);
    if (animate && !reduced && from.size) {
      anim = { t0: performance.now(), from, dur: 750 };
      applyPositions(0);
    } else {
      anim = null;
      applyPositions(1);
    }
    if (selT && !selT.visible && ![...visProbs, ...visVis].some((q) => within(q, selT!))) {
      selT = null;
      renderDetail();
    }
    paintSvg();
    baseDirty = true;
    kick();
  }

  clear(legend);
  legend.append(
    h("div", {}, "Left: problems the groups are solving. Each sits inside a forcefield; comets from the groups strike it. Right: solutions they are nurturing, fed by seed bombs."),
    h("div", {}, "Centre: the groups, with their logos. Groups that mostly confront problems lean left; groups that mostly build solutions lean right."),
    h("div", {}, "Size: a problem or solution's area grows with the energy reaching it, compared with the busiest one at the same level. Busier ones are also hit (or fed) more often, about 1–3 times every few seconds."),
    h("div", {}, "Each item's weight (the sliders) is split by how it works: advocacy, organizing, elections, legal and finance go to the problem; education, community building, stewardship, service, training, individual action and research go to the solution. “Every item both ways” sends the full weight to both."),
    h("div", { class: "cr-legend-hint" }, "Click a problem or solution to split it into finer ones; zoom in to split them all. The problem and solution names are a draft for the team to review."),
  );

  let first = true;
  new ResizeObserver(() => {
    if (!shown || el.offsetParent === null) return;
    const r = viewport.getBoundingClientRect();
    if (Math.abs(r.width - W) < 2 && Math.abs(r.height - H) < 2) return;
    measure();
    target.clear();
    orgKey = "";
    relayout(false);
  }).observe(viewport);

  return {
    el,
    update() {
      if (first) return;
      compute(true);
      target.clear();
      orgKey = "";
      relayout(true);
      if (selOrg || selT) renderDetail();
    },
    show() {
      shown = true;
      if (first) {
        first = false;
        measure();
        compute(true);
      } else measure();
      relayout(false);
      kick();
    },
    hide() {
      shown = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      shots = [];
      fx = [];
      tip.classList.remove("on");
      selOrg = null;
      selT = null;
      renderDetail();
    },
  };
}
