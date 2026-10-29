import "./styles.css";
import { displayControls, initDisplay, largePrint, onDisplayChange } from "./display";

initDisplay();
import type { Action, CoalitionEvent, DataFile, GraphNode, Project, Thought } from "./types";
import { createTopbar, type TopTab } from "./topbar";
import { createSidebar } from "./sidebar";
import { createGraph } from "./graph";
import { createTooltip } from "./tooltip";
import { createDrawer } from "./drawer";
import { findItem, showItemCard, setCardActions } from "./itemcard";
import { createControls } from "./controls";
import { h, clear } from "./dom";
import { FORMS } from "./forms.config";
import { webLogo } from "./weblogos";
import { createFab, setFormLabelData, setItemLabelData } from "./fab";
import { setPrefillData } from "./prefill";
import { checkSources } from "./sourcecheck";
import { lazyPage, preloadWhenQuiet } from "./lazypage";
import { atFallback, geoCanLocate } from "./placed";
import { setQuickFormData } from "./quickform";
import { setupSidebarToggle, createMapLegend, captureLandText } from "./sidebar";

captureLandText(); // before the loading screen goes away
import { currentMap, MAPS, type MapDef } from "./maps";
import { rollRecurringForward } from "./recurrence";
import { parseEventDate } from "./util";
import { attachSectors, createSectorSection } from "./sectors";
import { attachMoney, createMoneySection } from "./money";

// The splash in index.html shows a progress bar; these tell it how far along we really are.
type BootWindow = Window & { bootPhase?: (p: "build") => void; bootProgress?: (p: number, label?: string) => void; bootDetail?: (text: string) => void; bootDone?: () => void; bootHeld?: boolean; bootRelease?: () => void; bootDetailPendingMs?: () => number; bootAfterLines?: (cb: () => void, maxMs: number) => void };
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
  // Someone pressed "Keep this screen open": wait for their "Open the map".
  if (bootWin.bootHeld) {
    bootDetail("Everything is loaded. Open the map when you're ready.");
    bootWin.bootRelease = go;
    return;
  }
  // Otherwise let the last loading lines finish (they speed up now); the bar fills as they do, then the map opens.
  const open = () => (bootWin.bootHeld ? (bootWin.bootRelease = go) : go());
  if (bootWin.bootAfterLines) bootWin.bootAfterLines(open, 1800);
  else setTimeout(open, 250);
}

async function main() {
  document.title = currentMap.fullTitle;
  const app = document.getElementById("app")!;
  clear(app);

  // Fetch data
  // The map's name at the top of the loading screen, and the welcome line while the data is on its way
  const bootTitle = document.querySelector<HTMLElement>("#boot .boot-title");
  if (bootTitle) bootTitle.textContent = currentMap.fullTitle;
  {
    const WELCOME = ["Inviting everyone to a seat at the table\u2026", "Making room for every voice\u2026"];
    let v = 0;
    try { v = Number(localStorage.getItem("openthink.visits")) || 0; } catch { /* private mode */ }
    bootDetail(WELCOME[v % WELCOME.length]);
  }
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

  bootWin.bootPhase?.("build"); // the bar's second stage follows the lines below
  // The loading lines Nathan picked (2026-10-05): what is loading, then true counts from the data.
  // Each line says what is loading, with its count running up on screen ("(1/25)" … "(25/25)", index.html)
  const n = (label: string, count: number) => `Loading ${label} (${count}/${count})`;
  bootDetail(n("coalitions", data.coalitions.length));
  bootDetail(n("groups", data.organizations.length));
  bootDetail(`Linking coalition memberships (${data.edges.length}/${data.edges.length})`);
  await attachThoughts(data);
  // Sector layers (Map settings → Social justice) that this browser has switched on.
  const sectorsOn = await attachSectors(data, currentMap.id);
  const moneyOnMap = await attachMoney(data, currentMap.id);
  // Recurring events carry one stored date; show their next occurrence.
  for (const n of [...data.coalitions, ...data.organizations]) if (n.events) rollRecurringForward(n.events);
  const groups = [...data.coalitions, ...data.organizations];
  for (const g of groups) g.logo = webLogo(g.logo); // small WebP copies (src/weblogos.ts)
  const bridges = data.organizations.filter((o) => (o.coalition_ids?.length || 0) > 1).length;
  const facts: string[] = [];
  if (bridges) facts.push(`Finding groups that work across coalitions (${bridges}/${bridges})`);
  // "Connecting N groups across N towns": each placed group goes to its nearest town centre (the map's states' town lists)
  if (currentMap.geo.length) {
    try {
      const lists = await Promise.all(currentMap.geo.map(async (p) => {
        const res = await fetch(`${import.meta.env.BASE_URL}geo/${p}-town-centroids.json`);
        return Object.entries((await res.json()) as Record<string, [number, number]>).map(([n, at]) => [`${p}:${n}`, at] as [string, [number, number]]);
      }));
      const centres = lists.flat();
      const towns = new Set<string>();
      let placed = 0;
      for (const o of data.organizations) {
        if (o.remote || !Number.isFinite(o.lat) || !Number.isFinite(o.lng) || atFallback(o.lat, o.lng)) continue;
        let best = "", bd = Infinity;
        for (const [name, [la, ln]] of centres) {
          const d = (la - o.lat) ** 2 + ((ln - o.lng) * 0.74) ** 2;
          if (d < bd) { bd = d; best = name; }
        }
        if (best && Math.sqrt(bd) < 0.08) { towns.add(best); placed++; } // within ~9 km of a town centre
      }
      if (towns.size > 1) facts.push(`Connecting ${placed} groups across towns (${towns.size}/${towns.size})`);
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
  if (week) facts.push(n("events this week", week));
  if (month) facts.push(n("events in the next 30 days", month));
  const projectsNow = groups.flatMap((g) => g.projects || []).filter((p) => (p.status || "active") === "active").length;
  if (projectsNow) facts.push(n("projects underway", projectsNow));
  const today = new Date().toISOString().slice(0, 10);
  const acts = groups.flatMap((g) => g.actions || []).filter((a) => !a.deadline || a.deadline >= today);
  const roles = acts.filter((a) => a.kind === "role").length;
  if (acts.length - roles) facts.push(n("actions you can take", acts.length - roles));
  if (roles) facts.push(n("volunteer opportunities", roles));
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
  // Note at the top of the map (Nathan, Oct 29). The × hides it for this visit; drag it anywhere out of the way.
  let noteHidden = false;
  try { noteHidden = sessionStorage.getItem("openthink.devnote") === "1"; } catch { /* ignore */ }
  if (!noteHidden) {
    const link = h("a", { href: FORMS.feedback.url, target: "_blank", rel: "noopener" }, "please let us know");
    const close = h("button", { type: "button", class: "dev-note-x", "aria-label": "Hide this note", title: "Hide this note" }, "\u00d7");
    const note = h("div", { class: "dev-note", role: "note", title: "Drag to move" },
      h("span", {}, "Note: this map is currently in development and uses data gathered from organization websites.  If you see any inaccuracies, ", link),
      close,
    );
    close.addEventListener("click", () => {
      note.remove();
      try { sessionStorage.setItem("openthink.devnote", "1"); } catch { /* ignore */ }
    });
    graphContainer.appendChild(note);
    // Drag the note (not its link or ×) anywhere inside the map; it stays where it is put for this visit.
    let drag: { id: number; dx: number; dy: number } | null = null;
    note.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("a, button") || e.button !== 0) return;
      const r = note.getBoundingClientRect();
      drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      note.setPointerCapture(e.pointerId);
      note.classList.add("dragging");
      e.preventDefault();
      e.stopPropagation();
    });
    note.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const box = graphContainer.getBoundingClientRect();
      const w = note.offsetWidth, hh = note.offsetHeight;
      const x = Math.min(Math.max(0, e.clientX - box.left - drag.dx), Math.max(0, box.width - w));
      const y = Math.min(Math.max(0, e.clientY - box.top - drag.dy), Math.max(0, box.height - hh));
      Object.assign(note.style, { left: `${x}px`, top: `${y}px`, right: "auto", width: `${w}px`, maxWidth: "none", transform: "none" });
    });
    const drop = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      note.classList.remove("dragging");
    };
    note.addEventListener("pointerup", drop);
    note.addEventListener("pointercancel", drop);
  }
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
    canLocateGeo: (node, item) => geoCanLocate(node, item as { lat?: number; lng?: number } | undefined),
    currentView: () => activeTab,
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
  const linkBox = graphApi.orgLinkToggle().querySelector("input");
  createMapLegend(graphContainer, sectorsOn, linkBox ? { box: linkBox, count: (data.org_links || []).length } : undefined, moneyOnMap);

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
  // While a group is open, its size sliders float on the map, open by default (Oct 29).
  graphContainer.appendChild(controls.focusPanel());
  // The org-to-org connections switch sits right under the coalitions list.
  sidebar.linksContainer().appendChild(graphApi.orgLinkToggle());
  // Money & opposition (maps with money data only), right under the connections switch.
  createMoneySection(sidebar.linksContainer(), currentMap.id);
  // Large print and Reduce motion (also in the top bar's Accessibility button).
  controls.advancedContainer().appendChild(displayControls());
  // Large print leaves out the Topics page; if it was showing, go back to the map.
  onDisplayChange(() => { if (largePrint() && activeTab === "topics") setTab("map"); });
  // "Social justice": one switch per sector layer, closed by default, just above Advanced display settings.
  createSectorSection(sidebar.controlsContainer(), currentMap.id);

  // The drawer is mounted inside the map view's graphContainer; we want
  // it to overlay other views too — re-parent it to content so it appears
  // above all views.
  if (drawerApi) {
    const drawerEl = graphContainer.querySelector(".drawer");
    if (drawerEl) content.appendChild(drawerEl);
  }

  // ----- The other pages: each loads the first time it's opened (or earlier, while nobody is using the page) -----
  const geoPage = lazyPage(content, "the geographic map", () => import("./geographic"), (m) => {
    const v = m.createGeographicView(data, {
      onNodeClick: (node) => {
        drawerApi!.open(node);
      },
      onItemClick: (_kind, id, at) => {
        const f = findItem(data, id);
        if (f) showItemCard(v.el, f.kind, f.item, f.owner, () => locateOnMap(f.owner.node), at);
      },
      onLocateMap: (node) => locateOnMap(node),
    });
    return v;
  });
  const eventsPage = lazyPage(content, "events", () => import("./events"), (m) =>
    m.createEventsView(data, { onCoalitionClick: (node) => openDetails(node) }));
  const orgsPage = lazyPage(content, "organizations", () => import("./orgs"), (m) =>
    m.createOrgsView(data, {
      onOrgClick: (node) => {
        drawerApi!.open(node);
        graphApi!.setSelectedNode(node);
      },
    }));
  const projectsPage = lazyPage(content, "projects", () => import("./projects"), (m) =>
    m.createProjectsView(data, { onCoalitionClick: (node) => openDetails(node) }));
  const actionsPage = lazyPage(content, "actions", () => import("./actions"), (m) =>
    m.createActionsView(data, { onCoalitionClick: (node) => openDetails(node) }));
  // Topics: streams of energy into topics; also loads public/topics*.json the first time it's shown.
  const topicsPage = lazyPage(content, "topics", () => import("./topics"), (m) => {
    const v = m.createTopicsView({
      hasGroup: (id) => data.coalitions.some((c) => c.id === id) || data.organizations.some((o) => o.id === id),
      logoOf: (id) => (data.coalitions.find((c) => c.id === id) ?? data.organizations.find((o) => o.id === id))?.logo || undefined,
      hasItem: (rid) => !!findItem(data, rid.slice(rid.indexOf(":") + 1)),
      openItem: (rid, at) => {
        const f = findItem(data, rid.slice(rid.indexOf(":") + 1));
        if (f) showItemCard(v.el, f.kind, f.item, f.owner, () => openGroup(f.owner.node.id), at);
      },
      onGroupClick: (id) => openGroup(id),
      data: () => data,
    });
    return v;
  });
  const pages = { geo: geoPage, events: eventsPage, orgs: orgsPage, projects: projectsPage, actions: actionsPage, topics: topicsPage } as const;
  function openGroup(id: string): boolean {
    const c = data.coalitions.find((x) => x.id === id);
    const o = data.organizations.find((x) => x.id === id);
    const node: GraphNode | null = c ? { ...c, kind: "coalition" } : o ? { ...o, kind: "org" } : null;
    if (!node) return false;
    openDetails(node);
    return true;
  }

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
    void geoPage.get().then((v) => v.locate(node, it ? { kind: it.kind, id: it.item.id, lat: pt?.lat, lng: pt?.lng } : undefined));
    if (it) drawerApi!.openItem(it.kind, it.item, node);
    else drawerApi!.open(node);
  }
  setCardActions({
    details: (kind, item, owner) => drawerApi!.openItem(kind, item, owner.node),
    locateMap: (kind, item, owner) => locateOnMap(owner.node, { kind, item }),
    locateGeo: (kind, item, owner) => locateOnGeo(owner.node, { kind, item }),
    hasGeo: (_kind, item, owner) => geoCanLocate(owner.node, item as { lat?: number; lng?: number }),
  });

  // The browser's Back button goes to the tab you were on before, instead of leaving the site (Oct 24): each tab
  // change adds a history entry (#topics, #events…; the map has no hash), and Back/Forward switch tabs.
  const TAB_IDS: TopTab[] = ["map", "geo", "orgs", "events", "projects", "actions", "topics"];
  const tabFromHash = (): TopTab => {
    const h = location.hash.replace(/^#/, "") as TopTab;
    return TAB_IDS.includes(h) ? h : "map";
  };
  const urlFor = (tab: TopTab) => `${location.pathname}${location.search}${tab === "map" ? "" : `#${tab}`}`;
  const startTab = tabFromHash(); // a link like …/#events opens that tab
  try { history.replaceState({ tab: startTab }, "", urlFor(startTab)); } catch { /* ignore */ }
  window.addEventListener("popstate", (e) => {
    const t = ((e.state as { tab?: TopTab } | null)?.tab) ?? tabFromHash();
    if (t !== activeTab) setTab(t, false);
  });

  function setTab(tab: TopTab, remember = true) {
    if (remember && tab !== activeTab) {
      try { history.pushState({ tab }, "", urlFor(tab)); } catch { /* ignore */ }
    }
    activeTab = tab;
    topbar.setActive(tab);
    mapView.style.display = tab === "map" ? "grid" : "none";
    for (const [id, p] of Object.entries(pages)) p.holder.style.display = tab === id ? "block" : "none";
    if (tab === "topics") void topicsPage.get().then((v) => { if (activeTab === "topics") v.show(); });
    if (tab === "geo") void geoPage.get().then((v) => { if (activeTab === "geo") v.invalidate(); });
    if (tab !== "map" && tab in pages) void pages[tab as keyof typeof pages].get();
    drawerApi?.refresh(); // its "Locate on …" buttons depend on the page
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
  setPrefillData(data);
  setQuickFormData(data);
  setItemLabelData([...data.coalitions, ...data.organizations]);
  // Sector groups aren't in the Google Sheet yet, so the forms aren't pre-filled with them.
  createFab(content, () => {
    const cur = drawerApi?.current() ?? null;
    return cur && (cur as { sector?: string }).sector ? null : cur;
  });

  // Give the logos a moment so the map doesn't open on empty circles (they keep loading after that anyway).
  await Promise.race([logosReady, new Promise((r) => setTimeout(r, 1500))]);
  if (startTab !== "map" && !(startTab === "topics" && largePrint())) setTab(startTab, false);
  // Once the map is up and nobody is using the page for a moment, fetch the other pages in the background.
  preloadWhenQuiet([geoPage, eventsPage, orgsPage, projectsPage, actionsPage, topicsPage], 4000);

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
let lastErrBg: unknown = null;
/**
 * The live sheet had something newer than what is shown, but arrived after the map was up (Oct 27: no more "The map
 * has new updates · Show them" note). If nobody has touched the page yet, reload quietly (the small quick-start card,
 * from the copy just saved); otherwise the newer data is already saved and shows on the next visit or reload.
 */
let touched = false;
for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, () => { touched = true; }, { once: true, capture: true, passive: true });
function applyLateUpdate() {
  if (touched || document.visibilityState !== "visible") return;
  try { sessionStorage.setItem("openthink.quickboot", "1"); } catch { /* ignore */ }
  location.reload();
}

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
  const get = async (url: string, ms: number, quiet = false) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const d = JSON.parse(quiet ? await res.text() : await readWithProgress(res)) as DataFile;
      if (!Array.isArray(d.coalitions) || !Array.isArray(d.organizations)) throw new Error("bad data");
      return checkSources(d);
    } finally {
      clearTimeout(timer);
    }
  };
  // Faster start (the live sheet takes ~4 s to answer): fetch the live sheet, and while the loading screen is up give
  // it a few seconds. If it isn't back by then, show the copy saved on this device (or, on a first visit, the
  // nightly snapshot), and bring in the newer data by itself when it arrives (applyLateUpdate).
  const liveUrl = map.sources.find((u) => /script\.google/.test(u));
  if (liveUrl) {
    const key = `openthink.data.v1.${map.id}`;
    const strip = (d: DataFile) => JSON.stringify({ ...d, generated_at: "" });
    let cached: DataFile | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const c = JSON.parse(raw) as { at: number; data: DataFile };
        if (Date.now() - c.at < 7 * 86400000 && Array.isArray(c.data?.organizations)) cached = checkSources(c.data);
      }
    } catch { /* private mode or a full store: no saved copy */ }
    const live = get(liveUrl, 20000, !!cached).then((d) => {
      try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: d })); } catch { /* full */ }
      return d;
    });
    // Wait a little for the live sheet even with a saved copy, so the newest data shows straight away most of the time.
    const inTime = await Promise.race([live, new Promise<null>((r) => setTimeout(() => r(null), cached ? 3000 : 2500))]).catch(() => null);
    if (inTime) return inTime;
    let first: DataFile | null = cached;
    if (!first) {
      for (const u of map.sources.filter((x) => x !== liveUrl)) {
        try { first = await get(u, 8000); break; } catch (err) { lastErrBg = err; }
      }
      if (!first) return live; // nothing else to show: wait for the sheet after all
    }
    const shownKey = strip(first);
    live.then((d) => { if (strip(d) !== shownKey) applyLateUpdate(); }).catch(() => { /* offline: keep what is shown */ });
    return first;
  }
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
