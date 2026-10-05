import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Coalition, DataFile, GraphNode, Organization } from "./types";
import { currentMap } from "./maps";
import { h } from "./dom";
import { initials, typeLabel } from "./util";
import { allEvents, allProjects, type Owner } from "./owners";
import { loadTowns, placeFor, setMapBounds } from "./itemfilters";
import { createNodeSearch, everythingForSearch, findPlaces, type SearchItem } from "./search";

export interface GeographicView {
  el: HTMLElement;
  invalidate(): void;
  /** Show this group, or one of its events / projects, on the map (the only thing here that moves the view). */
  locate(node: GraphNode, item?: { kind: "event" | "project" | "action"; id: string; lat?: number; lng?: number }): void;
  /** Whether locate() has a place to go to. */
  canLocate(node: GraphNode, item?: { lat?: number; lng?: number }): boolean;
}

export interface GeoCallbacks {
  onNodeClick(node: GraphNode): void;
  /** An event or project pin was clicked at (x, y) on screen: show its card there. */
  onItemClick?(kind: "event" | "project", id: string, at: { x: number; y: number }): void;
  /** The "Locate on strategy map" button in a group's card. */
  onLocateMap?(node: GraphNode): void;
}

type LayerKey = "coalitions" | "orgs" | "events" | "projects";

const MA_BOUNDS: L.LatLngBoundsExpression = [
  [41.45, -73.55],
  [42.95, -69.85],
];

/** The point the data uses when it only knows "Massachusetts" (statewide, national, or no address yet). */
const atFallback = (lat: number, lng: number) => Math.abs(lat - 42.3601) < 1e-4 && Math.abs(lng + 71.0589) < 1e-4;
/** A real place for this group: not remote, and not the fallback point (unless the group really is in Boston). */
export function orgPlaced(o: Organization): boolean {
  if (o.remote || !Number.isFinite(o.lat) || !Number.isFinite(o.lng) || (o.lat === 0 && o.lng === 0)) return false;
  return !(o.profile?.geo_precision !== "exact" && atFallback(o.lat, o.lng) && !/\bboston\b/i.test(o.geographic_focus || ""));
}
/** Coalitions are placed by their members; statewide and national ones have no one place, so they aren't pinned. */
export function coalitionPlaced(c: Coalition): boolean {
  return c.member_count > 0 && !/statewide|national/i.test(c.geographic_scope || "") && !atFallback(c.lat, c.lng);
}

export function createGeographicView(data: DataFile, cb: GeoCallbacks): GeographicView {
  /** Massachusetts opens on the state; other maps open on wherever their groups are. */
  function startBounds(): L.LatLngBoundsExpression {
    if (currentMap.id === "ma") return MA_BOUNDS;
    const pts = [...data.coalitions, ...data.organizations]
      .filter((n) => !(n as { remote?: boolean }).remote && Number.isFinite(n.lat) && Number.isFinite(n.lng) && (n.lat !== 0 || n.lng !== 0))
      .map((n) => [n.lat, n.lng] as [number, number]);
    return pts.length ? L.latLngBounds(pts).pad(0.08) : MA_BOUNDS;
  }
  const wrap = h("div", { class: "geo-wrap" });
  const mapEl = h("div", { class: "geo-map" });
  wrap.appendChild(mapEl);

  const events = allEvents(data).filter(({ event: e }) => !e.online && e.lat !== undefined && e.lng !== undefined);
  const projects = allProjects(data).filter(({ project: p }) => !p.online && p.lat !== undefined && p.lng !== undefined);
  const pinnedOrgs = data.organizations.filter(orgPlaced);
  const remoteCount = data.organizations.length - pinnedOrgs.length;
  const pinnedCoalitions = data.coalitions.filter(coalitionPlaced);

  // Which layers are on. Events and projects start off.
  const on: Record<LayerKey, boolean> = { coalitions: true, orgs: true, events: false, projects: false };

  // ---- Panel: search, layer checkboxes, near me
  const panel = h("div", { class: "geo-panel" });
  wrap.appendChild(panel);
  panel.appendChild(
    createNodeSearch(everythingForSearch(data), (_id, item) => goTo(item), {
      placeholder: "Search a place, organization, coalition, event…",
      extra: findPlaces,
    }),
  );

  const layers = h("div", { class: "geo-layers" }, h("h3", {}, "Show on the map"));
  const layerDefs: { key: LayerKey; label: string; swatch: string }[] = [
    { key: "coalitions", label: `Coalitions (${pinnedCoalitions.length})`, swatch: "background:#34d399;border-radius:50%" },
    { key: "orgs", label: `Organizations (${pinnedOrgs.length})`, swatch: "background:#2a2a36;border:1px solid #fff;border-radius:50%" },
    { key: "events", label: `Events (${events.length})`, swatch: "background:#f472b6;border-radius:3px" },
    { key: "projects", label: `Projects (${projects.length})`, swatch: "background:#38bdf8;transform:rotate(45deg)" },
  ];
  const boxes = new Map<LayerKey, HTMLInputElement>();
  for (const d of layerDefs) {
    const box = h("input", { type: "checkbox" }) as HTMLInputElement;
    box.checked = on[d.key];
    box.addEventListener("change", () => setLayer(d.key, box.checked));
    boxes.set(d.key, box);
    layers.appendChild(
      h("label", { class: "geo-layer" }, box, h("span", { class: "swatch", style: `width:10px;height:10px;${d.swatch}` }), h("span", {}, d.label)),
    );
  }
  if (remoteCount) layers.appendChild(h("div", { class: "geo-note" }, `${remoteCount} organization${remoteCount === 1 ? "" : "s"} with no address on file (remote, statewide or national) ${remoteCount === 1 ? "isn't" : "aren't"} pinned.`));
  const unpinnedC = data.coalitions.length - pinnedCoalitions.length;
  if (unpinnedC) layers.appendChild(h("div", { class: "geo-note" }, `${unpinnedC} statewide or national coalition${unpinnedC === 1 ? "" : "s"} ${unpinnedC === 1 ? "isn't" : "aren't"} pinned; search for one to see its members.`));
  const pinless = allEvents(data).length + allProjects(data).length - events.length - projects.length;
  if (pinless) layers.appendChild(h("div", { class: "geo-note" }, `${pinless} online or unlocated events/projects are in the lists.`));
  panel.appendChild(layers);

  const nearBtn = h("button", { class: "geo-near", type: "button" }, "◎ What's near me?");
  panel.appendChild(nearBtn);
  const nearList = h("div", { class: "geo-near-list" });
  panel.appendChild(nearList);

  // Town / county outlines: click one to zoom to it.
  const boundsBox = h("div", { class: "geo-layers geo-bounds" }, h("h3", {}, "Boundaries"));
  const boundChoices: { id: "none" | "towns" | "counties"; label: string }[] = [
    { id: "none", label: "None" }, { id: "towns", label: "Towns" }, { id: "counties", label: "Counties" },
  ];
  const boundBtns = new Map<string, HTMLElement>();
  const boundRow = h("div", { class: "filters" });
  for (const b of boundChoices) {
    const btn = h("button", { class: `chip ${b.id === "none" ? "active" : ""}`, type: "button" }, b.label);
    btn.addEventListener("click", () => { setBoundary(b.id); });
    boundBtns.set(b.id, btn);
    boundRow.appendChild(btn);
  }
  boundsBox.appendChild(boundRow);
  boundsBox.appendChild(h("div", { class: "geo-note" }, "Voting districts aren't on the map yet."));
  // The town/county outlines are Massachusetts-only for now.
  if (currentMap.id === "ma" || currentMap.id === "us") panel.insertBefore(boundsBox, nearBtn);

  const inViewBtn = h("button", { class: "geo-near", type: "button" }, "Show list of events in view");
  panel.insertBefore(inViewBtn, nearBtn);

  let map: L.Map | null = null;
  const groups: Record<LayerKey, L.LayerGroup> = {
    coalitions: L.layerGroup(), orgs: L.layerGroup(), events: L.layerGroup(), projects: L.layerGroup(),
  };
  const orgMarkers = new Map<string, L.Marker>();
  const pinMarkers = new Map<string, L.Marker>();
  let highlight: L.Layer | null = null;

  function setLayer(key: LayerKey, value: boolean) {
    on[key] = value;
    boxes.get(key)!.checked = value;
    if (!map) return;
    if (value) groups[key].addTo(map);
    else groups[key].remove();
    if (key === "orgs") recluster();
  }

  let boundaryLayer: L.GeoJSON | null = null;
  const boundaryCache = new Map<string, unknown>();
  let boundarySeq = 0;
  async function setBoundary(kind: "none" | "towns" | "counties") {
    for (const [id, el] of boundBtns) el.classList.toggle("active", id === kind);
    const seq = ++boundarySeq;
    const m = ensureMap();
    boundaryLayer?.remove();
    boundaryLayer = null;
    if (kind === "none") return;
    let json = boundaryCache.get(kind);
    if (!json) {
      try {
        json = await (await fetch(`${import.meta.env.BASE_URL}geo/ma-${kind}.geojson`)).json();
        boundaryCache.set(kind, json);
      } catch (_) { return; }
    }
    if (seq !== boundarySeq) return; // a newer choice replaced this one
    const base: L.PathOptions = { color: "#94a3b8", weight: kind === "towns" ? 0.8 : 1.5, opacity: 0.7, fillColor: "#38bdf8", fillOpacity: 0.02 };
    boundaryLayer = L.geoJSON(json as GeoJSON.GeoJsonObject, {
      style: () => base,
      onEachFeature: (f, layer) => {
        const p = f.properties as { name?: string; county?: string };
        const name = kind === "towns" ? `${p.name}${p.county ? `, ${p.county} County` : ""}` : `${p.county} County`;
        layer.bindTooltip(escapeHTML(name), { sticky: true });
        layer.on("mouseover", () => (layer as L.Path).setStyle({ fillOpacity: 0.12, weight: 2 }));
        layer.on("mouseout", () => (layer as L.Path).setStyle(base));
        layer.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          m.fitBounds((layer as L.Polygon).getBounds(), { padding: [30, 30], maxZoom: 14 });
        });
      },
    }).addTo(m);
    boundaryLayer.bringToBack();
  }

  inViewBtn.addEventListener("click", async () => {
    const m = ensureMap();
    await loadTowns();
    const b = m.getBounds();
    // Events with no exact pin are placed at the town in their location (or their org's HQ), so the list isn't nearly empty.
    const rows = allEvents(data)
      .map(({ event: e, owner }) => ({ e, owner, at: placeFor(e, owner.node as { lat?: number; lng?: number; remote?: boolean; kind?: string }), exact: e.lat !== undefined }))
      .filter((r) => r.at.lat !== undefined && b.contains([r.at.lat!, r.at.lng!]))
      .sort((a, c) => a.e.date.localeCompare(c.e.date));
    nearList.replaceChildren(
      h("div", { class: "geo-near-head" }, `${rows.length} event${rows.length === 1 ? "" : "s"} in view (some placed by town)`),
      ...rows.slice(0, 40).map(({ e, owner, at }) => {
        const el = h("button", { class: "geo-near-row", type: "button" },
          h("span", { class: "n" }, e.name), h("span", { class: "k" }, `${e.date.slice(0, 10)} · ${e.location || owner.name}`));
        el.addEventListener("click", () => { m.setView([at.lat!, at.lng!], Math.max(m.getZoom(), 12)); cb.onNodeClick(owner.node); });
        return el;
      }),
    );
  });

  function ownerLine(owner: Owner): string {
    return `${escapeHTML(owner.name)}`;
  }

  function pinIcon(cls: string, glyph: string): L.DivIcon {
    return L.divIcon({ className: "", iconSize: [18, 18], iconAnchor: [9, 9], html: `<div class="geo-pin ${cls}">${glyph}</div>` });
  }

  /** Every organization is the same size: easy to see, a little bigger as you zoom in. */
  const orgRadiusAt = (zoom: number) => Math.max(9, Math.min(22, 6 + (zoom - 6) * 1.7));

  // ---- Groups that sit on top of each other: one shows, with a "+N" badge that fans the rest out around it ----
  const clusterLayer = L.layerGroup();
  const hidden = new Set<string>();
  let spread: { ids: string[]; lines: L.Layer[] } | null = null;
  function collapse() {
    if (!spread || !map) return;
    for (const id of spread.ids) {
      const o = pinnedOrgs.find((x) => x.id === id)!;
      orgMarkers.get(id)!.setLatLng([o.lat, o.lng]);
      if (hidden.has(id)) groups.orgs.removeLayer(orgMarkers.get(id)!);
    }
    for (const l of spread.lines) l.remove();
    spread = null;
  }
  function recluster() {
    if (!map) return;
    collapse();
    clusterLayer.clearLayers();
    for (const id of hidden) groups.orgs.addLayer(orgMarkers.get(id)!);
    hidden.clear();
    if (!on.orgs) return;
    const size = 2 * orgRadiusAt(map.getZoom()) + (map.getZoom() >= 10 ? 8 : 4);
    const view = map.getBounds().pad(0.2);
    const pts = pinnedOrgs.filter((o) => view.contains([o.lat, o.lng])).map((o) => ({ o, p: map!.latLngToContainerPoint([o.lat, o.lng]) }));
    // groups with logos and more coalitions stay on top
    pts.sort((a, b) => Number(!!b.o.logo) - Number(!!a.o.logo) || (b.o.coalition_ids?.length || 0) - (a.o.coalition_ids?.length || 0));
    const taken = new Set<string>();
    for (const a of pts) {
      if (taken.has(a.o.id)) continue;
      taken.add(a.o.id);
      const near = pts.filter((b) => !taken.has(b.o.id) && a.p.distanceTo(b.p) < size * 0.75);
      if (!near.length) continue;
      for (const b of near) {
        taken.add(b.o.id);
        hidden.add(b.o.id);
        groups.orgs.removeLayer(orgMarkers.get(b.o.id)!);
      }
      const ids = [a.o.id, ...near.map((b) => b.o.id)];
      const badge = L.marker([a.o.lat, a.o.lng], {
        icon: L.divIcon({ className: "geo-more-icon", iconSize: [0, 0], html: `<button type="button" class="geo-more" style="--off:${(size / 2).toFixed(0)}px" aria-label="${near.length} more groups here">+${near.length}</button>` }),
        zIndexOffset: 1000,
      });
      badge.bindTooltip(`${near.length + 1} groups here: ${escapeHTML(ids.map((id) => pinnedOrgs.find((o) => o.id === id)!.name).slice(0, 6).join(", "))}${ids.length > 6 ? "…" : ""}`, { direction: "top", offset: [size / 2, -size / 2] });
      badge.on("click", (ev: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(ev);
        fanOut(ids, a.p, size);
      });
      clusterLayer.addLayer(badge);
    }
  }
  /** Spread a stack of groups around where they are, with a thin line back to each one's real place. */
  function fanOut(ids: string[], at: L.Point, size: number) {
    if (!map) return;
    collapse();
    const n = ids.length;
    const r = Math.max(size * 1.2, (n * (size + 6)) / (2 * Math.PI));
    const lines: L.Layer[] = [];
    ids.forEach((id, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const ll = map!.containerPointToLatLng(L.point(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r));
      const m = orgMarkers.get(id)!;
      const o = pinnedOrgs.find((x) => x.id === id)!;
      lines.push(L.polyline([[o.lat, o.lng], ll], { color: "#94a3b8", weight: 1, opacity: 0.7, interactive: false }).addTo(map!));
      m.setLatLng(ll);
      groups.orgs.addLayer(m);
    });
    spread = { ids, lines };
  }

  /** A group was clicked: a small card beside it, and its full details in the pane. Neither moves the map. */
  function openGroupCard(n: Organization | Coalition, marker: L.Marker) {
    const isCoal = "member_ids" in n;
    const node: GraphNode = isCoal ? { ...(n as Coalition), kind: "coalition" } : { ...(n as Organization), kind: "org" };
    const count = (k: "events" | "projects" | "actions") => ((n as unknown as Record<string, unknown[] | undefined>)[k])?.length || 0;
    const coals = isCoal ? [] : data.coalitions.filter((c) => (n as Organization).coalition_ids?.includes(c.id)).map((c) => c.abbrev || c.name);
    const desc = n.description ? (n.description.length > 170 ? `${n.description.slice(0, 168)}…` : n.description) : "";
    const box = h("div", { class: "geo-card" },
      h("div", { class: "geo-card-head" },
        n.logo ? h("img", { src: n.logo, alt: "" }) : null,
        h("div", {}, h("div", { class: "geo-card-kind" }, isCoal ? `Coalition · ${(n as Coalition).member_count} member groups` : [typeLabel((n as Organization).type), (n as Organization).geographic_focus].filter(Boolean).join(" · ")),
          h("strong", {}, n.name))),
      desc ? h("p", {}, desc) : null,
      h("div", { class: "geo-card-meta" }, [count("events") && `${count("events")} events`, count("projects") && `${count("projects")} projects`, count("actions") && `${count("actions")} actions`].filter(Boolean).join(" · ")),
      coals.length ? h("div", { class: "geo-card-meta" }, `In ${coals.join(", ")}`) : null,
    );
    if (cb.onLocateMap) {
      const b = h("button", { type: "button", class: "geo-card-btn" }, "Locate on strategy map");
      b.addEventListener("click", () => cb.onLocateMap!(node));
      box.appendChild(b);
    }
    L.popup({ autoPan: false, closeButton: true, className: "geo-card-pop", offset: [0, -8], maxWidth: 300 }).setLatLng(marker.getLatLng()).setContent(box).openOn(map!);
    cb.onNodeClick(node);
  }

  function ensureMap() {
    if (map) return map;
    map = L.map(mapEl, { zoomControl: true, attributionControl: true });
    map.fitBounds(startBounds(), { padding: [20, 20] });
    // OpenStreetMap's own tiles need no API key (CARTO's now do). They're light, so CSS
    // (.geo-view .leaflet-tile-pane) darkens them to match the site.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // Coalitions (large colored circles with abbrev label)
    for (const c of pinnedCoalitions) {
      const r = 14 + Math.sqrt(c.member_count) * 2.5;
      const labelNode = document.createElement("div");
      labelNode.className = "geo-coalition-label";
      labelNode.style.background = c.color;
      labelNode.style.width = `${r * 2}px`;
      labelNode.style.height = `${r * 2}px`;
      labelNode.style.lineHeight = `${r * 2}px`;
      if (c.logo) {
        labelNode.classList.add("has-logo");
        const img = document.createElement("img");
        img.src = c.logo;
        img.alt = "";
        labelNode.appendChild(img);
      } else labelNode.textContent = c.abbrev || initials(c.name);
      const marker = L.marker([c.lat, c.lng], {
        icon: L.divIcon({ className: "", iconSize: [r * 2, r * 2], iconAnchor: [r, r], html: labelNode.outerHTML }),
      });
      marker.bindTooltip(
        `<strong>${escapeHTML(c.name)}</strong><br/><span style="color:#94a3b8">${c.member_count} member ${c.member_count === 1 ? "group" : "groups"} · ${escapeHTML(c.geographic_scope)}</span>`,
        { direction: "top", offset: [0, -2] },
      );
      marker.on("click", () => openGroupCard(c, marker));
      marker.addTo(groups.coalitions);
    }

    // Organizations (HQ pins; remote orgs are skipped)
    // groups show their logos; the size follows the zoom through a CSS variable
    const sizeOrgs = () => mapEl.style.setProperty("--geo-org", `${2 * orgRadiusAt(map!.getZoom()) + (map!.getZoom() >= 10 ? 8 : 4)}px`);
    sizeOrgs();
    for (const o of pinnedOrgs) {
      const inner = document.createElement("div");
      inner.className = `geo-org${o.logo ? " has-logo" : ""}`;
      if (o.logo) {
        const img = document.createElement("img");
        img.src = o.logo;
        img.alt = "";
        img.loading = "lazy";
        inner.appendChild(img);
      }
      const dot = L.marker([o.lat, o.lng], { icon: L.divIcon({ className: "geo-org-icon", iconSize: [0, 0], html: inner.outerHTML }) });
      const approx = o.profile?.geo_precision === "approx" ? " · approximate location" : "";
      dot.bindTooltip(
        `<strong>${escapeHTML(o.name)}</strong><br/><span style="color:#94a3b8">${escapeHTML([typeLabel(o.type), o.geographic_focus].filter(Boolean).join(" · "))}${approx}</span>`,
        { direction: "top", offset: [0, -2] },
      );
      dot.on("click", () => openGroupCard(o, dot));
      dot.addTo(groups.orgs);
      orgMarkers.set(o.id, dot);
    }

    map.on("zoomend", sizeOrgs);
    map.on("zoomend moveend", () => recluster());
    map.on("click zoomstart", () => collapse());
    clusterLayer.addTo(map);
    const publishBounds = () => { const b = map!.getBounds(); setMapBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }); };
    map.on("moveend", publishBounds);
    publishBounds();

    // Events + projects (only those with an in-person location)
    for (const { event: e, owner } of events) {
      const m = L.marker([e.lat!, e.lng!], { icon: pinIcon("event", "●") });
      m.bindTooltip(
        `<strong>${escapeHTML(e.name)}</strong><br/><span style="color:#94a3b8">${escapeHTML(e.date.slice(0, 10))} · ${escapeHTML(e.location || "")}<br/>${ownerLine(owner)}</span>`,
        { direction: "top", offset: [0, -6] },
      );
      m.on("click", (ev: L.LeafletMouseEvent) => (cb.onItemClick ? cb.onItemClick("event", e.id, { x: ev.originalEvent.clientX, y: ev.originalEvent.clientY }) : cb.onNodeClick(owner.node)));
      m.addTo(groups.events);
      pinMarkers.set(`event:${e.id}`, m);
    }
    for (const { project: p, owner } of projects) {
      const m = L.marker([p.lat!, p.lng!], { icon: pinIcon("project", "◆") });
      m.bindTooltip(
        `<strong>${escapeHTML(p.name)}</strong><br/><span style="color:#94a3b8">${escapeHTML(p.status)} · ${escapeHTML(p.location || "")}<br/>${ownerLine(owner)}</span>`,
        { direction: "top", offset: [0, -6] },
      );
      m.on("click", (ev: L.LeafletMouseEvent) => (cb.onItemClick ? cb.onItemClick("project", p.id, { x: ev.originalEvent.clientX, y: ev.originalEvent.clientY }) : cb.onNodeClick(owner.node)));
      m.addTo(groups.projects);
      pinMarkers.set(`project:${p.id}`, m);
    }

    (Object.keys(groups) as LayerKey[]).forEach((k) => on[k] && groups[k].addTo(map!));
    setTimeout(() => recluster(), 0);
    return map;
  }

  function mark(latlng: L.LatLngExpression, radiusM = 0) {
    const m = ensureMap();
    if (highlight) highlight.remove();
    highlight = radiusM
      ? L.circle(latlng, { radius: radiusM, color: "#fbbf24", weight: 1.5, fillOpacity: 0.06 })
      : L.circleMarker(latlng, { radius: 14, color: "#fbbf24", weight: 2, fill: false });
    highlight.addTo(m);
  }

  /** Center on a search result: place, org, coalition (its members), event or project. */
  function goTo(item: SearchItem) {
    const m = ensureMap();
    if (item.kind === "coalition") {
      const c = data.coalitions.find((x) => x.id === item.id)!;
      const pts = pinnedOrgs.filter((o) => o.coalition_ids.includes(c.id)).map((o) => L.latLng(o.lat, o.lng));
      if (coalitionPlaced(c) || !pts.length) pts.push(L.latLng(c.lat, c.lng));
      setLayer("coalitions", true);
      setLayer("orgs", true);
      m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 12 });
      if (highlight) highlight.remove();
      highlight = L.layerGroup(pts.map((p) => L.circleMarker(p, { radius: 8, color: c.color, weight: 2, fill: false }))).addTo(m);
      cb.onNodeClick({ ...c, kind: "coalition" });
      return;
    }
    if (item.kind === "org") {
      const o = data.organizations.find((x) => x.id === item.id)!;
      cb.onNodeClick({ ...o, kind: "org" });
      if (!orgPlaced(o)) return; // no address on file: details only
      setLayer("orgs", true);
      m.setView([o.lat, o.lng], 14);
      mark([o.lat, o.lng]);
      return;
    }
    if (item.kind === "event" || item.kind === "project") {
      if (item.lat === undefined || item.lng === undefined) return;
      setLayer(item.kind === "event" ? "events" : "projects", true);
      m.setView([item.lat, item.lng], 14);
      pinMarkers.get(`${item.kind}:${item.id}`)?.openTooltip();
      mark([item.lat, item.lng]);
      return;
    }
    // place
    if (item.lat !== undefined && item.lng !== undefined) {
      m.setView([item.lat, item.lng], 13);
      mark([item.lat, item.lng], 3000);
      showNearby(item.lat, item.lng, item.label);
    }
  }

  /** List what's within ~15 km of a point: orgs, and events/projects with locations. */
  function showNearby(lat: number, lng: number, label: string) {
    const here = L.latLng(lat, lng);
    const rows: { name: string; kind: string; km: number; onClick: () => void }[] = [];
    for (const o of pinnedOrgs) {
      const d = here.distanceTo([o.lat, o.lng]) / 1000;
      if (d <= 15) rows.push({ name: o.name, kind: "Organization", km: d, onClick: () => { cb.onNodeClick({ ...o, kind: "org" }); map!.setView([o.lat, o.lng], 14); } });
    }
    for (const { event: e, owner } of events) {
      const d = here.distanceTo([e.lat!, e.lng!]) / 1000;
      if (d <= 15) rows.push({ name: e.name, kind: `Event · ${e.date.slice(0, 10)}`, km: d, onClick: () => { setLayer("events", true); map!.setView([e.lat!, e.lng!], 14); cb.onNodeClick(owner.node); } });
    }
    for (const { project: p, owner } of projects) {
      const d = here.distanceTo([p.lat!, p.lng!]) / 1000;
      if (d <= 15) rows.push({ name: p.name, kind: "Project", km: d, onClick: () => { setLayer("projects", true); map!.setView([p.lat!, p.lng!], 14); cb.onNodeClick(owner.node); } });
    }
    rows.sort((a, b) => a.km - b.km);
    nearList.replaceChildren(
      h("div", { class: "geo-near-head" }, `${rows.length} within 15 km of ${label}`),
      ...rows.slice(0, 25).map((r) => {
        const el = h("button", { class: "geo-near-row", type: "button" },
          h("span", { class: "n" }, r.name), h("span", { class: "k" }, `${r.kind} · ${r.km.toFixed(1)} km`));
        el.addEventListener("click", r.onClick);
        return el;
      }),
    );
  }

  nearBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      nearList.replaceChildren(h("div", { class: "geo-near-head" }, "Your browser can't share its location. Try searching for your town instead."));
      return;
    }
    nearBtn.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        nearBtn.textContent = "◎ What's near me?";
        const { latitude, longitude } = pos.coords;
        ensureMap().setView([latitude, longitude], 12);
        mark([latitude, longitude], 15000);
        showNearby(latitude, longitude, "you");
      },
      () => {
        nearBtn.textContent = "◎ What's near me?";
        nearList.replaceChildren(h("div", { class: "geo-near-head" }, "Couldn't get your location. Try searching for your town instead."));
      },
      { timeout: 10000 },
    );
  });

  return {
    el: wrap,
    invalidate() {
      const m = ensureMap();
      setTimeout(() => m.invalidateSize(), 50);
    },
    canLocate(node, item) {
      if (item && item.lat !== undefined && item.lng !== undefined) return true;
      return node.kind === "coalition" ? true : orgPlaced(node as Organization);
    },
    locate(node, item) {
      const m = ensureMap();
      setTimeout(() => {
        m.invalidateSize();
        if (item && item.lat !== undefined && item.lng !== undefined && item.kind !== "action") {
          setLayer(item.kind === "event" ? "events" : "projects", true);
          m.setView([item.lat, item.lng], 14);
          pinMarkers.get(`${item.kind}:${item.id}`)?.openTooltip();
          mark([item.lat, item.lng]);
          return;
        }
        goTo({ kind: node.kind === "coalition" ? "coalition" : "org", id: node.id, label: node.name } as SearchItem);
      }, 80);
    },
  };
}

// Leaflet tooltips accept HTML; we escape user-controllable strings.
function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
