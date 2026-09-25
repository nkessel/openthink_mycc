import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DataFile, GraphNode } from "./types";
import { h } from "./dom";
import { initials, typeLabel } from "./util";
import { allEvents, allProjects, type Owner } from "./owners";
import { createNodeSearch, everythingForSearch, findPlaces, type SearchItem } from "./search";

export interface GeographicView {
  el: HTMLElement;
  invalidate(): void;
}

export interface GeoCallbacks {
  onNodeClick(node: GraphNode): void;
}

type LayerKey = "coalitions" | "orgs" | "events" | "projects";

const MA_BOUNDS: L.LatLngBoundsExpression = [
  [41.45, -73.55],
  [42.95, -69.85],
];

export function createGeographicView(data: DataFile, cb: GeoCallbacks): GeographicView {
  const wrap = h("div", { class: "geo-wrap" });
  const mapEl = h("div", { class: "geo-map" });
  wrap.appendChild(mapEl);

  const events = allEvents(data).filter(({ event: e }) => !e.online && e.lat !== undefined && e.lng !== undefined);
  const projects = allProjects(data).filter(({ project: p }) => !p.online && p.lat !== undefined && p.lng !== undefined);
  const pinnedOrgs = data.organizations.filter((o) => !o.remote && Number.isFinite(o.lat) && Number.isFinite(o.lng));
  const remoteCount = data.organizations.length - pinnedOrgs.length;

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
    { key: "coalitions", label: `Coalitions (${data.coalitions.length})`, swatch: "background:#34d399;border-radius:50%" },
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
  if (remoteCount) layers.appendChild(h("div", { class: "geo-note" }, `${remoteCount} remote organization${remoteCount === 1 ? "" : "s"} not pinned.`));
  const pinless = allEvents(data).length + allProjects(data).length - events.length - projects.length;
  if (pinless) layers.appendChild(h("div", { class: "geo-note" }, `${pinless} online or unlocated events/projects are in the lists.`));
  panel.appendChild(layers);

  const nearBtn = h("button", { class: "geo-near", type: "button" }, "◎ What's near me?");
  panel.appendChild(nearBtn);
  const nearList = h("div", { class: "geo-near-list" });
  panel.appendChild(nearList);

  let map: L.Map | null = null;
  const groups: Record<LayerKey, L.LayerGroup> = {
    coalitions: L.layerGroup(), orgs: L.layerGroup(), events: L.layerGroup(), projects: L.layerGroup(),
  };
  const orgMarkers = new Map<string, L.CircleMarker>();
  const pinMarkers = new Map<string, L.Marker>();
  let highlight: L.Layer | null = null;

  function setLayer(key: LayerKey, value: boolean) {
    on[key] = value;
    boxes.get(key)!.checked = value;
    if (!map) return;
    if (value) groups[key].addTo(map);
    else groups[key].remove();
  }

  function ownerLine(owner: Owner): string {
    return `${escapeHTML(owner.name)}`;
  }

  function pinIcon(cls: string, glyph: string): L.DivIcon {
    return L.divIcon({ className: "", iconSize: [18, 18], iconAnchor: [9, 9], html: `<div class="geo-pin ${cls}">${glyph}</div>` });
  }

  function ensureMap() {
    if (map) return map;
    map = L.map(mapEl, { zoomControl: true, attributionControl: true });
    map.fitBounds(MA_BOUNDS, { padding: [20, 20] });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    // Coalitions (large colored circles with abbrev label)
    for (const c of data.coalitions) {
      const r = 14 + Math.sqrt(c.member_count) * 2.5;
      const labelNode = document.createElement("div");
      labelNode.className = "geo-coalition-label";
      labelNode.style.background = c.color;
      labelNode.style.width = `${r * 2}px`;
      labelNode.style.height = `${r * 2}px`;
      labelNode.style.lineHeight = `${r * 2}px`;
      labelNode.textContent = c.abbrev || initials(c.name);
      const marker = L.marker([c.lat, c.lng], {
        icon: L.divIcon({ className: "", iconSize: [r * 2, r * 2], iconAnchor: [r, r], html: labelNode.outerHTML }),
      });
      marker.bindTooltip(
        `<strong>${escapeHTML(c.name)}</strong><br/><span style="color:#94a3b8">${c.member_count} members · ${escapeHTML(c.geographic_scope)}</span>`,
        { direction: "top", offset: [0, -2] },
      );
      marker.on("click", () => cb.onNodeClick({ ...c, kind: "coalition" }));
      marker.addTo(groups.coalitions);
    }

    // Organizations (HQ pins; remote orgs are skipped)
    for (const o of pinnedOrgs) {
      const dot = L.circleMarker([o.lat, o.lng], {
        radius: 4, color: "#94a3b8", weight: 1, opacity: 0.8, fillColor: "#2a2a36", fillOpacity: 0.95,
      });
      const approx = o.profile?.geo_precision === "approx" ? " · approximate location" : "";
      dot.bindTooltip(
        `<strong>${escapeHTML(o.name)}</strong><br/><span style="color:#94a3b8">${escapeHTML([typeLabel(o.type), o.geographic_focus].filter(Boolean).join(" · "))}${approx}</span>`,
        { direction: "top", offset: [0, -2] },
      );
      dot.on("click", () => cb.onNodeClick({ ...o, kind: "org" }));
      dot.addTo(groups.orgs);
      orgMarkers.set(o.id, dot);
    }

    // Events + projects (only those with an in-person location)
    for (const { event: e, owner } of events) {
      const m = L.marker([e.lat!, e.lng!], { icon: pinIcon("event", "●") });
      m.bindTooltip(
        `<strong>${escapeHTML(e.name)}</strong><br/><span style="color:#94a3b8">${escapeHTML(e.date.slice(0, 10))} · ${escapeHTML(e.location || "")}<br/>${ownerLine(owner)}</span>`,
        { direction: "top", offset: [0, -6] },
      );
      m.on("click", () => cb.onNodeClick(owner.node));
      m.addTo(groups.events);
      pinMarkers.set(`event:${e.id}`, m);
    }
    for (const { project: p, owner } of projects) {
      const m = L.marker([p.lat!, p.lng!], { icon: pinIcon("project", "◆") });
      m.bindTooltip(
        `<strong>${escapeHTML(p.name)}</strong><br/><span style="color:#94a3b8">${escapeHTML(p.status)} · ${escapeHTML(p.location || "")}<br/>${ownerLine(owner)}</span>`,
        { direction: "top", offset: [0, -6] },
      );
      m.on("click", () => cb.onNodeClick(owner.node));
      m.addTo(groups.projects);
      pinMarkers.set(`project:${p.id}`, m);
    }

    (Object.keys(groups) as LayerKey[]).forEach((k) => on[k] && groups[k].addTo(map!));
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
      pts.push(L.latLng(c.lat, c.lng));
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
      if (item.lat === undefined) return; // remote: details only
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
