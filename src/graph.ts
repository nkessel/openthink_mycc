import * as d3 from "d3";
import type {
  DataFile,
  GraphNode,
  GraphLink,
  CoalitionNode,
  OrgNode,
  Thought,
  Project,
  CoalitionEvent,
  Action,
} from "./types";
import { h } from "./dom";
import { typeIcon } from "./icons";
import { staleNotice } from "./notice";
import { orgProjects, orgEvents, orgActions } from "./owners";
import { fmtEventTime, fmtDate, parseEventDate } from "./util";
import { coalitionRadius, orgRadius, initials } from "./util";
import type { Tooltip } from "./tooltip";
import { createNodeSearch, allNodesForSearch } from "./search";

export interface GraphCallbacks {
  onNodeClick(node: GraphNode): void;
  /** The open group was clicked again: it collapsed. */
  onNodeDeselect?(node: GraphNode): void;
  /** The summary card at the top was tapped: show the full details panel. */
  onOpenDetails?(node: GraphNode): void;
}

export interface GroupRule {
  id: string;
  label: string;
  color: string;
  matches(node: GraphNode): boolean;
}

export interface GraphSettings {
  centerForce: number; // 0..1
  repelForce: number; // 0..1, scales charge strength
  linkForce: number; // 0..1
  linkDistance: number; // 0..1
  nodeSize: number; // 0.5..2
  linkThickness: number; // 0.5..4 (px)
  textFadeThreshold: number; // 0..1; below this zoom scale, hide names
  /** Show group / org names on the map (off hides them all). */
  showText: boolean;
  /** 0..1: how much a coalition's size follows its number of connected orgs (0 = all the same size). */
  weightConnections: number;
  /** Bubbles for events / projects / actions appear around a group when it is opened. */
  showBubbles: boolean;
  /** How much each kind of activity adds to a group's size (0 = ignore it). */
  weightEvents: number;
  weightProjects: number;
  weightActions: number;
  /** true = every group's events / projects / actions are always on the map (dots that become bubbles as you zoom); false = only when a group is clicked. */
  alwaysShow: boolean;
  /** With alwaysShow on: which kinds to show. */
  showAllEvents: boolean;
  showAllProjects: boolean;
  showAllActions: boolean;
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  centerForce: 0.5,
  repelForce: 0.65, // a bit more spread by default
  linkForce: 0.5,
  linkDistance: 0.5,
  nodeSize: 1,
  linkThickness: 1,
  textFadeThreshold: 0.5,
  showText: true,
  weightConnections: 0.5,
  showBubbles: true,
  weightEvents: 0,
  weightProjects: 0,
  weightActions: 0,
  alwaysShow: false,
  showAllEvents: true,
  showAllProjects: true,
  showAllActions: true,
};

export interface Graph {
  setVisibleCoalitions(ids: Set<string>): void;
  /** Center on any node (coalition or org). */
  focusOnNode(id: string): void;
  setSelectedNode(node: GraphNode | null): void;
  focusOnCoalition(id: string): void;
  /** Zoom into a node: its projects, events and public thinking float around it as bubbles. */
  enterFocus(id: string): void;
  /** Leave the zoomed-in view and return to the whole network. */
  exitFocus(): void;
  /** Reset the view if nothing is on screen. */
  ensureInView(): void;
  /** The "org-to-org connections" checkbox, for the host page to place (the sidebar). */
  orgLinkToggle(): HTMLElement;
  updateSettings(partial: Partial<GraphSettings>): void;
  setGroups(groups: GroupRule[]): void;
  kickSimulation(): void;
  /** True when groups open with bubbles (the new view); false for the Classic network. */
  bubblesOn(): boolean;
}

const COALITION_LABEL_FONT_SIZE = 14;
/** Size every coalition shrinks / grows toward when "size by connected orgs" is turned down. */
const UNIFORM_COALITION_R = 48;
const ORG_LABEL_FONT_SIZE = 10;
/** Logo size as a share of the node radius: fills the circle (no white rim). */
const LOGO_SCALE = 1;
const ORG_NAME_FONT_SIZE = 11;

export function createGraph(
  parent: HTMLElement,
  data: DataFile,
  tooltip: Tooltip,
  cb: GraphCallbacks,
): Graph {
  // ----- Build node + link collections -----
  const coalitionNodes: CoalitionNode[] = data.coalitions.map((c) => ({
    ...c,
    kind: "coalition" as const,
  }));
  const orgNodes: OrgNode[] = data.organizations.map((o) => ({
    ...o,
    kind: "org" as const,
  }));

  const allNodes: GraphNode[] = [...coalitionNodes, ...orgNodes];
  const nodeById = new Map<string, GraphNode>(allNodes.map((n) => [n.id, n]));

  const orgIds = new Set(data.organizations.map((o) => o.id));
  const allLinks: GraphLink[] = [
    ...data.edges.map((e) => ({
      source: e.source,
      target: e.target,
      coalitionId: e.source, // source is always coalition in our data
      kind: "membership" as const,
    })),
    // Org-to-org: how often they work together (weight 1 = yearly or less … 4 = weekly)
    ...(data.org_links || [])
      .filter((l) => orgIds.has(l.source) && orgIds.has(l.target))
      .map((l) => ({ source: l.source, target: l.target, coalitionId: "", kind: "org" as const, weight: l.weight })),
  ];
  const orgLinkCount = allLinks.filter((l) => l.kind === "org").length;
  let showOrgLinks = true;

  let visibleCoalitions = new Set(data.coalitions.map((c) => c.id));
  let selectedId: string | null = null;

  // ----- SVG scaffolding -----
  const wrap = document.createElement("div");
  wrap.className = "graph-wrap";
  parent.appendChild(wrap);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = window.matchMedia("(pointer: coarse)").matches
    ? "Tap a group to zoom into its work · Pinch to zoom"
    : "Click a group to zoom into its work · Scroll to zoom · Esc to go back";
  wrap.appendChild(hint);

  // Top-left overlay: search + org-to-org link toggle
  const overlay = document.createElement("div");
  overlay.className = "graph-overlay";
  wrap.appendChild(overlay);
  overlay.appendChild(
    createNodeSearch(allNodesForSearch(data), (id) => {
      const n = nodeById.get(id);
      if (!n) return;
      api.focusOnNode(id);
      cb.onNodeClick(n);
      api.setSelectedNode(n);
    }),
  );
  // View switch: "Bubbles" zooms into a group and shows its events/projects/actions around it;
  // "Classic" is the plain network (clicking a group just opens its details panel).
  const viewSwitch = document.createElement("div");
  viewSwitch.className = "view-switch";
  viewSwitch.setAttribute("role", "group");
  viewSwitch.setAttribute("aria-label", "Map view");
  const viewBtns: Record<"bubbles" | "classic", HTMLButtonElement> = {
    bubbles: document.createElement("button"),
    classic: document.createElement("button"),
  };
  viewBtns.bubbles.textContent = "Items on";
  viewBtns.bubbles.title = "When you click a group: zoom in and show its events, projects and actions as bubbles";
  viewBtns.classic.textContent = "Items off";
  viewBtns.classic.title = "When you click a group: just open its details panel (no zoom, no bubbles)";
  for (const k of ["bubbles", "classic"] as const) {
    viewBtns[k].type = "button";
    viewBtns[k].addEventListener("click", () => setViewMode(k === "bubbles"));
    viewSwitch.appendChild(viewBtns[k]);
  }
  overlay.appendChild(viewSwitch);
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "reset-map-btn";
  resetBtn.textContent = "⟲ Reset map";
  resetBtn.title = "Zoom out to show the whole network again";
  resetBtn.addEventListener("click", () => {
    if (focusId) exitFocus();
    else fitToView(true);
  });
  overlay.appendChild(resetBtn);
  function syncViewSwitch() {
    viewBtns.bubbles.classList.toggle("active", settings.showBubbles);
    viewBtns.classic.classList.toggle("active", !settings.showBubbles);
  }
  // The sidebar has its own copy of this switch (above the size sliders); it talks to us through window events.
  window.addEventListener("openthink:setview", (e) => setViewMode(!!(e as CustomEvent).detail?.bubbles));
  function setViewMode(bubbles: boolean) {
    api.updateSettings({ showBubbles: bubbles });
    try { localStorage.setItem("openthink.bubbles", bubbles ? "1" : "0"); } catch (_) { /* private mode */ }
  }
  // Org-to-org toggle: built here (it drives the graph), shown in the sidebar with the other filters.
  const toggle = document.createElement("label");
  toggle.className = "org-link-toggle";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = showOrgLinks;
  box.addEventListener("change", () => {
    showOrgLinks = box.checked;
    linkForce.strength(linkStrengthFor);
    applyVisibility();
  });
  toggle.appendChild(box);
  toggle.appendChild(
    document.createTextNode(
      orgLinkCount
        ? ` Org-to-org connections (${orgLinkCount}) — thicker = more often`
        : " Org-to-org connections (none reported yet)",
    ),
  );

  const svg = d3
    .select(wrap)
    .append("svg")
    .attr("xmlns", "http://www.w3.org/2000/svg");

  // Inner <g> we transform for zoom/pan
  const root = svg.append("g").attr("class", "root");
  const linkLayer = root.append("g").attr("class", "links");
  const nodeLayer = root.append("g").attr("class", "nodes");

  // Zoom behavior
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 4])
    .filter((event) => {
      // Allow wheel + drag on background, but not on nodes (so node drag works)
      if (event.type === "mousedown" || event.type === "touchstart") {
        const target = event.target as Element;
        if (target.closest(".node-coalition,.node-org")) return false;
      }
      return !event.ctrlKey && !event.button;
    })
    .on("zoom", (event) => {
      root.attr("transform", event.transform.toString());
      currentZoomScale = event.transform.k;
      currentTransform = event.transform;
      applyTextFade();
      updateSatLevel();
      // Hide tooltip while zooming; a card anchored to a bubble would drift, so close it on manual pan/zoom
      tooltip.hide();
      if (event.sourceEvent) focusCard.style.display = "none";
    })
    .on("end", () => { queueDetail(); ensureInView(); });

  let currentZoomScale = 1;
  let currentTransform: d3.ZoomTransform = d3.zoomIdentity;
  function applyTextFade() {
    // The threshold slider value 0..1 maps to a zoom scale 0.2..2.5.
    // Below that scale, node-name labels fade out.
    if (!settings.showText) {
      nodeLayer.selectAll<SVGTextElement, GraphNode>("text.node-name").style("opacity", 0);
      return;
    }
    const threshold = 0.2 + settings.textFadeThreshold * 2.3;
    const k = currentZoomScale;
    // Smooth fade across a small window for nicer transition.
    const fadeWindow = 0.25;
    let opacity: number;
    if (k >= threshold) opacity = 1;
    else if (k <= threshold - fadeWindow) opacity = 0;
    else opacity = (k - (threshold - fadeWindow)) / fadeWindow;
    nodeLayer.selectAll<SVGTextElement, GraphNode>("text.node-name")
      .style("opacity", opacity);
  }

  svg.call(zoom);

  // Size + center based on container
  function dimensions(): { w: number; h: number } {
    const r = wrap.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  // ----- Settings (mutable) -----
  let settings: GraphSettings = { ...DEFAULT_GRAPH_SETTINGS };
  try { if (localStorage.getItem("openthink.bubbles") === "0") settings.showBubbles = false; } catch (_) { /* ignore */ }
  try { if (localStorage.getItem("openthink.always") === "1") settings.alwaysShow = true; } catch (_) { /* ignore */ }
  let groups: GroupRule[] = [];

  // Helpers to compute the actual force strengths from normalized 0..1 sliders.
  function chargeStrengthFor(n: GraphNode): number {
    // Repel force 0..1 → coalition: -800..-6000, org: -100..-800
    const t = settings.repelForce;
    return n.kind === "coalition"
      ? -(800 + t * 5200)
      : -(100 + t * 700);
  }
  function linkDistanceFor(l: GraphLink): number {
    const src =
      typeof l.source === "string" ? nodeById.get(l.source) : l.source;
    // 0..1 → 50..380
    const base = 50 + settings.linkDistance * 330;
    // Orgs that work together more often sit closer
    if (l.kind === "org") return base * (1.3 - (l.weight ?? 1) * 0.2);
    if (src?.kind === "coalition") return coalitionRadius(src) + base * 0.6;
    return base;
  }
  function centerForceStrength(): number {
    return settings.centerForce * 0.1;
  }
  function linkForceStrength(): number {
    return 0.1 + settings.linkForce * 0.9;
  }
  function linkStrengthFor(l: GraphLink): number {
    if (l.kind === "org") return showOrgLinks ? linkForceStrength() * 0.25 * (l.weight ?? 1) : 0;
    return linkForceStrength();
  }
  function linkWidthFor(l: GraphLink): number {
    return l.kind === "org" ? settings.linkThickness * (0.6 + (l.weight ?? 1) * 0.6) : settings.linkThickness;
  }
  function activityCounts(n: GraphNode): { projects: number; events: number; actions: number } {
    return n.kind === "org"
      ? { projects: orgProjects(data, n).length, events: orgEvents(data, n).length, actions: orgActions(data, n).length }
      : { projects: n.projects.length, events: n.events.length, actions: n.actions.length };
  }
  const countCache = new Map<string, { projects: number; events: number; actions: number }>();
  function countsOf(n: GraphNode) {
    let c = countCache.get(n.id);
    if (!c) countCache.set(n.id, (c = activityCounts(n)));
    return c;
  }
  tooltip.setCounts(countsOf);
  function sizeFactor(n: GraphNode): number {
    const { weightEvents: we, weightProjects: wp, weightActions: wa } = settings;
    if (!we && !wp && !wa) return 1;
    const c = countsOf(n);
    const v = we * c.events + wp * c.projects + wa * c.actions;
    return Math.min(2.8, 0.8 + 0.3 * Math.sqrt(v)); // no activity → a bit smaller; the more, the bigger
  }
  function nodeRadiusOf(n: GraphNode): number {
    let base: number;
    if (n.kind === "coalition") {
      const w = settings.weightConnections;
      base = UNIFORM_COALITION_R + (coalitionRadius(n) - UNIFORM_COALITION_R) * w;
    } else base = orgRadius(n);
    return base * settings.nodeSize * sizeFactor(n);
  }

  // ----- Force simulation -----
  const linkForce = d3
    .forceLink<GraphNode, GraphLink>(allLinks)
    .id((d) => d.id)
    .distance(linkDistanceFor)
    .strength(linkStrengthFor);

  const chargeForce = d3
    .forceManyBody<GraphNode>()
    .strength(chargeStrengthFor)
    .distanceMax(900);

  const collideForce = d3
    .forceCollide<GraphNode>()
    .radius((n) => nodeRadiusOf(n) + 14)
    .iterations(2);

  const xForce = d3.forceX<GraphNode>(0).strength(centerForceStrength());
  const yForce = d3.forceY<GraphNode>(0).strength(centerForceStrength());

  const sim = d3
    .forceSimulation<GraphNode>(allNodes)
    .force("link", linkForce)
    .force("charge", chargeForce)
    .force("collide", collideForce)
    .force("x", xForce)
    .force("y", yForce)
    .alphaDecay(0.02);

  // Re-center on resize
  function center() {
    const { w, h } = dimensions();
    svg.attr("viewBox", `${-w / 2} ${-h / 2} ${w} ${h}`);
  }
  center();
  window.addEventListener("resize", () => {
    center();
    sim.alpha(0.3).restart();
  });

  // ----- Drag behavior on nodes -----
  const drag = d3
    .drag<SVGGElement, GraphNode>()
    .on("start", (event, d) => {
      if (!event.active) sim.alphaTarget(0.25).restart();
      d.fx = d.x ?? 0;
      d.fy = d.y ?? 0;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) sim.alphaTarget(0);
      // A zoomed-in node stays where you put it until you leave the zoomed-in view.
      if (d.id === focusId) return;
      d.fx = null;
      d.fy = null;
    });

  // ----- Render links + nodes -----
  type LinkSel = d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown>;
  type NodeSel = d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;

  let linkSel: LinkSel = linkLayer
    .selectAll<SVGLineElement, GraphLink>("line")
    .data(allLinks)
    .enter()
    .append("line")
    .attr("class", (l) => (l.kind === "org" ? `link org-link w${l.weight ?? 1}` : "link")) as LinkSel;

  let nodeSel: NodeSel = nodeLayer
    .selectAll<SVGGElement, GraphNode>("g.node")
    .data(allNodes, (d) => (d as GraphNode).id)
    .enter()
    .append("g")
    .attr("class", (d) =>
      d.kind === "coalition" ? "node-coalition" : "node-org",
    ) as NodeSel;

  // Append shapes + labels per node.
  // Structure per node: <circle.halo> (groups), <circle.ring> (main), <text.node-label>, <text.node-name>.
  nodeSel.each(function (this: SVGGElement, d) {
    const sel = d3.select(this);
    sel
      .append("circle")
      .attr("class", "halo")
      .attr("fill", "none")
      .attr("stroke", "none")
      .attr("stroke-width", 0);
    if (d.kind === "coalition") {
      const r = coalitionRadius(d);
      const ring = sel
        .append("circle")
        .attr("class", "ring")
        .attr("r", r)
        .attr("fill", d.logo ? "#f8fafc" : d.color);
      // style() (not attr) so it beats the stylesheet's white ring
      if (d.logo) ring.style("stroke", d.color).style("stroke-width", "5px").style("stroke-opacity", "1");
      const cLabel = sel
        .append("text")
        .attr("class", "node-label")
        .attr("font-size", Math.min(r * 0.55, 22))
        .text(d.abbrev || initials(d.name));
      if (d.logo) {
        // Logo inside the coalition's colored ring; the abbreviation returns if the image fails.
        cLabel.style("display", "none");
        const s = r * LOGO_SCALE * 0.82; // inside the colored ring
        sel
          .append("image")
          .attr("class", "node-logo")
          .attr("href", d.logo)
          .attr("x", -s).attr("y", -s).attr("width", 2 * s).attr("height", 2 * s)
          .attr("preserveAspectRatio", "xMidYMid meet")
          .style("clip-path", "circle(50%)")
          .attr("pointer-events", "none")
          .on("error", function () {
            d3.select(this).remove();
            cLabel.style("display", null);
            ring.attr("fill", d.color).style("stroke", null).style("stroke-width", null).style("stroke-opacity", null);
          });
      }
      sel
        .append("text")
        .attr("class", "node-name")
        .attr("font-size", COALITION_LABEL_FONT_SIZE)
        .attr("y", r + 14)
        .text(d.name);
    } else {
      const r = orgRadius(d);
      sel
        .append("circle")
        .attr("class", "ring")
        .attr("r", r)
        .attr("fill", d.logo ? "#f8fafc" : "#2a2a36");
      if (d.logo) sel.select("circle.ring").style("stroke", "none"); // no white border around logos
      const label = sel
        .append("text")
        .attr("class", "node-label")
        .attr("font-size", ORG_LABEL_FONT_SIZE)
        .text(initials(d.name, 3));
      if (d.logo) {
        // Logo inside the circle; the initials come back if the image fails to load.
        label.style("display", "none");
        const s = r * LOGO_SCALE;
        sel
          .append("image")
          .attr("class", "node-logo")
          .attr("href", d.logo)
          .attr("x", -s).attr("y", -s).attr("width", 2 * s).attr("height", 2 * s)
          .attr("preserveAspectRatio", "xMidYMid meet")
          .style("clip-path", "circle(50%)")
          .attr("pointer-events", "none")
          .on("error", function () {
            d3.select(this).remove();
            label.style("display", null);
            sel.select("circle.ring").attr("fill", "#2a2a36").style("stroke", null);
          });
      }
      sel
        .append("text")
        .attr("class", "node-name")
        .attr("font-size", ORG_NAME_FONT_SIZE)
        .attr("y", r + 12)
        .text(shorten(d.name, 28));
    }
  });

  // ----- Always-on items: every group's events / projects / actions ring it on one orbit -----
  // Far out they are small dots; zoom in and the same items turn into real bubbles (icon, date, click for the card).
  // Detail is built in small batches for what is on screen, with a loading bar so a big map never just freezes.
  const SAT_DOT_R = 3.2;
  const SAT_BUB_R = 11;
  const DETAIL_ON_K = 1.9; // zoom at which dots become bubbles
  const DETAIL_OFF_K = 1.6; // and back (a gap so it doesn't flicker)
  const DETAIL_CAP = 24;
  let satsReady = false;
  let satMode: 0 | 1 = 0;
  const satLevel = new Map<string, 0 | 1>();
  let detailToken = 0;

  const loadingEl = h("div", { class: "map-loading" },
    h("div", { class: "map-loading-label" }, "Loading details…"),
    h("div", { class: "map-loading-track" }, h("div", { class: "map-loading-fill" })));
  loadingEl.style.display = "none";
  wrap.appendChild(loadingEl);
  const loadingFill = loadingEl.querySelector<HTMLElement>(".map-loading-fill")!;
  let loadingSince = 0;
  function showLoading(frac: number) {
    if (loadingEl.style.display === "none") { loadingEl.style.display = "flex"; loadingSince = performance.now(); }
    loadingFill.style.width = `${Math.round(frac * 100)}%`;
  }
  function hideLoading() {
    const wait = Math.max(0, 300 - (performance.now() - loadingSince));
    setTimeout(() => { if (satsBusy === 0) loadingEl.style.display = "none"; }, wait);
  }
  let satsBusy = 0;

  /** The items to show around a group: only the kinds that are switched on, one kind after another. */
  function satItemsOf(n: GraphNode): Bubble[] {
    const want = new Set<BubbleKind>();
    if (settings.showAllProjects) want.add("project");
    if (settings.showAllEvents) want.add("event");
    if (settings.showAllActions) want.add("action");
    return bubblesFor(n).filter((b) => want.has(b.kind));
  }
  /** Take items round-robin across kinds so a "+n" never hides a whole kind. */
  function spread(items: Bubble[], cap: number): Bubble[] {
    if (items.length <= cap) return items;
    const by = new Map<BubbleKind, Bubble[]>();
    for (const b of items) (by.get(b.kind) ?? by.set(b.kind, []).get(b.kind)!).push(b);
    const out: Bubble[] = [];
    const lists = [...by.values()];
    for (let i = 0; out.length < cap; i++) {
      let added = false;
      for (const l of lists) if (i < l.length && out.length < cap) { out.push(l[i]); added = true; }
      if (!added) break;
    }
    return out.sort((x, y) => items.indexOf(x) - items.indexOf(y));
  }

  function drawSats(n: GraphNode, level: 0 | 1) {
    const sel = d3.select<SVGGElement, GraphNode>(nodeSel.filter((d) => d.id === n.id).node() as SVGGElement);
    sel.selectAll("g.sats").remove();
    satLevel.set(n.id, level);
    if (!settings.showBubbles || !settings.alwaysShow) return;
    const items = satItemsOf(n);
    if (!items.length) return;
    const r0 = nodeRadiusOf(n);
    const g = sel.append("g").attr("class", `sats lv${level}`);
    if (level === 0) {
      g.style("pointer-events", "none");
      const rr = r0 + 10; // everything sits on this one circle
      const cap = Math.max(6, Math.floor((2 * Math.PI * rr) / 8.5));
      const shown = spread(items, cap);
      shown.forEach((b, i) => {
        const a = (2 * Math.PI * i) / shown.length - Math.PI / 2;
        g.append("circle").attr("class", `sat sat-${b.kind}`).attr("cx", Math.cos(a) * rr).attr("cy", Math.sin(a) * rr).attr("r", SAT_DOT_R);
      });
      if (items.length > shown.length) g.append("text").attr("class", "sat-more").attr("y", -rr - 6).text(`+${items.length - shown.length}`);
      return;
    }
    const shown = spread(items, DETAIL_CAP);
    const rr = Math.max(r0 + SAT_BUB_R + 10, (shown.length * (2 * SAT_BUB_R + 8)) / (2 * Math.PI));
    shown.forEach((b, i) => {
      const a = (2 * Math.PI * i) / shown.length - Math.PI / 2;
      const bg = g.append("g").attr("class", `sat-bubble b-${b.kind}`)
        .attr("transform", `translate(${Math.cos(a) * rr},${Math.sin(a) * rr})`)
        .style("cursor", "pointer");
      bg.append("title").text(b.label);
      bg.append("circle").attr("r", SAT_BUB_R);
      const inner = bg.append("g").attr("transform", "scale(0.5)");
      const isRole = b.kind === "action" && (b.item as Action).kind === "role";
      drawIcon(inner as unknown as d3.Selection<SVGGElement, unknown, null, undefined>, isRole ? "volunteer" : (b.kind as BubbleKind), b.kind === "event" ? (b.item as CoalitionEvent).date : undefined);
      if (b.kind === "event" && (b.item as CoalitionEvent).recurrence) drawRecurArc(bg as unknown as d3.Selection<SVGGElement, unknown, null, undefined>, SAT_BUB_R - 1.2, 0.9);
      bg.on("click", (event: Event) => {
        event.stopPropagation();
        const cb2 = (bg.select("circle").node() as SVGCircleElement).getBoundingClientRect();
        const wb = wrap.getBoundingClientRect();
        showCard(b, { x: cb2.left - wb.left + cb2.width / 2, y: cb2.top - wb.top + cb2.height / 2, r: cb2.width / 2 }, n);
      });
    });
    if (items.length > shown.length) g.append("text").attr("class", "sat-more").attr("y", -rr - SAT_BUB_R - 4).text(`+${items.length - shown.length}`);
  }

  /** Dots for everyone (cheap); bubbles for what is on screen when zoomed in, a batch at a time. */
  function refreshSats() {
    if (!satsReady) return;
    detailToken++;
    satMode = currentZoomScale >= DETAIL_ON_K ? 1 : 0;
    nodeSel.each((d) => drawSats(d, 0));
    queueDetail();
  }
  function onScreen(n: GraphNode): boolean {
    const { w, h: vh } = dimensions();
    const k = currentTransform.k;
    const m = 140; // a bit of margin so bubbles are ready just before they slide in
    const sx = (n.x ?? 0) * k + currentTransform.x;
    const sy = (n.y ?? 0) * k + currentTransform.y;
    return Math.abs(sx) < w / 2 + m && Math.abs(sy) < vh / 2 + m;
  }
  function queueDetail() {
    if (!satsReady || !settings.showBubbles || !settings.alwaysShow || satMode !== 1) return;
    const todo = allNodes.filter((n) => satLevel.get(n.id) !== 1 && onScreen(n) && (nodeSel.filter((d) => d.id === n.id).style("display") !== "none") && satItemsOf(n).length);
    if (!todo.length) return;
    const token = ++detailToken;
    const BATCH = 8;
    let done = 0;
    satsBusy++;
    const step = () => {
      if (token !== detailToken) { satsBusy--; hideLoading(); return; }
      for (const n of todo.slice(done, done + BATCH)) drawSats(n, 1);
      done += BATCH;
      if (todo.length > BATCH) showLoading(Math.min(1, done / todo.length));
      if (done < todo.length) requestAnimationFrame(step);
      else { satsBusy--; hideLoading(); }
    };
    if (todo.length > BATCH) showLoading(0);
    requestAnimationFrame(step);
  }
  function updateSatLevel() {
    if (!satsReady || !settings.alwaysShow || !settings.showBubbles) return;
    const want: 0 | 1 = satMode === 1 ? (currentZoomScale < DETAIL_OFF_K ? 0 : 1) : (currentZoomScale >= DETAIL_ON_K ? 1 : 0);
    if (want === satMode) return;
    satMode = want;
    detailToken++;
    if (want === 0) nodeSel.each((d) => { if (satLevel.get(d.id) !== 0) drawSats(d, 0); });
    else queueDetail();
  }
  const renderSatellites = refreshSats;

  // ----- Apply visual settings (radii, halos, link thickness, fade) -----
  function applyVisualSettings() {
    // Update circle radii + label y-positions based on node-size multiplier
    nodeSel.each(function (this: SVGGElement, d) {
      const sel = d3.select(this);
      const r = nodeRadiusOf(d);
      sel.select<SVGCircleElement>("circle.ring").attr("r", r);
      const s = r * LOGO_SCALE * (d.kind === "coalition" ? 0.82 : 1);
      sel.select<SVGImageElement>("image.node-logo")
        .attr("x", -s).attr("y", -s).attr("width", 2 * s).attr("height", 2 * s);

      // Find matching group (if any) — first match wins
      let matchedColor: string | null = null;
      for (const g of groups) {
        if (g.matches(d)) {
          matchedColor = g.color;
          break;
        }
      }
      const halo = sel.select<SVGCircleElement>("circle.halo");
      if (matchedColor) {
        halo
          .attr("r", r + 5)
          .attr("stroke", matchedColor)
          .attr("stroke-width", 3)
          .attr("stroke-opacity", 0.9)
          .attr("fill", "none");
      } else {
        halo.attr("stroke", "none").attr("stroke-width", 0);
      }
      // Label below the node
      sel
        .select<SVGTextElement>("text.node-name")
        .attr("y", r + (d.kind === "coalition" ? 14 : 12));
    });
    // Link thickness (org-to-org links scale with how often they work together)
    linkSel.attr("stroke-width", linkWidthFor);
    renderSatellites();
  }
  // Apply on initial render
  applyVisualSettings();

  // Drag + events
  nodeSel
    .call(drag)
    .on("mouseenter", function (event, d) {
      tooltip.show(d, event.clientX, event.clientY);
      highlightConnected(d);
    })
    .on("mousemove", function (event) {
      tooltip.move(event.clientX, event.clientY);
    })
    .on("mouseleave", function () {
      tooltip.hide();
      clearHighlight();
    })
    .on("click", function (event, d) {
      event.stopPropagation();
      if (focusId === d.id) {
        // Clicking the open group again folds its bubbles back in.
        exitFocus();
        cb.onNodeDeselect?.(d);
        return;
      }
      cb.onNodeClick(d);
      if (settings.showBubbles) enterFocus(d.id);
    });

  // Clicking the background closes selection and zooms back out
  svg.on("click", () => {
    api.setSelectedNode(null);
    exitFocus();
  });

  // ----- Highlight connected nodes/edges on hover -----
  function highlightConnected(node: GraphNode) {
    const connectedNodeIds = new Set<string>();
    connectedNodeIds.add(node.id);
    for (const l of allLinks) {
      const s = (l.source as GraphNode).id ?? l.source;
      const t = (l.target as GraphNode).id ?? l.target;
      if (s === node.id) connectedNodeIds.add(t as string);
      if (t === node.id) connectedNodeIds.add(s as string);
    }
    nodeSel.classed("dim", (n) => !connectedNodeIds.has(n.id));
    linkSel
      .classed("highlight", (l) => {
        const s = (l.source as GraphNode).id ?? l.source;
        const t = (l.target as GraphNode).id ?? l.target;
        return s === node.id || t === node.id;
      })
      .classed("dim", (l) => {
        const s = (l.source as GraphNode).id ?? l.source;
        const t = (l.target as GraphNode).id ?? l.target;
        return s !== node.id && t !== node.id;
      });
  }

  function clearHighlight() {
    nodeSel.classed("dim", false);
    linkSel.classed("highlight", false).classed("dim", false);
  }

  // ----- Tick -----
  sim.on("tick", () => {
    linkSel
      .attr("x1", (l) => (l.source as GraphNode).x ?? 0)
      .attr("y1", (l) => (l.source as GraphNode).y ?? 0)
      .attr("x2", (l) => (l.target as GraphNode).x ?? 0)
      .attr("y2", (l) => (l.target as GraphNode).y ?? 0);
    nodeSel.attr(
      "transform",
      (n) => `translate(${n.x ?? 0},${n.y ?? 0})`,
    );
    if (focusId) {
      const f = nodeById.get(focusId);
      if (f) focusGroup.attr("transform", `translate(${f.x ?? 0},${f.y ?? 0})`);
    }
  });

  // Auto-fit once the simulation has settled enough
  let didInitialFit = false;
  sim.on("end", () => {
    if (didInitialFit) return;
    didInitialFit = true;
    fitToView(false);
  });
  // Fallback in case "end" doesn't fire in time (large graphs)
  setTimeout(() => {
    if (didInitialFit) return;
    didInitialFit = true;
    fitToView(false);
  }, 2500);

  /** If nothing is on screen (panned away, zoomed past everything, or the pane was hidden), reset the view. */
  function ensureInView() {
    if (focusId) return;
    const wr = wrap.getBoundingClientRect();
    if (wr.width < 50 || wr.height < 50) return; // hidden tab; check again when shown
    const nr = nodeLayer.node()!.getBoundingClientRect();
    const empty = nr.width === 0 && nr.height === 0;
    const off = nr.right < wr.left + 20 || nr.left > wr.right - 20 || nr.bottom < wr.top + 20 || nr.top > wr.bottom - 20;
    if (empty || off) fitToView(true);
  }
  setInterval(ensureInView, 3000);
  window.addEventListener("resize", () => setTimeout(ensureInView, 200));

  function fitToView(animate = true) {
    let xs: number[] = [];
    let ys: number[] = [];
    allNodes.forEach((n) => {
      if (n.x === undefined || n.y === undefined) return;
      const display = (
        nodeSel
          .filter((nn) => nn.id === n.id)
          .node() as SVGGElement | null
      )?.style.display;
      if (display === "none") return;
      const r =
        n.kind === "coalition" ? coalitionRadius(n) : orgRadius(n);
      xs.push(n.x - r, n.x + r);
      ys.push(n.y - r - 14, n.y + r + 14);
    });
    if (!xs.length) return;
    // Fit the main cluster: a few unconnected orgs drift far out and would otherwise shrink
    // everything (tiny on phones). They stay reachable by panning or zooming out.
    const q = (arr: number[], p: number) => {
      const v = [...arr].sort((a, b) => a - b);
      return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
    };
    const trim = xs.length > 40 ? 0.04 : 0;
    const minX = q(xs, trim);
    const maxX = q(xs, 1 - trim);
    const minY = q(ys, trim);
    const maxY = q(ys, 1 - trim);
    const pad = 60;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const { w, h } = dimensions();
    const scale = Math.min(w / bw, h / bh, 1.6);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const t = d3.zoomIdentity.translate(-cx * scale, -cy * scale).scale(scale);
    const target = animate ? svg.transition().duration(600) : svg;
    target.call(zoom.transform, t);
  }

  // ----- Visibility filtering -----
  function applyVisibility() {
    // A node is visible iff:
    //  - it's a coalition and its id ∈ visible set
    //  - it's an org and at least one of its coalition_ids ∈ visible set
    //  - or it belongs to no coalition at all (always shown)
    const orgVisible = new Map<string, boolean>();
    for (const o of orgNodes) {
      orgVisible.set(
        o.id,
        !o.coalition_ids.length || o.coalition_ids.some((c) => visibleCoalitions.has(c)),
      );
    }
    nodeSel.style("display", (n) => {
      if (n.kind === "coalition") {
        return visibleCoalitions.has(n.id) ? null : "none";
      }
      return orgVisible.get(n.id) ? null : "none";
    });
    linkSel.style("display", (l) => {
      const sid = typeof l.source === "string" ? l.source : l.source.id;
      const tid = typeof l.target === "string" ? l.target : l.target.id;
      if (l.kind === "org") return showOrgLinks && orgVisible.get(sid) && orgVisible.get(tid) ? null : "none";
      if (!visibleCoalitions.has(sid)) return "none";
      if (!orgVisible.get(tid)) return "none";
      return null;
    });
    sim.alpha(0.3).restart();
  }


  // ----- Focus mode: zoom into one group and see its work as bubbles -----
  // Bubbles ring the node: thinking (purple), projects (green), events (amber), each kind together.
  // They sit right next to the node, so they read as closer to it than any partner org.
  type BubbleKind = "thought" | "project" | "event" | "action";
  interface Bubble {
    id: string;
    kind: BubbleKind;
    label: string;
    glyph: string;
    /** Second line under the label: date and place for events. */
    subtitle?: string;
    r: number;
    item: Thought | Project | CoalitionEvent | Action;
  }
  const BUBBLE_R = 22;
  const focusLayer = root.append("g").attr("class", "focus-layer");
  const focusGroup = focusLayer.append("g").attr("class", "focus-group");
  let focusId: string | null = null;
  const focusBar = h("div", { class: "focus-bar" });
  const focusCard = h("div", { class: "focus-card" });
  focusBar.style.display = "none";
  focusCard.style.display = "none";
  wrap.appendChild(focusBar);
  wrap.appendChild(focusCard);

  const THOUGHT_GLYPH: Record<string, string> = { topic: "◆", decision: "✓", question: "?", update: "•" };

  function bubblesFor(n: GraphNode): Bubble[] {
    const thoughts: Thought[] = n.thoughts || [];
    const projects: Project[] = n.kind === "org" ? orgProjects(data, n) : n.projects;
    const events: CoalitionEvent[] = n.kind === "org" ? orgEvents(data, n) : n.events;
    const actions: Action[] = n.kind === "org" ? orgActions(data, n) : n.actions;
    const sortedEvents = [...events].sort((a, b) => parseEventDate(a.date).getTime() - parseEventDate(b.date).getTime());
    return [
      ...thoughts.map((t): Bubble => ({
        id: t.id, kind: "thought", label: shorten(t.text, 34), glyph: THOUGHT_GLYPH[t.kind] || "•", r: BUBBLE_R, item: t,
      })),
      ...projects.map((p): Bubble => ({
        id: p.id, kind: "project", label: shorten(p.name, 34), glyph: "", subtitle: p.location ? shorten(p.location, 38) : undefined, r: BUBBLE_R, item: p,
      })),
      ...sortedEvents.map((e): Bubble => ({
        id: e.id, kind: "event", label: shorten(e.name, 34), glyph: "",
        subtitle: shorten([fmtShortDate(e.date), e.location].filter(Boolean).join(" · "), 42), r: BUBBLE_R - 2, item: e,
      })),
      ...actions.map((a): Bubble => ({
        id: a.id, kind: "action", label: shorten(a.name, 34), glyph: "", subtitle: a.deadline ? `by ${shorten(a.deadline, 30)}` : undefined, r: BUBBLE_R - 2, item: a,
      })),
    ];
  }

  /** Nodes closest to the focused one: shared coalitions, org-to-org links, and its members. */
  function partnersOf(n: GraphNode): Set<string> {
    const ids = new Set<string>();
    for (const l of allLinks) {
      const s = typeof l.source === "string" ? l.source : l.source.id;
      const t = typeof l.target === "string" ? l.target : l.target.id;
      if (s === n.id) ids.add(t);
      if (t === n.id) ids.add(s);
    }
    if (n.kind === "org") {
      for (const l of allLinks) {
        if (l.kind !== "membership") continue;
        const s = typeof l.source === "string" ? l.source : l.source.id;
        const t = typeof l.target === "string" ? l.target : l.target.id;
        if (ids.has(s)) ids.add(t); // fellow members of the same coalitions
      }
    }
    ids.delete(n.id);
    return ids;
  }

  function showCard(b: Bubble, anchor?: { x: number; y: number; r: number }, ownerNode?: GraphNode) {
    while (focusCard.firstChild) focusCard.removeChild(focusCard.firstChild);
    const it = b.item as Thought & Project & CoalitionEvent & Action;
    const kindLabel =
      b.kind === "thought" ? { topic: "Thinking · topic", decision: "Thinking · decision", question: "Thinking · open question", update: "Thinking · update" }[(it as Thought).kind] || "Thinking"
      : b.kind === "project" ? `Project · ${(it as Project).status}`
      : b.kind === "action" ? ((it as Action).kind === "role" ? "Volunteer opportunity" : "Action")
      : "Event";
    const title = b.kind === "thought" ? (it as Thought).text : (it as Project | CoalitionEvent | Action).name;
    const meta: string[] = [];
    if (b.kind === "event") meta.push(fmtEventTime((it as CoalitionEvent).date, (it as CoalitionEvent).end, (it as CoalitionEvent).recurrence));
    if (b.kind === "action" && (it as Action).deadline) meta.push(`by ${(it as Action).deadline}`);
    if (b.kind === "thought" && (it as Thought).date) meta.push(fmtDate(`${(it as Thought).date}T12:00:00`));
    const loc = b.kind === "event" ? (it as CoalitionEvent).location : b.kind === "project" ? (it as Project).location : "";
    if (loc) meta.push(loc);
    const close = h("button", { class: "focus-card-close", type: "button", "aria-label": "Close" }, "×");
    close.addEventListener("click", () => (focusCard.style.display = "none"));
    focusCard.appendChild(close);
    focusCard.appendChild(h("div", { class: `focus-card-kind k-${b.kind}` }, kindLabel));
    if (b.kind !== "thought") focusCard.appendChild(h("h3", {}, title));
    else focusCard.appendChild(h("p", { class: "focus-card-text" }, title));
    if (meta.length) focusCard.appendChild(h("div", { class: "focus-card-meta" }, meta.join(" · ")));
    const desc = b.kind === "thought" ? "" : (it as Project | CoalitionEvent | Action).description;
    if (desc) focusCard.appendChild(h("p", { class: "focus-card-text" }, desc));
    if (b.kind === "thought") focusCard.appendChild(h("div", { class: "focus-card-source" }, `Source: ${(it as Thought).source}`));
    const rsvp = (it as { rsvp_link?: string }).rsvp_link;
    if (b.kind === "event" && rsvp && /^https?:\/\//.test(rsvp)) {
      focusCard.appendChild(h("a", { class: "focus-card-link rsvp-link", href: rsvp, target: "_blank", rel: "noopener noreferrer" }, "RSVP ↗"));
    }
    const link = (it as { link?: string }).link;
    if (link && /^https?:\/\//.test(link)) {
      focusCard.appendChild(h("a", { class: "focus-card-link", href: link, target: "_blank", rel: "noopener noreferrer" }, "More info ↗"));
    }
    if (b.kind !== "thought") focusCard.appendChild(staleNotice(b.kind, ownerNode ?? (focusId ? nodeById.get(focusId) ?? null : null), (b.item as { needs_info?: boolean }).needs_info, (b.item as { verified?: boolean }).verified));
    focusCard.style.visibility = "hidden";
    focusCard.style.display = "block";
    placeCard(anchor);
    focusCard.style.visibility = "";
  }

  /** Put the card right next to the clicked bubble (below it, or above if there's no room), kept fully on screen. */
  function placeCard(anchor?: { x: number; y: number; r: number }) {
    const box = wrap.getBoundingClientRect();
    const W = box.width;
    const H = box.height;
    const panel = W > 900 && focusId ? 420 : 0; // the details panel covers the right side
    const usableW = W - panel;
    const cw = Math.min(360, usableW - 24);
    focusCard.style.width = `${cw}px`;
    const ch = Math.min(focusCard.offsetHeight, H * 0.55);
    if (!anchor) {
      focusCard.style.left = "12px";
      focusCard.style.top = `${Math.max(12, H - ch - 12)}px`;
      return;
    }
    const gap = anchor.r + 14;
    const below = anchor.y + gap + ch <= H - 12;
    let top = below ? anchor.y + gap : anchor.y - gap - ch;
    if (!below && top < 12) top = Math.max(12, Math.min(anchor.y - ch / 2, H - ch - 12)); // neither fits: sit beside it
    let left = anchor.x - cw / 2;
    if (!below && top < anchor.y - gap - ch + 1 && top + ch > anchor.y - gap) left = anchor.x + gap; // beside
    left = Math.max(12, Math.min(left, usableW - cw - 12));
    focusCard.style.left = `${left}px`;
    focusCard.style.top = `${Math.max(12, top)}px`;
  }

  const LABEL_PX = 6; // rough width of one label character, for hit areas and spacing

  /** A recurring item's border: one circular arrow running around the bubble (a ring with an arrowhead, not many little symbols). */
  function drawRecurArc(g: d3.Selection<SVGGElement, unknown, null, undefined>, rr: number, w: number) {
    const a0 = -Math.PI / 2 + 0.35;
    const a1 = a0 + 2 * Math.PI - 0.7;
    const px = (a: number) => Math.cos(a) * rr;
    const py = (a: number) => Math.sin(a) * rr;
    g.classed("recurring", true);
    g.append("path").attr("class", "recur-arc").style("stroke-width", `${1.9 * w}px`)
      .attr("d", `M ${px(a0)} ${py(a0)} A ${rr} ${rr} 0 1 1 ${px(a1)} ${py(a1)}`);
    // arrowhead at the end, pointing the way the ring runs (clockwise)
    const tx = -Math.sin(a1), ty = Math.cos(a1); // direction of travel
    const nx = Math.cos(a1), ny = Math.sin(a1); // outward
    const L = 6.5 * w, Wd = 3.6 * w;
    const bx = px(a1), by = py(a1);
    g.append("path").attr("class", "recur-head")
      .attr("d", `M ${bx + tx * L} ${by + ty * L} L ${bx + nx * Wd} ${by + ny * Wd} L ${bx - nx * Wd} ${by - ny * Wd} Z`);
  }

  // Icons drawn inside the bubbles, centred on (0,0): a calendar, a team of people, a checkmark.
  function drawIcon(g: d3.Selection<SVGGElement, unknown, null, undefined>, kind: BubbleKind | "volunteer", date?: string) {
    const ic = g.append("g").attr("class", "bubble-icon");
    if (kind === "event") {
      // A little calendar page showing the actual date: month on the band, day number below.
      const d = date ? parseEventDate(date) : null;
      ic.append("rect").attr("x", -10).attr("y", -11).attr("width", 20).attr("height", 21).attr("rx", 3);
      ic.append("rect").attr("class", "cal-band").attr("x", -10).attr("y", -11).attr("width", 20).attr("height", 7).attr("rx", 3);
      ic.append("text").attr("class", "cal-month").attr("y", -5.6).text(d ? d.toLocaleDateString("en-US", { month: "short" }).toUpperCase() : "");
      ic.append("text").attr("class", "cal-day").attr("y", 6.5).text(d ? String(d.getDate()) : "");
    } else if (kind === "project") {
      // a seedling: two leaves on a stem, in soil
      ic.append("path").attr("d", "M-8 9 H8");
      ic.append("path").attr("d", "M0 9 V-1");
      ic.append("path").attr("d", "M0 3 C-8 3 -10 -3 -10 -6 C-4 -6 0 -3 0 3");
      ic.append("path").attr("d", "M0 -1 C0 -7 4 -11 10 -11 C10 -5 6 -1 0 -1");
    } else if (kind === "volunteer") {
      // a team of people: one in front, two behind
      ic.append("circle").attr("cx", 0).attr("cy", -4.5).attr("r", 3);
      ic.append("path").attr("d", "M-5.5 8 a5.5 5 0 0 1 11 0");
      ic.append("circle").attr("cx", -8).attr("cy", -2).attr("r", 2.2);
      ic.append("path").attr("d", "M-12 7 a3.6 3.6 0 0 1 4.2 -3.4");
      ic.append("circle").attr("cx", 8).attr("cy", -2).attr("r", 2.2);
      ic.append("path").attr("d", "M12 7 a3.6 3.6 0 0 0 -4.2 -3.4");
    } else if (kind === "action") {
      ic.append("path").attr("class", "check").attr("d", "M-7 0.5 L-2.2 5.5 L7.5 -5");
    }
  }

  function enterFocus(id: string) {
    const n = nodeById.get(id);
    if (!n) return;
    if (!settings.showBubbles) {
      // Classic view: just bring the group to the middle, no bubbles.
      const { w, h: vh } = dimensions();
      const panel = w > 900 ? 420 : 0;
      const k = Math.max(currentZoomScale, 0.8);
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(-(n.x ?? 0) * k - panel / 2, -(n.y ?? 0) * k).scale(k));
      return;
    }
    if (focusId && focusId !== id) exitFocus(false);
    focusId = id;
    nodeSel.classed("sats-hidden", (d) => d.id === id); // its items are already bubbles around it
    const cx = n.x ?? 0;
    const cy = n.y ?? 0;
    n.fx = cx; // hold the node still while you look around it
    n.fy = cy;

    const allBubbles = bubblesFor(n);
    const bubbles = settings.showBubbles ? allBubbles : [];
    const nodeR = nodeRadiusOf(n);
    const ringR = bubbles.length ? Math.max(nodeR + 62, (bubbles.length * (BUBBLE_R * 2 + 44)) / (2 * Math.PI)) : nodeR + 40;
    // Room a bubble's text needs beyond the ring; everything else is moved out past this.
    const clearR = bubbles.length ? ringR + 230 : nodeR + 120;

    focusGroup.selectAll("*").remove();
    focusGroup.attr("transform", `translate(${cx},${cy})`);
    bubbles.forEach((b, i) => {
      const a = (2 * Math.PI * i) / bubbles.length - Math.PI / 2;
      const bx = Math.cos(a) * ringR;
      const by = Math.sin(a) * ringR;
      // Bubbles grow out of the group and settle into the ring.
      const line = focusGroup.insert("line", ".bubble").attr("class", "bubble-link")
        .attr("x1", Math.cos(a) * nodeR).attr("y1", Math.sin(a) * nodeR).attr("x2", Math.cos(a) * nodeR).attr("y2", Math.sin(a) * nodeR);
      line.transition().duration(500).ease(d3.easeCubicOut).attr("x2", bx).attr("y2", by);
      const g = focusGroup.append("g").attr("class", `bubble b-${b.kind}`)
        .attr("transform", `translate(${Math.cos(a) * nodeR},${Math.sin(a) * nodeR}) scale(0.2)`)
        .attr("opacity", 0);
      g.transition().duration(500).ease(d3.easeCubicOut).attr("transform", `translate(${bx},${by}) scale(1)`).attr("opacity", 1);
      const right = Math.cos(a) >= 0;
      const side = right ? 1 : -1;
      // A transparent hit area under the text, so clicking the title clicks the bubble, not whatever is behind it.
      const textW = Math.max(b.label.length, (b.subtitle || "").length) * LABEL_PX;
      g.append("rect").attr("class", "bubble-hit")
        .attr("x", right ? 0 : -(b.r + 8 + textW)).attr("y", -b.r - 2)
        .attr("width", b.r + 8 + textW).attr("height", 2 * b.r + 4);
      g.append("circle").attr("r", b.r);
      if (b.kind === "thought") g.append("text").attr("class", "bubble-glyph").attr("dy", "0.35em").text(b.glyph);
      else {
        const isRole = b.kind === "action" && (b.item as Action).kind === "role";
        drawIcon(g as unknown as d3.Selection<SVGGElement, unknown, null, undefined>, isRole ? "volunteer" : b.kind, b.kind === "event" ? (b.item as CoalitionEvent).date : undefined);
        const word = isRole ? "VOLUNTEER" : b.kind.toUpperCase();
        g.append("text").attr("class", "bubble-type").attr("y", b.r + 10).text(word);
        if (b.kind === "event" && (b.item as CoalitionEvent).recurrence) {
          drawRecurArc(g as unknown as d3.Selection<SVGGElement, unknown, null, undefined>, b.r - 1.5, 1);
        }
      }
      const label = g.append("text")
        .attr("class", "bubble-label")
        .attr("x", side * (b.r + 6))
        .attr("dy", b.subtitle ? "-0.2em" : "0.35em")
        .attr("text-anchor", right ? "start" : "end")
        .text(b.label);
      void label;
      if (b.subtitle) {
        g.append("text").attr("class", "bubble-sub")
          .attr("x", side * (b.r + 6)).attr("dy", "1.15em")
          .attr("text-anchor", right ? "start" : "end")
          .text(b.subtitle);
      }
      g.on("click", (event: Event) => {
        event.stopPropagation();
        const cb2 = (g.select("circle").node() as SVGCircleElement).getBoundingClientRect();
        const wb = wrap.getBoundingClientRect();
        showCard(b, { x: cb2.left - wb.left + cb2.width / 2, y: cb2.top - wb.top + cb2.height / 2, r: cb2.width / 2 });
      });
    });

    // Partners stay visible but recede; everything else nearly disappears.
    const partners = partnersOf(n);
    // A coalition has dozens of members, so its partners fade further than an org's few neighbours.
    nodeSel
      .classed("faded", (d) => d.id !== id && !partners.has(d.id))
      .classed("partner", (d) => partners.has(d.id))
      .classed("partner-many", (d) => partners.has(d.id) && partners.size > 12);
    linkSel.classed("faded", (l) => {
      const s = typeof l.source === "string" ? l.source : l.source.id;
      const t = typeof l.target === "string" ? l.target : l.target.id;
      return s !== id && t !== id;
    });

    // Push every other group well away so the bubbles have clear space (and nothing sits behind them).
    sim.force("focusPush", () => {
      const f = nodeById.get(id);
      if (!f) return;
      for (const o of allNodes) {
        if (o === f) continue;
        const dx = (o.x ?? 0) - (f.x ?? 0);
        const dy = (o.y ?? 0) - (f.y ?? 0);
        const d = Math.hypot(dx, dy) || 1;
        const min = clearR + nodeRadiusOf(o);
        if (d < min) {
          o.vx = (o.vx ?? 0) + (dx / d) * (min - d) * 0.25;
          o.vy = (o.vy ?? 0) + (dy / d) * (min - d) * 0.25;
        }
      }
    });

    // Header: who, what's here, how to leave.
    while (focusBar.firstChild) focusBar.removeChild(focusBar.firstChild);
    const count = (k: BubbleKind) => allBubbles.filter((b) => b.kind === k).length;
    const back = h("button", { class: "focus-back", type: "button" }, "← Back to network");
    back.addEventListener("click", () => exitFocus());
    focusBar.appendChild(back);
    focusBar.appendChild(h("strong", { class: "focus-title" }, n.name));
    const stat = (k: "project" | "event" | "action", label: string) =>
      h("span", { class: `lg k-${k}`, title: label, "aria-label": `${label} ${count(k)}` }, typeIcon(k, 16), h("b", {}, String(count(k))));
    const legend = h("div", { class: "focus-legend" },
      count("thought") ? h("span", { class: "lg k-thought" }, `Thinking ${count("thought")}`) : null,
      stat("project", "Projects"),
      stat("event", "Events"),
      stat("action", "Actions"),
    );
    focusBar.appendChild(legend);
    const classicBtn = h("button", { class: "focus-back", type: "button", title: "Stop showing bubbles when a group is clicked; just open its details panel" }, "Turn items off");
    classicBtn.addEventListener("click", () => setViewMode(false));
    focusBar.appendChild(classicBtn);
    if (!count("thought")) {
      focusBar.appendChild(h("div", { class: "focus-note" },
        "No public thinking shared yet. Point people can add it with the + button; nothing appears here until the group approves it."));
    }
    focusBar.appendChild(h("span", { class: "focus-more" }, "Details ›"));
    focusBar.classList.add("tappable");
    focusBar.onclick = (ev) => {
      if ((ev.target as HTMLElement).closest("button")) return;
      cb.onOpenDetails?.(n);
    };
    focusBar.style.display = "flex";
    focusCard.style.display = "none";

    // Zoom so the ring fills the view (nudged left when the details panel covers the right side).
    const { w, h: vh } = dimensions();
    const panel = w > 900 ? 420 : 0; // width of the details panel that overlays the right side
    const scale = Math.max(
      0.35,
      Math.min(2.2, (w - panel) / (2 * (ringR + 230)), vh / (2 * (ringR + 90))),
    );
    const shift = panel / 2;
    const t = d3.zoomIdentity.translate(-cx * scale - shift, -cy * scale).scale(scale);
    svg.transition().duration(600).call(zoom.transform, t);
    sim.alpha(0.7).restart();
  }

  function exitFocus(fit = true) {
    if (!focusId) return;
    const n = nodeById.get(focusId);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    focusId = null;
    nodeSel.classed("sats-hidden", false);
    sim.force("focusPush", null);
    // Bubbles fold back into the group, then disappear.
    if (fit) {
      const nn = n;
      focusGroup.selectAll<SVGGElement, unknown>("g.bubble")
        .transition().duration(350).ease(d3.easeCubicIn)
        .attr("transform", `translate(0,0) scale(0.2)`).attr("opacity", 0);
      focusGroup.selectAll("line.bubble-link").transition().duration(350).attr("opacity", 0);
      setTimeout(() => { if (!focusId) focusGroup.selectAll("*").remove(); }, 380);
      void nn;
    } else {
      focusGroup.selectAll("*").remove();
    }
    nodeSel.classed("faded", false).classed("partner", false).classed("partner-many", false);
    linkSel.classed("faded", false);
    focusBar.style.display = "none";
    focusCard.style.display = "none";
    if (fit) setTimeout(() => { if (!focusId) fitToView(true); }, 450);
    sim.alpha(0.6).restart();
  }

  // ----- Selection -----
  function applySelection() {
    nodeSel.classed("selected", (n) => n.id === selectedId);
  }

  const api: Graph = {
    orgLinkToggle() {
      return toggle;
    },
    setVisibleCoalitions(ids) {
      visibleCoalitions = new Set(ids);
      applyVisibility();
    },
    setSelectedNode(node) {
      selectedId = node?.id ?? null;
      applySelection();
    },
    focusOnNode(id) {
      enterFocus(id);
    },
    focusOnCoalition(id) {
      enterFocus(id);
    },
    enterFocus(id) {
      enterFocus(id);
    },
    exitFocus() {
      exitFocus();
    },
    ensureInView() {
      ensureInView();
    },
    updateSettings(partial) {
      const before = { ...settings };
      settings = { ...settings, ...partial };
      // Forces that depend on settings need re-init
      if (partial.linkForce !== undefined) {
        linkForce.strength(linkStrengthFor);
      }
      if (partial.linkDistance !== undefined) {
        linkForce.distance(linkDistanceFor);
      }
      if (partial.repelForce !== undefined) {
        chargeForce.strength(chargeStrengthFor);
      }
      if (partial.centerForce !== undefined) {
        xForce.strength(centerForceStrength());
        yForce.strength(centerForceStrength());
      }
      if (partial.showAllEvents !== undefined || partial.showAllProjects !== undefined || partial.showAllActions !== undefined || partial.alwaysShow !== undefined) {
        if (partial.alwaysShow !== undefined) {
          try { localStorage.setItem("openthink.always", settings.alwaysShow ? "1" : "0"); } catch (_) { /* ignore */ }
        }
        refreshSats();
      }
      if (partial.weightEvents !== undefined || partial.weightProjects !== undefined || partial.weightActions !== undefined || partial.weightConnections !== undefined) {
        collideForce.radius((n) => nodeRadiusOf(n) + 14);
        applyVisualSettings();
        sim.alpha(0.4).restart();
      }
      if (partial.showBubbles !== undefined) {
        if (!settings.showBubbles && focusId) exitFocus(); // Classic: fold everything back to the plain network
        refreshSats();
        syncViewSwitch();
        window.dispatchEvent(new CustomEvent("openthink:viewmode", { detail: { bubbles: settings.showBubbles } }));
      }
      if (partial.nodeSize !== undefined) {
        collideForce.radius((n) => nodeRadiusOf(n) + 14);
        applyVisualSettings();
      }
      if (partial.linkThickness !== undefined) {
        linkSel.attr("stroke-width", linkWidthFor);
      }
      if (partial.textFadeThreshold !== undefined || partial.showText !== undefined) {
        applyTextFade();
      }
      // If any force changed, re-energize the sim
      const forceChanged =
        partial.centerForce !== undefined ||
        partial.repelForce !== undefined ||
        partial.linkForce !== undefined ||
        partial.linkDistance !== undefined ||
        partial.nodeSize !== undefined;
      if (forceChanged) sim.alpha(0.5).restart();
      void before;
    },
    setGroups(g) {
      groups = g;
      applyVisualSettings();
    },
    kickSimulation() {
      sim.alpha(1).restart();
    },
    bubblesOn() {
      return settings.showBubbles;
    },
  };

  syncViewSwitch();
  satsReady = true;
  refreshSats();
  return api;
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function fmtShortDate(iso: string): string {
  const d = parseEventDate(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
