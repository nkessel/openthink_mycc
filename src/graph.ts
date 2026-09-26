import * as d3 from "d3";
import type {
  DataFile,
  GraphNode,
  GraphLink,
  CoalitionNode,
  OrgNode,
} from "./types";
import { coalitionRadius, orgRadius, initials } from "./util";
import type { Tooltip } from "./tooltip";
import { createNodeSearch, allNodesForSearch } from "./search";

export interface GraphCallbacks {
  onNodeClick(node: GraphNode): void;
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
  arrows: boolean;
}

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  centerForce: 0.5,
  repelForce: 0.5,
  linkForce: 0.5,
  linkDistance: 0.5,
  nodeSize: 1,
  linkThickness: 1,
  textFadeThreshold: 0.5,
  arrows: false,
};

export interface Graph {
  setVisibleCoalitions(ids: Set<string>): void;
  /** Center on any node (coalition or org). */
  focusOnNode(id: string): void;
  setSelectedNode(node: GraphNode | null): void;
  focusOnCoalition(id: string): void;
  /** The "org-to-org connections" checkbox, for the host page to place (the sidebar). */
  orgLinkToggle(): HTMLElement;
  updateSettings(partial: Partial<GraphSettings>): void;
  setGroups(groups: GroupRule[]): void;
  kickSimulation(): void;
}

const COALITION_LABEL_FONT_SIZE = 14;
const ORG_LABEL_FONT_SIZE = 10;
/** Logo size as a share of the node radius (a small margin keeps round logos off the edge). */
const LOGO_SCALE = 0.86;
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
    ? "Drag nodes · Pinch to zoom · Tap for details"
    : "Drag nodes · Scroll to zoom · Click for details";
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
      applyTextFade();
      // Hide tooltip while zooming
      tooltip.hide();
    });

  let currentZoomScale = 1;
  function applyTextFade() {
    // The threshold slider value 0..1 maps to a zoom scale 0.2..2.5.
    // Below that scale, node-name labels fade out.
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
  function nodeRadiusOf(n: GraphNode): number {
    const base = n.kind === "coalition" ? coalitionRadius(n) : orgRadius(n);
    return base * settings.nodeSize;
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
      if (d.logo) ring.attr("stroke", d.color).attr("stroke-width", 5);
      const cLabel = sel
        .append("text")
        .attr("class", "node-label")
        .attr("font-size", Math.min(r * 0.55, 22))
        .text(d.abbrev || initials(d.name));
      if (d.logo) {
        // Logo inside the coalition's colored ring; the abbreviation returns if the image fails.
        cLabel.style("display", "none");
        const s = r * LOGO_SCALE * 0.9;
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
            ring.attr("fill", d.color).attr("stroke-width", 0);
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
            sel.select("circle.ring").attr("fill", "#2a2a36");
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

  // ----- Apply visual settings (radii, halos, link thickness, fade) -----
  function applyVisualSettings() {
    // Update circle radii + label y-positions based on node-size multiplier
    nodeSel.each(function (this: SVGGElement, d) {
      const sel = d3.select(this);
      const r = nodeRadiusOf(d);
      sel.select<SVGCircleElement>("circle.ring").attr("r", r);
      const s = r * LOGO_SCALE * (d.kind === "coalition" ? 0.9 : 1);
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
      cb.onNodeClick(d);
    });

  // Clicking the background closes selection
  svg.on("click", () => {
    api.setSelectedNode(null);
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
      api.focusOnCoalition(id);
    },
    focusOnCoalition(id) {
      const n = nodeById.get(id);
      if (!n || n.x === undefined || n.y === undefined) return;
      const { w, h } = dimensions();
      const scale = 1.4;
      const t = d3.zoomIdentity
        .translate(-n.x * scale, -n.y * scale)
        .scale(scale);
      void w;
      void h;
      svg.transition().duration(550).call(zoom.transform, t);
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
      if (partial.nodeSize !== undefined) {
        collideForce.radius((n) => nodeRadiusOf(n) + 14);
        applyVisualSettings();
      }
      if (partial.linkThickness !== undefined) {
        linkSel.attr("stroke-width", linkWidthFor);
      }
      if (partial.textFadeThreshold !== undefined) {
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
  };

  return api;
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
