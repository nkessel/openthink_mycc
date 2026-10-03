// Topics page ("topic galaxy"): zoomable circle packing of where the groups' organizing energy goes.
// Parent topics → child topics (bills sit inside "Climate policy & legislation"). Each bubble's size is a
// weighted sum of the records tagged with it (public/topics.json, built by scripts/topic-tags.mjs), and the
// sliders set those weights. The topic list is a draft under team review.
import * as d3 from "d3";
import { h, clear } from "./dom";
import { currentMap, MAPS, type MapId } from "./maps";

export interface TopicRecord {
  id: string;
  map: string;
  kind: "event" | "project" | "action" | "org_mission" | "coalition_mission";
  name: string;
  host: string;
  host_name: string;
  topics: string[];
  bills: string[];
  strategies: string[];
  recurring: boolean;
  climate_relevance: "core" | "adjacent" | "none";
  date?: string;
  status?: string;
  link?: string;
}

interface TopicsFile {
  generated_at: string;
  status: string;
  parents: { id: string; label: string; children: { id: string; label: string }[] }[];
  bills: { id: string; name: string; map: string }[];
  records: TopicRecord[];
}

export interface TopicsCallbacks {
  /** Show this group on the map (its id in the map data); false when it isn't on this map. */
  onGroupClick(hostId: string): boolean;
  hasGroup(hostId: string): boolean;
}

interface Weights {
  project: number;
  event: number;
  action: number;
  recurring: number;
  recency: number;
  mission: number;
  cap: number;
  related: number;
}

const DEFAULTS: Weights = { project: 0.6, event: 0.5, action: 0.5, recurring: 0.5, recency: 0.3, mission: 0.15, cap: 0.5, related: 0.4 };
const SLIDERS: { key: keyof Weights; label: string; hint: string }[] = [
  { key: "project", label: "Projects", hint: "How much each project counts." },
  { key: "event", label: "Events", hint: "How much each event counts." },
  { key: "action", label: "Actions", hint: "How much each action or volunteer role counts." },
  { key: "recurring", label: "Recurring events", hint: "Events that repeat (weekly meetings, standing vigils). Middle = same as one-off events." },
  { key: "recency", label: "Recency", hint: "How much newer activity counts over older. Lowest = age doesn't matter." },
  { key: "mission", label: "Mission statements", hint: "A second layer: what groups say they work on, even with no current events." },
  { key: "cap", label: "Cap per group", hint: "Limits how much one group can add to a topic. Lowest = no limit." },
  { key: "related", label: "Related issues", hint: "Records about related issues (peace, housing, health…) or with no climate link." },
];
const STORE = "openthink.topics.v1";
const BROAD = "broad";
const POLICY = "policy";

type Leaf = { id: string; label: string; parent: string; recs: TopicRecord[]; value: number; groups: number };
type NodeDatum = { id: string; label: string; children?: NodeDatum[]; leaf?: Leaf; parentId?: string };
type PNode = d3.HierarchyCircularNode<NodeDatum>;

function loadWeights(): Weights {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Weights>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

const KIND_LABEL: Record<TopicRecord["kind"], string> = {
  event: "Event",
  project: "Project",
  action: "Action",
  org_mission: "Mission statement",
  coalition_mission: "Mission statement",
};

/** Age in days used by the recency slider (0 = current). */
function ageDays(r: TopicRecord, today: number): number {
  if (r.kind === "event" && r.date) {
    const t = Date.parse(r.date);
    return Number.isFinite(t) ? Math.max(0, (today - t) / 86400000) : 180;
  }
  if (r.kind === "project") return r.status === "completed" ? 730 : r.status ? 0 : 365;
  if (r.kind === "action") return 90;
  return 0; // mission statements describe the group now
}

export function createTopicsView(cb: TopicsCallbacks): { el: HTMLElement; show(): void } {
  const wrap = h("div", { class: "list-view topics-view" });
  const toolbar = h("div", { class: "list-toolbar" });
  toolbar.appendChild(h("h2", {}, "Topics"));
  const count = h("span", { class: "count" }, "");
  toolbar.appendChild(count);
  toolbar.appendChild(
    h("span", { class: "topics-draft" }, "Draft: this topic list is still under team review, so names and groupings will change."),
  );
  wrap.appendChild(toolbar);

  const body = h("div", { class: "topics-body" });
  wrap.appendChild(body);
  const panel = h("div", { class: "topics-panel" });
  const stage = h("div", { class: "topics-stage" });
  const crumbs = h("div", { class: "topics-crumbs" });
  const detail = h("div", { class: "topics-detail" });
  stage.appendChild(crumbs);
  body.append(panel, stage, detail);

  const weights = loadWeights();
  let file: TopicsFile | null = null;
  let loading: Promise<void> | null = null;
  let render: (() => void) | null = null;

  // ---- Sliders ----
  panel.appendChild(h("div", { class: "topics-panel-head" }, "Bubble size"));
  panel.appendChild(h("div", { class: "ctrl-hint" }, "Each bubble is the weighted count of events, projects, actions and mission statements tagged with that topic."));
  const inputs = new Map<keyof Weights, HTMLInputElement>();
  for (const s of SLIDERS) {
    const box = h("div", { class: "control topics-slider" });
    box.appendChild(h("label", { class: "ctrl-label", for: `ts-${s.key}` }, s.label));
    const input = h("input", { id: `ts-${s.key}`, type: "range", min: "0", max: "1", step: "0.01", value: String(weights[s.key]), class: "slider", "data-key": s.key }) as HTMLInputElement;
    input.addEventListener("input", () => {
      weights[s.key] = parseFloat(input.value);
      try {
        localStorage.setItem(STORE, JSON.stringify(weights));
      } catch {
        /* ignore */
      }
      render?.();
    });
    inputs.set(s.key, input);
    box.appendChild(input);
    box.appendChild(h("div", { class: "topics-scale" }, h("span", {}, "Not important"), h("span", {}, "Important")));
    box.appendChild(h("div", { class: "ctrl-hint" }, s.hint));
    panel.appendChild(box);
  }
  const reset = h("button", { class: "reset-btn", type: "button" }, "Reset sliders");
  reset.addEventListener("click", () => {
    Object.assign(weights, DEFAULTS);
    for (const [k, el] of inputs) el.value = String(weights[k]);
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* ignore */
    }
    render?.();
  });
  panel.appendChild(reset);

  // ---- Weighting ----
  const today = Date.now();
  function weight(r: TopicRecord): number {
    const isMission = r.kind === "org_mission" || r.kind === "coalition_mission";
    let w = isMission ? weights.mission : weights[r.kind as "event" | "project" | "action"];
    if (r.recurring && r.kind === "event") w *= 2 * weights.recurring;
    if (weights.recency > 0) w *= Math.exp((-3 * weights.recency * ageDays(r, today)) / 365);
    if (r.climate_relevance !== "core") w *= weights.related;
    return w;
  }
  /** Sum of record weights, with each group's share capped (the "Cap per group" slider). */
  function leafValue(recs: TopicRecord[]): { value: number; groups: number } {
    const cap = weights.cap <= 0 ? Infinity : 1 + (1 - weights.cap) * 9;
    const byGroup = new Map<string, number>();
    for (const r of recs) {
      const w = weight(r);
      if (w > 0) byGroup.set(`${r.map}:${r.host}`, (byGroup.get(`${r.map}:${r.host}`) || 0) + w);
    }
    let value = 0;
    for (const v of byGroup.values()) value += Math.min(cap, v);
    return { value, groups: byGroup.size };
  }

  function buildTree(f: TopicsFile, maps: string[]): { root: NodeDatum; leaves: Leaf[]; nRecords: number } {
    const recs = f.records.filter((r) => maps.includes(r.map));
    const byChild = new Map<string, TopicRecord[]>();
    const byBill = new Map<string, TopicRecord[]>();
    for (const r of recs) {
      for (const t of r.topics) {
        if (t === "bills" && r.bills.length) continue; // shown under the bill itself
        (byChild.get(t) || byChild.set(t, []).get(t)!).push(r);
      }
      for (const b of r.bills) (byBill.get(b) || byBill.set(b, []).get(b)!).push(r);
    }
    const leaves: Leaf[] = [];
    const parents: NodeDatum[] = f.parents.map((p) => {
      const kids: NodeDatum[] = [];
      for (const c of p.children) {
        if (p.id === POLICY && c.id === "bills") {
          // Bills are children of "Climate policy & legislation".
          for (const b of f.bills) {
            const list = byBill.get(b.id);
            if (!list?.length) continue;
            const leaf: Leaf = { id: `bill:${b.id}`, label: b.name, parent: p.id, recs: list, value: 0, groups: 0 };
            leaves.push(leaf);
            kids.push({ id: leaf.id, label: leaf.label, leaf, parentId: p.id });
          }
          const other = byChild.get("bills");
          if (other?.length) {
            const leaf: Leaf = { id: "bills", label: "Other named bills", parent: p.id, recs: other, value: 0, groups: 0 };
            leaves.push(leaf);
            kids.push({ id: leaf.id, label: leaf.label, leaf, parentId: p.id });
          }
          continue;
        }
        const list = byChild.get(c.id);
        if (!list?.length) continue;
        const leaf: Leaf = { id: c.id, label: c.label, parent: p.id, recs: list, value: 0, groups: 0 };
        leaves.push(leaf);
        kids.push({ id: leaf.id, label: leaf.label, leaf, parentId: p.id });
      }
      return { id: `p:${p.id}`, label: p.label, children: kids };
    });
    return { root: { id: "root", label: "All topics", children: parents.filter((p) => p.children!.length) }, leaves, nRecords: recs.length };
  }

  // ---- Drawing ----
  function setup(f: TopicsFile) {
    const mapIds: string[] = currentMap.combine ? [...currentMap.combine] : [currentMap.id];
    const { root: tree, leaves, nRecords } = buildTree(f, mapIds);
    const tagged = new Set(leaves.flatMap((l) => l.recs.map((r) => r.id))).size;
    count.textContent = `${tagged} of ${nRecords} records tagged · ${mapIds.map((m) => MAPS[m as MapId]?.name ?? m).join(" + ")}`;
    const parentIds = tree.children!.map((p) => p.id);
    const hue = d3.scaleOrdinal<string, string>().domain(parentIds).range(
      parentIds.map((_, i) => d3.hsl((i * 360) / parentIds.length + 200, 0.55, 0.6).formatHex()),
    );
    const colorOf = (d: PNode): string => {
      const pid = d.depth === 1 ? d.data.id : d.data.parentId ? `p:${d.data.parentId}` : "";
      if (pid === `p:${BROAD}`) return "#6b7280";
      return pid ? hue(pid) : "#38bdf8";
    };

    const svg = d3.select(stage).append("svg").attr("class", "topics-svg");
    const g = svg.append("g");
    let W = 800, H = 600, size = 600;
    let focus: PNode;
    let view: [number, number, number] = [0, 0, 600];
    let root: PNode;
    let selectedLeaf: string | null = null;

    function pack(): PNode {
      for (const l of leaves) Object.assign(l, leafValue(l.recs));
      const hier = d3.hierarchy<NodeDatum>(tree)
        .sum((d) => (d.leaf ? d.leaf.value : 0))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      return d3.pack<NodeDatum>().size([size, size]).padding((d) => (d.depth === 0 ? 10 : 4))(hier);
    }

    function measure() {
      const r = stage.getBoundingClientRect();
      W = Math.max(320, r.width);
      H = Math.max(320, r.height - 34);
      size = Math.min(W, H);
      svg.attr("viewBox", `${-W / 2} ${-H / 2} ${W} ${H}`).attr("width", W).attr("height", H);
    }

    function zoomTo(v: [number, number, number]) {
      view = v;
      const k = size / v[2];
      g.selectAll<SVGGElement, PNode>("g.tnode")
        .attr("transform", (d) => `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`)
        .select("circle")
        .attr("r", (d) => Math.max(0, d.r * k));
      g.selectAll<SVGTextElement, PNode>("text.tlabel")
        .attr("transform", (d) => `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`)
        // fit the label inside its bubble (about 0.55em per character)
        .style("font-size", (d) => `${Math.max(9, Math.min(16, (1.8 * d.r * k) / (0.55 * Math.max(6, d.data.label.length))))}px`);
    }

    /** Labels show for the focus's children (and the focus itself when it is a topic with no children). */
    function labelVisible(d: PNode): boolean {
      return !!d.value && d.parent === focus;
    }
    function updateLabels(animate: boolean) {
      const sel = g.selectAll<SVGTextElement, PNode>("text.tlabel");
      const t = animate ? sel.transition().duration(400) : sel;
      t.style("opacity", (d) => (labelVisible(d) ? 1 : 0));
      sel.style("display", (d) => (labelVisible(d) ? "inline" : "none"));
    }

    function draw(animate: boolean) {
      const old = new Map<string, PNode>();
      if (root) root.each((d) => old.set(d.data.id, d));
      root = pack();
      // keep the focus on the same topic after a slider change
      const fid: string = focus ? focus.data.id : "root";
      focus = root.descendants().find((d) => d.data.id === fid) ?? root;
      const nodes = root.descendants().slice(1);
      const sel = g.selectAll<SVGGElement, PNode>("g.tnode").data(nodes, (d) => d.data.id);
      const enter = sel.enter().append("g").attr("class", (d) => `tnode depth${d.depth}${d.children ? " has-kids" : " leaf"}${d.data.id === `p:${BROAD}` || d.data.parentId === BROAD ? " broad" : ""}`)
        .attr("data-id", (d) => d.data.id);
      enter.append("circle")
        .attr("fill", (d) => colorOf(d))
        .attr("stroke", (d) => colorOf(d))
        .on("click", (ev: MouseEvent, d) => {
          ev.stopPropagation();
          if (d.children) {
            if (focus !== d) zoom(d);
            else if (d.parent) zoom(d.parent);
          } else {
            // A topic opens its list beside the bubbles; the view stays on its parent so neighbours stay in sight.
            if (d.parent && focus !== d.parent) zoom(d.parent);
            selectLeaf(d);
          }
        });
      enter.append("title");
      sel.exit().remove();
      const all = enter.merge(sel);
      all.select("title").text((d) => {
        const l = d.data.leaf;
        const n = l ? `${l.recs.length} records · ${l.groups} groups` : `${d.leaves().reduce((a, x) => a + (x.data.leaf?.recs.length ?? 0), 0)} tags`;
        return `${d.data.label}\n${n}\nweight ${(d.value ?? 0).toFixed(1)}`;
      });
      all.attr("data-r", (d) => d.r.toFixed(2));
      all.classed("empty", (d) => !d.value);

      const lsel = g.selectAll<SVGTextElement, PNode>("text.tlabel").data(nodes, (d) => d.data.id);
      lsel.enter().append("text").attr("class", (d) => `tlabel depth${d.depth}${d.data.id === `p:${BROAD}` || d.data.parentId === BROAD ? " broad" : ""}`)
        .attr("dy", "0.35em").text((d) => d.data.label).style("opacity", 0);
      lsel.exit().remove();
      g.selectAll("text.tlabel").raise();

      const target: [number, number, number] = [focus.x, focus.y, focus.r * 2];
      if (animate && old.size) {
        // tween each node from its old place/size to the new one, at the current zoom
        const k0 = view;
        g.transition().duration(450).tween("resize", () => {
          const iv = d3.interpolate(k0, target);
          const pos = new Map<string, { x: (t: number) => number; y: (t: number) => number; r: (t: number) => number }>();
          for (const d of root.descendants()) {
            const o = old.get(d.data.id);
            pos.set(d.data.id, { x: d3.interpolateNumber(o?.x ?? d.x, d.x), y: d3.interpolateNumber(o?.y ?? d.y, d.y), r: d3.interpolateNumber(o?.r ?? 0, d.r) });
          }
          const fin = root.descendants().map((d) => ({ d, x: d.x, y: d.y, r: d.r }));
          return (t: number) => {
            for (const f of fin) { const p = pos.get(f.d.data.id)!; f.d.x = p.x(t); f.d.y = p.y(t); f.d.r = p.r(t); }
            zoomTo(iv(t) as [number, number, number]);
            if (t === 1) for (const f of fin) { f.d.x = f.x; f.d.y = f.y; f.d.r = f.r; }
          };
        });
      } else zoomTo(target);
      updateLabels(false);
      renderCrumbs();
      if (selectedLeaf) {
        const d = root.descendants().find((x) => x.data.id === selectedLeaf);
        if (d?.data.leaf) showRecords(d);
      }
    }

    function zoom(d: PNode) {
      focus = d;
      // moving to another part of the galaxy closes the open topic's list
      const sel = selectedLeaf ? root.descendants().find((x) => x.data.id === selectedLeaf) : null;
      if (sel && sel.parent !== d) { hideRecords(); }
      const tr = svg.transition().duration(700).tween("zoom", () => {
        const i = d3.interpolateZoom(view, [d.x, d.y, d.r * 2]);
        return (t: number) => zoomTo(i(t) as [number, number, number]);
      });
      void tr;
      g.selectAll<SVGGElement, PNode>("g.tnode").classed("focus", (x) => x === d);
      updateLabels(true);
      renderCrumbs();
    }

    function renderCrumbs() {
      clear(crumbs);
      const path = focus.ancestors().reverse();
      path.forEach((d, i) => {
        if (i) crumbs.appendChild(h("span", { class: "sep" }, "›"));
        const b = h("button", { class: `crumb ${d === focus && !selectedLeaf ? "current" : ""}`, type: "button" }, d.data.label);
        b.addEventListener("click", () => zoom(d));
        crumbs.appendChild(b);
      });
      if (selectedLeaf) {
        const leaf = root.descendants().find((x) => x.data.id === selectedLeaf);
        if (leaf) crumbs.append(h("span", { class: "sep" }, "›"), h("span", { class: "crumb current" }, leaf.data.label));
      }
      if (focus !== root) {
        const out = h("button", { class: "crumb out", type: "button", title: "Zoom out" }, "− Zoom out");
        out.addEventListener("click", () => zoom(focus.parent ?? root));
        crumbs.appendChild(out);
      }
    }

    function hideRecords() {
      selectedLeaf = null;
      g.selectAll<SVGGElement, PNode>("g.tnode").classed("selected", false);
      detail.classList.remove("open");
      clear(detail);
      renderCrumbs();
    }

    function selectLeaf(d: PNode) {
      selectedLeaf = d.data.id;
      g.selectAll<SVGGElement, PNode>("g.tnode").classed("selected", (x) => x.data.id === selectedLeaf);
      showRecords(d);
      renderCrumbs();
    }

    function showRecords(d: PNode) {
      const leaf = d.data.leaf!;
      clear(detail);
      detail.classList.add("open");
      const close = h("button", { class: "detail-close", type: "button", "aria-label": "Close" }, "×");
      close.addEventListener("click", hideRecords);
      const parentLabel = d.parent?.data.label ?? "";
      detail.append(close, h("div", { class: "topics-detail-parent" }, parentLabel), h("h3", {}, leaf.label),
        h("div", { class: "topics-detail-meta" }, `${leaf.recs.length} records · ${leaf.groups} groups counted · weight ${(d.value ?? 0).toFixed(1)}`));
      const rows = leaf.recs.map((r) => ({ r, w: weight(r) })).sort((a, b) => b.w - a.w || a.r.name.localeCompare(b.r.name));
      const list = h("div", { class: "topics-records" });
      for (const { r, w } of rows) {
        const groupBtn = h("button", { class: "topics-group", type: "button", title: "See this group on the map" }, r.host_name);
        if (cb.hasGroup(r.host)) groupBtn.addEventListener("click", () => cb.onGroupClick(r.host));
        else groupBtn.setAttribute("disabled", "true");
        const isMission = r.kind === "org_mission" || r.kind === "coalition_mission";
        const row = h("div", { class: `topics-record${w <= 0 ? " zero" : ""}${r.climate_relevance !== "core" ? " related" : ""}` },
          h("div", { class: "meta-row" },
            h("span", { class: `pill k-${isMission ? "mission" : r.kind}` }, KIND_LABEL[r.kind]),
            r.recurring ? h("span", { class: "pill" }, "repeats") : null,
            r.date ? h("span", { class: "pill deadline" }, r.date) : null,
            r.climate_relevance !== "core" ? h("span", { class: "pill" }, "related issue") : null),
          isMission ? null : h("div", { class: "name" }, r.link ? h("a", { href: r.link, target: "_blank", rel: "noopener noreferrer" }, `${r.name} ↗`) : r.name),
          h("div", { class: "topics-host" }, isMission ? "Mission of " : "", groupBtn));
        list.appendChild(row);
      }
      detail.appendChild(list);
    }

    measure();
    root = pack();
    focus = root;
    view = [root.x, root.y, root.r * 2];
    svg.on("click", () => zoom(root));
    draw(false);
    g.selectAll<SVGGElement, PNode>("g.tnode").classed("focus", (x) => x === focus);
    render = () => draw(true);
    new ResizeObserver(() => {
      if (!stage.offsetParent) return;
      measure();
      root = undefined as unknown as PNode;
      draw(false);
    }).observe(stage);
  }

  function show() {
    if (file || loading) return;
    loading = fetch(`${import.meta.env.BASE_URL}topics.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`topics.json: ${r.status}`);
        return r.json() as Promise<TopicsFile>;
      })
      .then((f) => {
        file = f;
        setup(f);
      })
      .catch((err) => {
        stage.appendChild(h("div", { class: "list-empty" }, `Couldn't load the topic data (${(err as Error).message}).`));
      });
  }

  return { el: wrap, show };
}
