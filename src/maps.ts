// Which map is showing: Massachusetts (the original, edited through the Google Sheet + forms), another
// state researched from public pages, or the USA view that combines every state we have.
// Picked with ?map=<id> in the URL (so a link opens the right map); the plain link is always Massachusetts.
import { LIVE_DATA_URL, SNAPSHOT_URL } from "./data.config";

export type MapId = "ma" | "vt" | "nh" | "me" | "us";

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
  /** Town outlines, zip codes and town names exist for this map (geo/ma-*.json). */
  maGeo: boolean;
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
    maGeo: true,
  },
  vt: {
    id: "vt",
    name: "Vermont",
    title: "VT Climate Map",
    fullTitle: "Vermont Climate Coalition Map",
    sources: [`${base}maps/vt.json`],
    editable: false,
    maGeo: false,
  },
  nh: {
    id: "nh",
    name: "New Hampshire",
    title: "NH Climate Map",
    fullTitle: "New Hampshire Climate Coalition Map",
    sources: [`${base}maps/nh.json`],
    editable: false,
    maGeo: false,
  },
  me: {
    id: "me",
    name: "Maine",
    title: "ME Climate Map",
    fullTitle: "Maine Climate Coalition Map",
    sources: [`${base}maps/me.json`],
    editable: false,
    maGeo: false,
  },
  us: {
    id: "us",
    name: "USA",
    title: "US Climate Map",
    fullTitle: "US Climate Coalition Map (states mapped so far)",
    sources: [],
    combine: ["ma", "vt", "nh", "me"],
    editable: false,
    maGeo: true,
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
