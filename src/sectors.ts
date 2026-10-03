// Sector layers: groups and events outside the climate coalitions (social justice movements and others),
// each kept in its own file under public/sectors/ and shown only when someone switches it on in
// Map settings → "Social justice". Off by default; the choice is remembered in this browser.
// Sector data is not edited through the Google Sheet yet, so sector records carry no edit links.
import type { DataFile } from "./types";
import type { MapId } from "./maps";

export interface SectorDef {
  id: string;
  /** Short name, e.g. in the legend and on cards. */
  label: string;
  /** Wording of the switch in Map settings. */
  toggleLabel: string;
  /** Data file (same schema as public/data.json), relative to the site root. */
  path: string;
  /** Ring / accent colour on the map, cards and calendar. Keep it muted. */
  color: string;
  /** Maps this sector appears on. */
  maps: MapId[];
}

export const SECTORS: SectorDef[] = [
  {
    id: "palestinian-rights",
    label: "Palestinian rights",
    toggleLabel: "Show Palestinian rights groups and events",
    path: "sectors/palestinian-rights.json",
    color: "#a16207",
    maps: ["ma", "us"],
  },
];

const STORAGE_KEY = "openthink.sectors.v1";

/** Ids of the sectors switched on in this browser. */
export function enabledSectors(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function setSectorEnabled(id: string, on: boolean): void {
  const s = enabledSectors();
  if (on) s.add(id);
  else s.delete(id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...s]));
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

export function sectorById(id: string | undefined): SectorDef | undefined {
  return id ? SECTORS.find((s) => s.id === id) : undefined;
}

/** Sectors that are switched on and belong on this map. */
export function activeSectors(map: MapId): SectorDef[] {
  const on = enabledSectors();
  return SECTORS.filter((s) => on.has(s.id) && s.maps.includes(map));
}

/**
 * Merge the switched-on sectors into the map data. Every group and item gets `sector` set, so the views can
 * mark them and leave out the edit links. A sector file that fails to load is skipped (the map still works).
 */
export async function attachSectors(data: DataFile, map: MapId): Promise<SectorDef[]> {
  const list = activeSectors(map);
  const loaded: SectorDef[] = [];
  const ids = new Set([...data.coalitions, ...data.organizations].map((n) => n.id));
  for (const s of list) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${s.path}`);
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as DataFile;
      const mark = <T extends object>(x: T) => Object.assign(x, { sector: s.id });
      for (const c of d.coalitions || []) {
        if (ids.has(c.id)) continue;
        mark(c);
        for (const it of [...(c.events || []), ...(c.projects || []), ...(c.actions || [])]) mark(it);
        data.coalitions.push(c);
      }
      for (const o of d.organizations || []) {
        if (ids.has(o.id)) continue;
        mark(o);
        for (const it of [...(o.events || []), ...(o.projects || []), ...(o.actions || [])]) mark(it);
        data.organizations.push(o);
      }
      data.edges.push(...(d.edges || []));
      loaded.push(s);
    } catch (err) {
      console.warn(`Sector "${s.label}" could not be loaded:`, err);
    }
  }
  return loaded;
}

const REOPEN_KEY = "openthink.sectors.reopen";

/**
 * The "Social justice" section of Map settings: closed by default (like Advanced display settings), one switch
 * per sector. Switching reloads the page so every view (map, lists, calendar, search, legend) is rebuilt with or
 * without the sector; the section reopens after the reload so the switch stays in view.
 */
export function createSectorSection(parent: HTMLElement, map: MapId): HTMLElement {
  let reopen = false;
  try {
    reopen = sessionStorage.getItem(REOPEN_KEY) === "1";
    sessionStorage.removeItem(REOPEN_KEY);
  } catch {
    /* ignore */
  }
  const section = document.createElement("section");
  section.className = `panel-section sector-section ${reopen ? "open" : ""}`;
  const head = document.createElement("button");
  head.type = "button";
  head.className = "section-head";
  head.innerHTML = '<span class="caret">▾</span><span class="section-title">Social justice</span>';
  head.addEventListener("click", () => section.classList.toggle("open"));
  const body = document.createElement("div");
  body.className = "section-body";
  const hint = document.createElement("div");
  hint.className = "ctrl-hint";
  hint.textContent = "Groups and events from other movements, shown on top of the climate map with their own colour. Off by default.";
  body.appendChild(hint);
  const on = enabledSectors();
  for (const s of SECTORS) {
    const available = s.maps.includes(map);
    const row = document.createElement("div");
    row.className = "control toggle-row";
    const label = document.createElement("label");
    label.className = "ctrl-label";
    label.textContent = s.toggleLabel;
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = `switch ${on.has(s.id) && available ? "on" : ""}`;
    sw.dataset.sector = s.id;
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(on.has(s.id) && available));
    sw.setAttribute("aria-label", s.toggleLabel);
    sw.style.setProperty("--sector", s.color);
    sw.innerHTML = '<span class="knob"></span>';
    if (!available) sw.disabled = true;
    sw.addEventListener("click", () => {
      const next = !sw.classList.contains("on");
      sw.classList.toggle("on", next);
      setSectorEnabled(s.id, next);
      try {
        sessionStorage.setItem(REOPEN_KEY, "1");
      } catch {
        /* ignore */
      }
      location.reload();
    });
    row.append(label, sw);
    body.appendChild(row);
    if (!available) {
      const note = document.createElement("div");
      note.className = "ctrl-hint";
      note.textContent = "Only on the Massachusetts and USA maps for now.";
      body.appendChild(note);
    }
  }
  section.append(head, body);
  const adv = parent.querySelector(":scope > .panel-section.advanced");
  parent.insertBefore(section, adv);
  return section;
}
