// Type-ahead search over coalitions, orgs, events and projects (used by the graph,
// the geographic map, and the Organizations list).
import type { DataFile } from "./types";
import { allEvents, allProjects } from "./owners";

export type SearchKind = "coalition" | "org" | "event" | "project" | "place";

export interface SearchItem {
  id: string;
  kind: SearchKind;
  label: string;
  sub: string;
  /** Extra words that should match (abbreviations, tags, locations). */
  keywords: string;
  lat?: number;
  lng?: number;
}

const KIND_LABEL: Record<SearchKind, string> = {
  coalition: "Coalition",
  org: "Organization",
  event: "Event",
  project: "Project",
  place: "Place",
};

export function allNodesForSearch(data: DataFile): SearchItem[] {
  return [
    ...data.coalitions.map((c) => ({
      id: c.id, kind: "coalition" as const, label: c.name, sub: `${c.abbrev} · ${c.member_count} members`,
      keywords: `${c.abbrev} ${c.focus_tags.join(" ")}`,
    })),
    ...data.organizations.map((o) => ({
      id: o.id, kind: "org" as const, label: o.name, sub: [o.abbrev, o.geographic_focus].filter(Boolean).join(" · "),
      keywords: `${o.abbrev || ""} ${(o.topic_tags || []).join(" ")} ${o.geographic_focus}`,
      lat: o.remote ? undefined : o.lat, lng: o.remote ? undefined : o.lng,
    })),
  ];
}

export function everythingForSearch(data: DataFile): SearchItem[] {
  return [
    ...allNodesForSearch(data),
    ...allEvents(data).map(({ event: e, owner }) => ({
      id: e.id, kind: "event" as const, label: e.name, sub: `${owner.abbrev} · ${e.date.slice(0, 10)} · ${e.location || ""}`,
      keywords: `${e.location || ""} ${owner.name}`, lat: e.online ? undefined : e.lat, lng: e.online ? undefined : e.lng,
    })),
    ...allProjects(data).map(({ project: p, owner }) => ({
      id: p.id, kind: "project" as const, label: p.name, sub: `${owner.abbrev} · ${p.status}`,
      keywords: `${p.location || ""} ${owner.name} ${p.skills_needed.join(" ")}`,
      lat: p.online ? undefined : p.lat, lng: p.online ? undefined : p.lng,
    })),
  ];
}

export function matchItems(items: SearchItem[], q: string, limit = 8): SearchItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { item: SearchItem; score: number }[] = [];
  for (const item of items) {
    const name = item.label.toLowerCase();
    const hay = `${name} ${item.sub.toLowerCase()} ${item.keywords.toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    const abbrev = item.keywords.toLowerCase().split(/\s+/)[0];
    if (abbrev && abbrev === q.toLowerCase()) score += 5; // "mycc" → the coalition first
    if (name.startsWith(q.toLowerCase())) score += 3;
    if (words.every((w) => name.includes(w))) score += 2;
    if (item.kind === "coalition") score += 0.5;
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, limit).map((s) => s.item);
}

export interface SearchOptions {
  placeholder?: string;
  /** Called with the typed text when nothing matches (e.g. to look up a place). */
  extra?: (q: string) => Promise<SearchItem[]>;
}

export function createNodeSearch(
  items: SearchItem[],
  onPick: (id: string, item: SearchItem) => void,
  opts: SearchOptions = {},
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "search-box";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = opts.placeholder || "Search organizations or coalitions…";
  input.setAttribute("aria-label", input.placeholder);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  const list = document.createElement("div");
  list.className = "search-results";
  list.setAttribute("role", "listbox");
  wrap.appendChild(input);
  wrap.appendChild(list);

  let results: SearchItem[] = [];
  let active = 0;
  let seq = 0;

  const close = () => {
    list.replaceChildren();
    list.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
  };
  const pick = (item: SearchItem) => {
    input.value = item.label;
    close();
    onPick(item.id, item);
  };
  const render = () => {
    list.replaceChildren();
    results.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = `search-result${i === active ? " active" : ""}`;
      row.setAttribute("role", "option");
      const name = document.createElement("span");
      name.className = "search-name";
      name.textContent = r.label;
      const sub = document.createElement("span");
      sub.className = "search-sub";
      sub.textContent = [KIND_LABEL[r.kind], r.sub].filter(Boolean).join(" · ");
      row.append(name, sub);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(r);
      });
      list.appendChild(row);
    });
    list.classList.toggle("open", results.length > 0);
    input.setAttribute("aria-expanded", String(results.length > 0));
  };
  const update = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    results = matchItems(items, q);
    active = 0;
    render();
    if (q.length >= 3 && opts.extra && results.length < 3) {
      const more = await opts.extra(q).catch(() => []);
      if (mine !== seq) return;
      results = [...results, ...more].slice(0, 8);
      render();
    }
  };

  let timer: number | undefined;
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, opts.extra ? 250 : 0);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(active + 1, results.length - 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
    else if (e.key === "Enter" && results[active]) { pick(results[active]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
  return wrap;
}

/** Look up a place in Massachusetts (OpenStreetMap Nominatim; no key needed, light use only). */
export async function findPlaces(q: string): Promise<SearchItem[]> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=4&countrycodes=us" +
    "&viewbox=-73.6,43.0,-69.8,41.2&bounded=1&q=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const rows = (await res.json()) as { place_id: number; display_name: string; lat: string; lon: string }[];
  return rows.map((r) => ({
    id: `place:${r.place_id}`, kind: "place" as const, label: r.display_name.split(",")[0],
    sub: r.display_name.split(",").slice(1, 3).join(",").trim(), keywords: "",
    lat: Number(r.lat), lng: Number(r.lon),
  }));
}
