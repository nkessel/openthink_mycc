// Which map is showing: Massachusetts (the original, edited through the Google Sheet + forms), another
// state researched from public pages, or the USA view that combines every state we have.
// Picked with ?map=<id> in the URL (so a link opens the right map); the plain link is always Massachusetts.
import { LIVE_DATA_URL, SNAPSHOT_URL } from "./data.config";

export type MapId = "ma" | "vt" | "or" | "us";

export interface MapDef {
  id: MapId;
  /** Shown in the switcher. */
  name: string;
  /** Short title in the top bar. */
  title: string;
  /** Full name for the page title and tooltips. */
  fullTitle: string;
  /** Data sources, in order of preference (first that loads wins). Empty for a combined map. */
  sources: string[];
  /** Maps whose data is merged together (the USA view). */
  combine?: MapId[];
  /** True when there are forms + a sheet behind it; otherwise "edit" links go to the feedback form. */
  editable: boolean;
  /** States whose bundled geography this map uses (town/county outlines, zips, town names, districts): see geodata.ts. */
  geo: string[];
  /** Time zone of the map's events (calendar links). Combined maps use each group's own map (see timeZoneFor). */
  timeZone: string;
  /** Prefix of this map's group ids ("vt_"), so a combined map can tell which state a group came from. Massachusetts ids have none. */
  idPrefix?: string;
}

const base = import.meta.env.BASE_URL;

export const MAPS: Record<MapId, MapDef> = {
  ma: {
    id: "ma",
    name: "Massachusetts",
    title: "MA Climate Map",
    fullTitle: "MA Climate Coalition Map",
    sources: [LIVE_DATA_URL, SNAPSHOT_URL].filter(Boolean),
    editable: true,
    geo: ["ma"],
    timeZone: "America/New_York",
  },
  vt: {
    id: "vt",
    name: "Vermont",
    title: "VT Climate Map",
    fullTitle: "Vermont Climate Coalition Map",
    sources: [`${base}maps/vt.json`],
    editable: false,
    geo: [],
    timeZone: "America/New_York",
    idPrefix: "vt_",
  },
  or: {
    id: "or",
    name: "Oregon",
    title: "OR Climate Map",
    fullTitle: "Oregon Climate Coalition Map",
    sources: [`${base}maps/or.json`],
    editable: false,
    geo: ["or"],
    timeZone: "America/Los_Angeles",
    idPrefix: "or_",
  },
  us: {
    id: "us",
    name: "USA",
    title: "US Climate Map",
    fullTitle: "US Climate Coalition Map (states mapped so far)",
    sources: [],
    combine: ["ma", "vt", "or"],
    editable: false,
    geo: ["ma", "or"],
    timeZone: "America/New_York",
  },
};

function pick(): MapDef {
  const fromUrl = new URLSearchParams(location.search).get("map")?.toLowerCase();
  if (fromUrl && fromUrl in MAPS) return MAPS[fromUrl as MapId];
  return MAPS.ma;
}

/** The map this page is showing (decided once per page load). */
export const currentMap: MapDef = pick();

/** Reload the page on another map; the choice goes in the URL so it can be shared. */
export function switchMap(id: MapId): void {
  const url = new URL(location.href);
  if (id === "ma") url.searchParams.delete("map");
  else url.searchParams.set("map", id);
  url.hash = "";
  location.href = url.toString();
}

/** Time zone for a group's events: its own map's, found by id prefix on a combined map. */
export function timeZoneFor(groupId: string): string {
  if (!currentMap.combine) return currentMap.timeZone;
  for (const id of currentMap.combine) {
    const m = MAPS[id];
    if (m.idPrefix && groupId.startsWith(m.idPrefix)) return m.timeZone;
  }
  return MAPS.ma.timeZone;
}
