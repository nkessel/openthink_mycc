import "./styles.css";
import type { Action, CoalitionEvent, DataFile, GraphNode, Project, Thought } from "./types";
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
import { findItem, showItemCard, setCardActions } from "./itemcard";
import { createOrgsView } from "./orgs";
import { createControls } from "./controls";
import { h, clear } from "./dom";
import { createFab, setFormLabelData, setItemLabelData } from "./fab";
import { setupSidebarToggle, createMapLegend, captureLandText } from "./sidebar";

captureLandText(); // before the loading screen goes away
import { currentMap, MAPS, type MapDef } from "./maps";
import { rollRecurringForward } from "./recurrence";
import { parseEventDate } from "./util";
import { attachSectors, createSectorSection } from "./sectors";

// The splash in index.html shows a progress bar; these tell it how far along we really are.
type BootWindow = Window & { bootProgress?: (p: number, label?: string) => void; bootDetail?: (text: string) => void; bootDone?: () => void; bootHeld?: boolean; bootRelease?: () => void; bootDetailPendingMs?: () => number };
/** The loading screen's one line of text: short, true, and about the people on the map. */
function bootDetail(text: string) {
  bootWin.bootDetail?.(text);
}
const bootWin = window as BootWindow;
function bootProgress(p: number) {
  bootWin.bootProgress?.(p);
}

/** Fill the bar, then fade out the splash that index.html shows while the data and map load. */
function hideBoot() {
  const el = document.getElementById("boot");
  if (!el) return;
  bootWin.bootDone?.();
  const go = () => {
    el.classList.add("done");
    setTimeout(() => el.remove(), 600);
  };
  bootWin.bootProgress?.(1);
  // Someone pressed "Keep this screen open": wait for their "Open the map".
  if (bootWin.bootHeld) {
    bootDetail("Everything is loaded. Open the map when you're ready.");
    bootWin.bootRelease = go;
    return;
  }
  // Otherwise let the last few loading lines finish showing (briefly), then open.
  const pending = Math.min(3000, bootWin.bootDetailPendingMs?.() ?? 0);
  setTimeout(() => (bootWin.bootHeld ? (bootWin.bootRelease = go) : go()), 250 + pending);
}

async function main() {
  document.title = currentMap.fullTitle;
  const app = document.getElementById("app")!;
  clear(app);

  // Fetch data
  let data: DataFile;
  try {
    bootProgress(0.03);
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

  bootProgress(0.8);
  // The loading lines Nathan picked (2026-10-05): what is loading, then true counts from the data.
  bootDetail("Inviting everyone to a seat at the table\u2026");
  bootDetail(`Loading ${data.coalitions.length} coalitions and ${data.organizations.length} groups`);
  bootDetail(`Linking ${data.edges.length} coalition memberships`);
  await attachThoughts(data);
  // Sector layers (Map settings → Social justice) that this browser has switched on.
  const sectorsOn = await attachSectors(data, currentMap.id);
  // Recurring events carry one stored date; show their next occurrence.
  for (const n of [...data.coalitions, ...data.organizations]) if (n.events) rollRecurringForward(n.events);
  const groups = [...data.coalitions, ...data.organizations];
  const bridges = data.organizations.filter((o) => (o.coalition_ids?.length || 0) > 1).length;
  const facts: string[] = [];
  if (bridges) facts.push(`${bridges} groups work across two or more coalitions`);
  // "Connecting N groups across N towns": each placed group goes to its nearest town centre (Massachusetts towns list)
  if (currentMap.id === "ma") {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}geo/ma-town-centroids.json`);
      const centres = Object.entries((await res.json()) as Record<string, [number, number]>);
      const towns = new Set<string>();
      let placed = 0;
      for (const o of data.organizations) {
        if (o.remote || !Number.isFinite(o.lat) || !Number.isFinite(o.lng) || (Math.abs(o.lat - 42.3601) < 1e-4 && Math.abs(o.lng + 71.0589) < 1e-4)) continue;
        let best = "", bd = Infinity;
        for (const [name, [la, ln]] of centres) {
          const d = (la - o.lat) ** 2 + ((ln - o.lng) * 0.74) ** 2;
          if (d < bd) { bd = d; best = name; }
        }
        if (best && Math.sqrt(bd) < 0.08) { towns.add(best); placed++; } // within ~9 km of a town centre
      }
      if (towns.size > 1) facts.push(`Connecting ${placed} groups across ${towns.size} towns`);
    } catch {
      /* no towns list: skip this line */
    }
  }
  const now = Date.now();
  const eventsWithin = (days: number) => groups.flatMap((g) => g.events || []).filter((e) => {
    const t = e.date ? parseEventDate(e.date).getTime() : NaN;
    return t >= now - 12 * 3600e3 && t <= now + days * 864e5;
  }).length;
  const week = eventsWithin(7), month = eventsWithin(30);
  if (week) facts.push(`${week} events this week`);
  if (month) facts.push(`${month} events in the next 30 days`);
  const projectsNow = groups.flatMap((g) => g.projects || []).filter((p) => (p.status || "active") === "active").length;
  if (projectsNow) facts.push(`${projectsNow} projects underway`);
  const today = new Date().toISOString().slice(0, 10);
  const acts = groups.flatMap((g) => g.actions || []).filter((a) => !a.deadline || a.deadline >= today);
  const roles = acts.filter((a) => a.kind === "role").length;
  if (acts.length - roles) facts.push(`${acts.length - roles} actions you can take today`);
  if (roles) facts.push(`${roles} ways to volunteer`);
  // a different order each visit, so a quick load still shows something new
  for (let i = facts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [facts[i], facts[j]] = [facts[j], facts[i]]; }
  for (const f of facts) bootDetail(f);
  const logosReady = preloadLogos(groups.map((g) => g.logo));

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
    },
    onCoalitionClick: (cid) => {
      const coalition = data.coalitions.find((c) => c.id === cid);
      if (!coalition) return;
      const node: GraphNode = { ...coalition, kind: "coalition" };
      drawerApi!.open(node);
      graphApi?.setSelectedNode(node);
    },
    // The pane never moves a map on its own; only these buttons do.
    onLocate: (where, node, it) => {
      if (where === "map") locateOnMap(node, it);
      else locateOnGeo(node, it);
    },
    canLocateGeo: (node, item) => geoView.canLocate(node, item as { lat?: number; lng?: number } | undefined),
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
    onItemClick: (kind, item, owner) => {
      drawerApi!.openItem(kind, item, owner);
    },
    showsDetailsOf: (node) => (trayWouldBlockMap() ? !drawerApi!.showingItem() : drawerApi!.isOpen() && !drawerApi!.showingItem() && drawerApi!.current()?.id === node.id),
    onNodeDeselect: () => {
      drawerApi!.close();
      graphApi!.setSelectedNode(null);
    },
  });
  graphApi.setVisibleCoalitions(sidebar.getVisibleCoalitions());
  bootProgress(0.9);

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
    onItemClick: (_kind, id, at) => {
      const f = findItem(data, id);
      if (f) showItemCard(geoView.el, f.kind, f.item, f.owner, () => locateOnMap(f.owner.node), at);
    },
    onLocateMap: (node) => locateOnMap(node),
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
      openDetails(node);
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
      openDetails(node);
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
      openDetails(node);
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
    hasItem: (rid) => !!findItem(data, rid.slice(rid.indexOf(":") + 1)),
    openItem: (rid, at) => {
      const f = findItem(data, rid.slice(rid.indexOf(":") + 1));
      if (f) showItemCard(topicsView.el, f.kind, f.item, f.owner, () => openGroup(f.owner.node.id), at);
    },
    onGroupClick: (id) => openGroup(id),
  });
  function openGroup(id: string): boolean {
    const c = data.coalitions.find((x) => x.id === id);
    const o = data.organizations.find((x) => x.id === id);
    const node: GraphNode | null = c ? { ...c, kind: "coalition" } : o ? { ...o, kind: "org" } : null;
    if (!node) return false;
    openDetails(node);
    return true;
  }
  topicsView.el.style.display = "none";
  topicsView.el.style.height = "100%";
  topicsView.el.style.position = "absolute";
  topicsView.el.style.inset = "0";
  content.appendChild(topicsView.el);

  /** A group's full details in the pane, over whatever page you're on. Nothing moves. */
  function openDetails(node: GraphNode) {
    drawerApi!.open(node);
    graphApi!.setSelectedNode(node);
  }
  /** "Locate on strategy map": go to the group (and open the item, if one was asked for). */
  function locateOnMap(node: GraphNode, it?: { kind: "event" | "project" | "action"; item: CoalitionEvent | Project | Action }) {
    setTab("map");
    setTimeout(() => {
      graphApi!.setSelectedNode(node);
      graphApi!.focusOnNode(node.id);
      if (it) drawerApi!.openItem(it.kind, it.item, node);
      else if (!trayWouldBlockMap()) drawerApi!.open(node);
    }, 60);
  }
  /** "Locate on geographic map": the item's pin, or the group's place. */
  function locateOnGeo(node: GraphNode, it?: { kind: "event" | "project" | "action"; item: CoalitionEvent | Project | Action }) {
    setTab("geo");
    const pt = it?.item as { lat?: number; lng?: number } | undefined;
    geoView.locate(node, it ? { kind: it.kind, id: it.item.id, lat: pt?.lat, lng: pt?.lng } : undefined);
    if (it) drawerApi!.openItem(it.kind, it.item, node);
    else drawerApi!.open(node);
  }
  setCardActions({
    details: (kind, item, owner) => drawerApi!.openItem(kind, item, owner.node),
    locateMap: (kind, item, owner) => locateOnMap(owner.node, { kind, item }),
    locateGeo: (kind, item, owner) => locateOnGeo(owner.node, { kind, item }),
    hasGeo: (_kind, item, owner) => geoView.canLocate(owner.node, item as { lat?: number; lng?: number }),
  });

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

  // Give the logos a moment so the map doesn't open on empty circles (they keep loading after that anyway).
  await Promise.race([logosReady, new Promise((r) => setTimeout(r, 1500))]);

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
    const live = /script\.google/.test(map.sources[i]);
    // (no line here: the heading already says "Loading the map…")
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
/** Warm the browser cache with the groups' logos, counting them off on the loading screen. */
function preloadLogos(logos: (string | undefined)[]): Promise<void> {
  const urls = [...new Set(logos.filter((u): u is string => !!u))];
  if (!urls.length) return Promise.resolve();
  let done = 0;
  return new Promise((resolve) => {
    const tick = () => {
      done++;
      if (done === urls.length) resolve();
    };
    for (const u of urls) {
      const im = new Image();
      im.onload = im.onerror = tick;
      im.src = u;
    }
  });
}

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
