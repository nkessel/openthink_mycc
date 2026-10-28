// Sector layers: groups and events outside the climate coalitions (social justice movements and others).
// They live in their own Google Sheet, apart from the climate sheet (Oct 23 meeting), served by the same web app
// at ?feed=social-justice, with a copy of each sector in public/sectors/ as the fallback.
//
// Nothing here costs the main map anything: the data is only fetched when someone has switched a sector on, and
// the "Social justice" section of Map settings only appears for people who opened the map with the secret link
// (?sj), so the main map stays uncluttered and about climate. Sector records carry no edit links (no forms yet).
import type { DataFile } from "./types";
import type { MapId } from "./maps";
import { LIVE_DATA_URL } from "./data.config";

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
  /** Its row on the social justice sheet's Coalitions tab (the sector's own "coalition" bubble). */
  coalitionId: string;
}

export const SECTORS: SectorDef[] = [
  {
    id: "palestinian-rights",
    label: "Palestinian rights",
    toggleLabel: "Show Palestinian rights groups and events",
    path: "sectors/palestinian-rights.json",
    coalitionId: "sector_palestinian_rights",
    color: "#a16207",
    maps: ["ma", "us"],
  },
  {
    id: "immigrant-rights",
    label: "Immigrant rights",
    toggleLabel: "Show immigrant rights groups and events",
    path: "sectors/immigrant-rights.json",
    coalitionId: "sector_immigrant_rights",
    color: "#0e7490",
    maps: ["ma", "us"],
  },
  {
    id: "jewish-spiritual-life",
    label: "Jewish spiritual life",
    toggleLabel: "Show Jewish spiritual and ritual gatherings",
    path: "sectors/jewish-spiritual-life.json",
    coalitionId: "sector_jewish_spiritual_life",
    color: "#6d28d9",
    maps: ["ma", "us"],
  },
  {
    id: "movement-skills",
    label: "Movement skills & culture",
    toggleLabel: "Show organizer trainings and movement culture",
    path: "sectors/movement-skills.json",
    coalitionId: "sector_movement_skills",
    color: "#be185d",
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

/** The social justice sheet's feed (the climate sheet's web app, ?feed=social-justice). */
const SJ_FEED_URL = LIVE_DATA_URL ? `${LIVE_DATA_URL}${LIVE_DATA_URL.includes("?") ? "&" : "?"}feed=social-justice` : "";

/** The live social justice sheet, split into one DataFile per sector (by its Coalitions row). Null if unreachable. */
async function liveSectors(list: SectorDef[]): Promise<Map<string, DataFile> | null> {
  if (!SJ_FEED_URL) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000); // slow → use the copies in the repo instead
    const res = await fetch(SJ_FEED_URL, { signal: ctl.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const d = (await res.json()) as DataFile & { unlinked?: boolean };
    if (d.unlinked || !Array.isArray(d.coalitions) || !d.coalitions.length) return null;
    const out = new Map<string, DataFile>();
    for (const s of list) {
      const coalitions = d.coalitions.filter((c) => c.id === s.coalitionId);
      if (!coalitions.length) continue; // not on the sheet yet: the repo copy fills in below
      const organizations = d.organizations.filter((o) => o.coalition_ids.includes(s.coalitionId));
      const ids = new Set(organizations.map((o) => o.id));
      const edges = d.edges.filter((e) => e.source === s.coalitionId && ids.has(String(e.target)));
      out.set(s.id, { ...d, coalitions, organizations, edges, org_links: [] } as DataFile);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Merge the switched-on sectors into the map data. Every group and item gets `sector` set, so the views can
 * mark them and leave out the edit links. A sector that fails to load is skipped (the map still works).
 * Nothing is fetched unless a sector is switched on.
 */
export async function attachSectors(data: DataFile, map: MapId): Promise<SectorDef[]> {
  const list = activeSectors(map);
  if (!list.length) return [];
  const loaded: SectorDef[] = [];
  const ids = new Set([...data.coalitions, ...data.organizations].map((n) => n.id));
  const live = await liveSectors(list);
  for (const s of list) {
    try {
      let d = live?.get(s.id);
      if (!d) {
        const res = await fetch(`${import.meta.env.BASE_URL}${s.path}`);
        if (!res.ok) throw new Error(String(res.status));
        d = (await res.json()) as DataFile;
      }
      const mark = <T extends object>(x: T) => Object.assign(x, { sector: s.id });
      for (const c of d.coalitions || []) {
        if (ids.has(c.id)) continue;
        mark(c);
        for (const it of [...(c.events || []), ...(c.projects || []), ...(c.actions || [])]) mark(it);
        data.coalitions.push(c);
        ids.add(c.id);
      }
      for (const o of d.organizations || []) {
        if (ids.has(o.id)) continue; // a group in two sectors joins the first one switched on
        mark(o);
        for (const it of [...(o.events || []), ...(o.projects || []), ...(o.actions || [])]) mark(it);
        data.organizations.push(o);
        ids.add(o.id);
      }
      data.edges.push(...(d.edges || []));
      loaded.push(s);
    } catch (err) {
      console.warn(`Sector "${s.label}" could not be loaded:`, err);
    }
  }
  return loaded;
}

// ---- The secret link: the Social justice settings only show for people who opened the map with ?sj ----
const UNLOCK_KEY = "openthink.sj";
/**
 * True when this browser may see the Social justice settings: opened with ?sj (remembered from then on), or a
 * sector is already switched on. ?sj=off hides the settings again on this browser (and switches the sectors off).
 */
export function socialJusticeUnlocked(): boolean {
  const q = new URLSearchParams(location.search);
  try {
    if (q.has("sj")) {
      if (/^(off|0|no|hide)$/i.test(q.get("sj") || "")) {
        localStorage.removeItem(UNLOCK_KEY);
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      localStorage.setItem(UNLOCK_KEY, "1");
      return true;
    }
    return localStorage.getItem(UNLOCK_KEY) === "1" || enabledSectors().size > 0;
  } catch {
    return q.has("sj"); // storage blocked: only while the link is in the address bar
  }
}

/** Switch every sector off, forget the secret link on this browser, and reload. */
function lockAgain() {
  try {
    localStorage.removeItem(UNLOCK_KEY);
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  const u = new URL(location.href);
  u.searchParams.delete("sj");
  location.replace(u.toString());
}

const REOPEN_KEY = "openthink.sectors.reopen";
/** Reload with a small "Adding…" card instead of the full loading screen, and reopen this section afterwards. */
function reloadQuick() {
  try {
    sessionStorage.setItem(REOPEN_KEY, "1");
    sessionStorage.setItem("openthink.quickboot", "1");
  } catch {
    /* ignore */
  }
  location.reload();
}

/**
 * The "Social justice" section of Map settings: closed by default (like Advanced display settings), one switch
 * per sector. Switching reloads the page so every view (map, lists, calendar, search, legend) is rebuilt with or
 * without the sector; the section reopens after the reload so the switch stays in view.
 */
export function createSectorSection(parent: HTMLElement, map: MapId): HTMLElement | null {
  if (!socialJusticeUnlocked()) return null; // the main map: no Social justice settings at all
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
  hint.textContent = "Groups and events from other movements, shown on top of the climate map with their own colour. Off by default, and only loaded once switched on.";
  body.appendChild(hint);
  const on = enabledSectors();
  const avail = SECTORS.filter((s) => s.maps.includes(map));
  if (avail.length > 1) {
    const allOn = avail.every((s) => on.has(s.id));
    const row = document.createElement("div");
    row.className = "control toggle-row sector-all";
    const label = document.createElement("label");
    label.className = "ctrl-label";
    label.textContent = "All social justice groups";
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = `switch ${allOn ? "on" : ""}`;
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(allOn));
    sw.setAttribute("aria-label", "All social justice groups");
    sw.innerHTML = '<span class="knob"></span>';
    sw.addEventListener("click", () => {
      for (const s of avail) setSectorEnabled(s.id, !allOn);
      reloadQuick();
    });
    row.append(label, sw);
    body.appendChild(row);
  }
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
      reloadQuick();
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
  const hideBtn = document.createElement("button");
  hideBtn.type = "button";
  hideBtn.className = "sector-lock";
  hideBtn.textContent = "Hide these settings on this browser";
  hideBtn.title = "Switches the social justice layers off and removes this section until the map is opened with the ?sj link again";
  hideBtn.addEventListener("click", lockAgain);
  body.appendChild(hideBtn);
  section.append(head, body);
  const adv = parent.querySelector(":scope > .panel-section.advanced");
  parent.insertBefore(section, adv);
  return section;
}
