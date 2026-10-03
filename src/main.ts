import "./styles.css";
import type { DataFile, GraphNode, Thought } from "./types";
import { createTopbar, type TopTab } from "./topbar";
import { createSidebar } from "./sidebar";
import { createGraph } from "./graph";
import { createTooltip } from "./tooltip";
import { createDrawer } from "./drawer";
import { createGeographicView } from "./geographic";
import { createEventsView } from "./events";
import { createProjectsView } from "./projects";
import { createActionsView } from "./actions";
import { createTopicsView } from "./topics";
import { createOrgsView } from "./orgs";
import { createControls } from "./controls";
import { h, clear } from "./dom";
import { createFab, setFormLabelData, setItemLabelData } from "./fab";
import { setupSidebarToggle, createMapLegend, captureLandText } from "./sidebar";

captureLandText(); // before the loading screen goes away
import { currentMap, MAPS, type MapDef } from "./maps";
import { rollRecurringForward } from "./recurrence";
import { attachSectors, createSectorSection } from "./sectors";

// The splash in index.html shows a progress bar; these tell it how far along we really are.
type BootWindow = Window & { bootProgress?: (p: number, label?: string) => void; bootDone?: () => void };
const bootWin = window as BootWindow;
function bootProgress(p: number, label?: string) {
  bootWin.bootProgress?.(p, label);
}

/** Fill the bar, then fade out the splash that index.html shows while the data and map load. */
function hideBoot() {
  const el = document.getElementById("boot");
  if (!el) return;
  bootWin.bootDone?.();
  setTimeout(() => {
    el.classList.add("done");
    setTimeout(() => el.remove(), 600);
  }, 250);
}

async function main() {
  document.title = currentMap.fullTitle;
  const app = document.getElementById("app")!;
  clear(app);

  // Fetch data
  let data: DataFile;
  try {
    bootProgress(0.03, "Fetching the latest data\u2026");
    data = await loadData();
  } catch (err) {
    createTopbar(app, { onTabChange: () => {} });
    app.appendChild(
      h(
        "div",
        { class: "stub" },
        h(
          "div",
          { class: "inner" },
          h("h2", {}, "Couldn't load data"),
          h("p", {}, (err as Error).message),
        ),
      ),
    );
    return;
  }

  bootProgress(0.8, "Drawing the map\u2026");
  await attachThoughts(data);
  // Sector layers (Map settings → Social justice) that this browser has switched on.
  const sectorsOn = await attachSectors(data, currentMap.id);
  // Recurring events carry one stored date; show their next occurrence.
  for (const n of [...data.coalitions, ...data.organizations]) if (n.events) rollRecurringForward(n.events);

  let activeTab: TopTab = "map";

  const topbar = createTopbar(
    app,
    {
      onTabChange: (t) => setTab(t),
      onHome: () => {
        setTab("map");
        graphApi?.exitFocus();
        drawerApi?.close();
        graphApi?.setSelectedNode(null);
      },
    },
    activeTab,
  );

  // ---- Shared content area (one of these is visible at a time) ----
  const content = h("div", { class: "content" });
  // Make content fill the remaining space
  content.style.position = "relative";
  content.style.overflow = "hidden";
  app.appendChild(content);

  // ----- Map view (sidebar + graph + drawer) -----
  const mapView = h("div", { class: "view map", style: "height:100%" });
  mapView.style.display = "grid";
  content.appendChild(mapView);

  const tooltip = createTooltip();

  let graphApi: ReturnType<typeof createGraph> | null = null;
  let drawerApi: ReturnType<typeof createDrawer> | null = null;

  const sidebar = createSidebar(mapView, data, {
    onChange: (visible) => {
      graphApi?.setVisibleCoalitions(visible);
    },
  });

  const graphContainer = h("div", {
    class: "graph-area",
    style: "position:relative;overflow:hidden",
  });
  mapView.appendChild(graphContainer);
  setupSidebarToggle(mapView, sidebar.element(), graphContainer);

  drawerApi = createDrawer(graphContainer, data, {
    onOrgClick: (id) => {
      const org = data.organizations.find((o) => o.id === id);
      if (!org) return;
      const node: GraphNode = { ...org, kind: "org" };
      drawerApi!.open(node);
      graphApi?.setSelectedNode(node);
      if (activeTab === "map") graphApi?.focusOnNode(id);
    },
    onCoalitionClick: (cid) => {
      const coalition = data.coalitions.find((c) => c.id === cid);
      if (!coalition) return;
      const node: GraphNode = { ...coalition, kind: "coalition" };
      drawerApi!.open(node);
      graphApi?.setSelectedNode(node);
      graphApi?.focusOnCoalition(cid);
    },
  });

  // On a phone the details tray would cover the group you just opened, so with bubbles on we show only
  // the small summary card at the top; tapping it (or switching to Classic) opens the tray.
  const isMobile = () => window.innerWidth <= 900;
  const trayWouldBlockMap = () => isMobile() && !!graphApi?.bubblesOn();
  graphApi = createGraph(graphContainer, data, tooltip, {
    onNodeClick: (node) => {
      if (trayWouldBlockMap()) drawerApi!.close();
      else drawerApi!.open(node);
      graphApi!.setSelectedNode(node);
    },
    onOpenDetails: (node) => {
      drawerApi!.open(node);
      graphApi!.setSelectedNode(node);
    },
    onNodeDeselect: () => {
      drawerApi!.close();
      graphApi!.setSelectedNode(null);
    },
  });
  graphApi.setVisibleCoalitions(sidebar.getVisibleCoalitions());
  bootProgress(0.9, "Setting up the tabs\u2026");

  // The key to the map sits on the map itself.
  createMapLegend(graphContainer, sectorsOn);

  // Controls panel — mounts inside the sidebar
  const controls = createControls(sidebar.controlsContainer(), {
    // The Bubbles/Classic switch lives on the map itself, so saved control state never overrides it.
    onSettingsChange: (partial) => {
      // These two belong to the switches on the map (and their copies in the sidebar), not to saved settings.
      const { showBubbles: _ignored, alwaysShow: _ignored2, ...rest } = partial;
      graphApi!.updateSettings(rest);
    },
    onGroupsChange: (rules) => graphApi!.setGroups(rules),
    onAnimate: () => graphApi!.kickSimulation(),
  });
  // The org-to-org connections toggle lives with the other advanced display options.
  controls.advancedContainer().appendChild(graphApi.orgLinkToggle());
  // "Social justice": one switch per sector layer, closed by default, just above Advanced display settings.
  createSectorSection(sidebar.controlsContainer(), currentMap.id);

  // ----- Geographic view -----
  const geoView = createGeographicView(data, {
    onNodeClick: (node) => {
      drawerApi!.open(node);
    },
  });
  geoView.el.style.display = "none";
  geoView.el.style.height = "100%";
  geoView.el.style.position = "absolute";
  geoView.el.style.inset = "0";
  content.appendChild(geoView.el);
  // The drawer is mounted inside the map view's graphContainer; we want
  // it to overlay other views too — re-parent it to content so it appears
  // above all views.
  if (drawerApi) {
    const drawerEl = graphContainer.querySelector(".drawer");
    if (drawerEl) content.appendChild(drawerEl);
  }

  // ----- Events view -----
  const eventsView = createEventsView(data, {
    onCoalitionClick: (node) => {
      setTab("map");
      // Defer drawer open so the map is visible first
      setTimeout(() => {
        if (!trayWouldBlockMap()) drawerApi!.open(node);
        graphApi!.setSelectedNode(node);
        if (node.kind === "coalition" || trayWouldBlockMap()) graphApi!.focusOnNode(node.id);
      }, 60);
    },
  });
  eventsView.el.style.display = "none";
  eventsView.el.style.height = "100%";
  eventsView.el.style.position = "absolute";
  eventsView.el.style.inset = "0";
  content.appendChild(eventsView.el);

  // ----- Organizations view -----
  const orgsView = createOrgsView(data, {
    onOrgClick: (node) => {
      drawerApi!.open(node);
      graphApi!.setSelectedNode(node);
    },
  });
  orgsView.el.style.display = "none";
  orgsView.el.style.height = "100%";
  orgsView.el.style.position = "absolute";
  orgsView.el.style.inset = "0";
  content.appendChild(orgsView.el);

  // ----- Projects view -----
  const projectsView = createProjectsView(data, {
    onCoalitionClick: (node) => {
      setTab("map");
      setTimeout(() => {
        if (!trayWouldBlockMap()) drawerApi!.open(node);
        graphApi!.setSelectedNode(node);
        if (node.kind === "coalition" || trayWouldBlockMap()) graphApi!.focusOnNode(node.id);
      }, 60);
    },
  });
  projectsView.el.style.display = "none";
  projectsView.el.style.height = "100%";
  projectsView.el.style.position = "absolute";
  projectsView.el.style.inset = "0";
  content.appendChild(projectsView.el);

  // ----- Actions & volunteer opportunities view -----
  const actionsView = createActionsView(data, {
    onCoalitionClick: (node) => {
      setTab("map");
      setTimeout(() => {
        if (!trayWouldBlockMap()) drawerApi!.open(node);
        graphApi!.setSelectedNode(node);
        if (node.kind === "coalition" || trayWouldBlockMap()) graphApi!.focusOnNode(node.id);
      }, 60);
    },
  });
  actionsView.el.style.display = "none";
  actionsView.el.style.height = "100%";
  actionsView.el.style.position = "absolute";
  actionsView.el.style.inset = "0";
  content.appendChild(actionsView.el);

  // ----- Topics view (streams of energy into topics; loads public/topics.json the first time it opens) -----
  const topicsView = createTopicsView({
    hasGroup: (id) => data.coalitions.some((c) => c.id === id) || data.organizations.some((o) => o.id === id),
    logoOf: (id) => (data.coalitions.find((c) => c.id === id) ?? data.organizations.find((o) => o.id === id))?.logo || undefined,
    onGroupClick: (id) => {
      const c = data.coalitions.find((x) => x.id === id);
      const o = data.organizations.find((x) => x.id === id);
      const node: GraphNode | null = c ? { ...c, kind: "coalition" } : o ? { ...o, kind: "org" } : null;
      if (!node) return false;
      setTab("map");
      setTimeout(() => {
        if (!trayWouldBlockMap()) drawerApi!.open(node);
        graphApi!.setSelectedNode(node);
        // Same as the Events/Projects/Actions pages: zoom to coalitions (or on a phone), otherwise just open details.
        if (node.kind === "coalition" || trayWouldBlockMap()) graphApi!.focusOnNode(node.id);
      }, 60);
      return true;
    },
  });
  topicsView.el.style.display = "none";
  topicsView.el.style.height = "100%";
  topicsView.el.style.position = "absolute";
  topicsView.el.style.inset = "0";
  content.appendChild(topicsView.el);

  function setTab(tab: TopTab) {
    activeTab = tab;
    topbar.setActive(tab);
    mapView.style.display = tab === "map" ? "grid" : "none";
    geoView.el.style.display = tab === "geo" ? "block" : "none";
    eventsView.el.style.display = tab === "events" ? "grid" : "none";
    orgsView.el.style.display = tab === "orgs" ? "grid" : "none";
    projectsView.el.style.display = tab === "projects" ? "grid" : "none";
    actionsView.el.style.display = tab === "actions" ? "grid" : "none";
    topicsView.el.style.display = tab === "topics" ? "grid" : "none";
    if (tab === "topics") topicsView.show();
    if (tab === "geo") geoView.invalidate();
    if (tab === "map") setTimeout(() => graphApi?.ensureInView(), 150);
    if (tab !== "map") {
      tooltip.hide();
      // The org details panel belongs to the map; don't leave it floating over the other tabs.
      graphApi?.exitFocus();
      drawerApi?.close();
      graphApi?.setSelectedNode(null);
    }
  }

  // "+" button for proposing edits/additions through the forms (pre-filled from the open drawer)
  setFormLabelData(data.organizations);
  setItemLabelData([...data.coalitions, ...data.organizations]);
  // Sector groups aren't in the Google Sheet yet, so the forms aren't pre-filled with them.
  createFab(content, () => {
    const cur = drawerApi?.current() ?? null;
    return cur && (cur as { sector?: string }).sector ? null : cur;
  });

  // Escape closes drawer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      graphApi?.exitFocus();
      drawerApi?.close();
      graphApi?.setSelectedNode(null);
    }
  });
}

/** Live data from the Google Sheet when configured, else the committed snapshot. */
async function loadData(map: MapDef = currentMap): Promise<DataFile> {
  if (map.combine) {
    // USA view: every state we have, side by side (a state that fails to load is skipped).
    const parts = await Promise.all(map.combine.map((id) => loadData(MAPS[id]).catch(() => null)));
    const got = parts.filter((p): p is DataFile => !!p);
    if (!got.length) throw new Error("No state maps could be loaded");
    const seen = new Set<string>();
    const uniq = <T extends { id: string }>(xs: T[]) => xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
    return {
      generated_at: got.map((d) => d.generated_at).sort().pop() || "",
      coalitions: uniq(got.flatMap((d) => d.coalitions)),
      organizations: uniq(got.flatMap((d) => d.organizations)),
      edges: got.flatMap((d) => d.edges || []),
      org_links: got.flatMap((d) => d.org_links || []),
    };
  }
  const get = async (url: string, ms: number) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const d = JSON.parse(await readWithProgress(res)) as DataFile;
      if (!Array.isArray(d.coalitions) || !Array.isArray(d.organizations)) throw new Error("bad data");
      return d;
    } finally {
      clearTimeout(timer);
    }
  };
  let lastErr: unknown = null;
  for (let i = 0; i < map.sources.length; i++) {
    const last = i === map.sources.length - 1;
    try {
      return await get(map.sources[i], last ? 15000 : 8000);
    } catch (err) {
      lastErr = err;
      if (!last) console.warn("Data source unavailable, trying the next one:", err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("No data source");
}

/** Read a response body, reporting download progress to the splash when the size is known. */
async function readWithProgress(res: Response): Promise<string> {
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    // content-length can be the compressed size, so cap the share this step may claim
    bootProgress(0.05 + Math.min(1, got / total) * 0.7);
  }
  const all = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(all);
}

/**
 * Public "thinking" bubbles live in public/thoughts.json ({ "<org or coalition id>": Thought[] }),
 * separate from the sheet so each item can be reviewed and approved before it is published.
 * Missing or malformed file = no thinking bubbles, never an error.
 */
async function attachThoughts(data: DataFile): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}thoughts.json`);
    if (!res.ok) return;
    const byId = (await res.json()) as Record<string, Thought[]>;
    for (const n of [...data.coalitions, ...data.organizations]) {
      const list = byId[n.id];
      if (Array.isArray(list) && list.length) n.thoughts = list;
    }
  } catch {
    /* optional */
  }
}

main().finally(() => requestAnimationFrame(() => requestAnimationFrame(hideBoot)));
