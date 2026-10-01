// Shared filters for the Events and Projects pages: merged comma-separated search, zip code + miles,
// online/remote, "in view on the geographic map", free food, public vs affiliated-only, help wanted.
import { currentMap } from "./maps";
import { h } from "./dom";

export interface Facts {
  /** Everything a search should look in: name, description, location, owner, topics. */
  hay: string;
  lat?: number;
  lng?: number;
  online?: boolean;
  free_food?: boolean;
  affiliated_only?: boolean;
  help_wanted?: boolean;
}

/** "solar, boston" = both words somewhere in the item; "tree planting" = both words. Case-insensitive. */
export function termsMatch(query: string, hay: string): boolean {
  const h2 = hay.toLowerCase();
  return query
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .every((term) => term.split(/\s+/).every((w) => h2.includes(w)));
}

// ---- Geographic map view, shared by the Geographic tab ----
export interface Bounds { south: number; west: number; north: number; east: number }
let mapBounds: Bounds = { south: 41.45, west: -73.55, north: 42.95, east: -69.85 };
export function setMapBounds(b: Bounds): void {
  mapBounds = b;
  window.dispatchEvent(new CustomEvent("openthink:mapbounds"));
}
const inBounds = (lat: number, lng: number) => lat >= mapBounds.south && lat <= mapBounds.north && lng >= mapBounds.west && lng <= mapBounds.east;

// ---- Zip codes (Massachusetts only, bundled) ----
let zips: Record<string, [number, number]> | null = null;
let zipsLoading: Promise<void> | null = null;
function loadZips(): Promise<void> {
  if (zips) return Promise.resolve();
  zipsLoading ||= fetch(`${import.meta.env.BASE_URL}geo/ma-zips.json`)
    .then((r) => r.json())
    .then((j) => { zips = j; })
    .catch(() => { zips = {}; });
  return zipsLoading;
}
// ---- Approximate places for items that have no coordinates ----
// Most researched events/projects only have a street address or town in `location`. For zip-code and
// "in view" filtering, place them at the town named in that text, or else at their organization's headquarters.
let towns: { name: string; re: RegExp; at: [number, number] }[] | null = null;
let townsLoading: Promise<void> | null = null;
export function loadTowns(): Promise<void> {
  if (towns) return Promise.resolve();
  townsLoading ||= fetch(`${import.meta.env.BASE_URL}geo/ma-town-centroids.json`)
    .then((r) => r.json() as Promise<Record<string, [number, number]>>)
    .then((j) => {
      towns = Object.entries(j)
        .sort((a, b) => b[0].length - a[0].length) // "North Adams" before "Adams"
        .map(([name, at]) => ({ name, at, re: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") }));
    })
    .catch(() => { towns = []; });
  return townsLoading;
}
/** Coordinates for an item: its own, else the town named in `location`, else the owner's HQ. */
export function placeFor(item: { lat?: number; lng?: number; online?: boolean; location?: string }, owner?: { lat?: number; lng?: number; remote?: boolean; kind?: string } | null): { lat?: number; lng?: number } {
  if (item.online) return {};
  if (item.lat !== undefined && item.lng !== undefined) return { lat: item.lat, lng: item.lng };
  const loc = item.location || "";
  // The town list is Massachusetts': don't put "Milton, VT" in Milton, MA.
  const otherState = /,\s*(?!MA\b|Mass\b|Massachusetts\b)(?:[A-Z]{2}|Vermont|New Hampshire|New York|Connecticut|Rhode Island|Maine)\b/.test(loc);
  const hit = loc && towns && !otherState ? towns.find((t) => t.re.test(loc)) : undefined;
  if (hit) return { lat: hit.at[0], lng: hit.at[1] };
  if (owner && owner.kind === "org" && !owner.remote && Number.isFinite(owner.lat) && Number.isFinite(owner.lng)) return { lat: owner.lat, lng: owner.lng };
  return {};
}

function miles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export interface FilterOpts {
  /** Which controls to show. */
  online?: boolean;
  freeFood?: boolean;
  publicSwitch?: boolean;
  helpWanted?: boolean;
  inView?: boolean;
}

export interface ItemFilters {
  el: HTMLElement;
  test(f: Facts): boolean;
}

export function createItemFilters(opts: FilterOpts, onChange: () => void): ItemFilters {
  const state = { zip: "", radius: 25, online: true, freeFood: false, publicOnly: true, affiliated: false, helpWanted: true, inView: false };
  let center: [number, number] | null = null;
  void loadTowns().then(onChange); // places need the town list; re-run the filters once it's here

  const el = h("div", { class: "list-toolbar item-filters" });

  // Zip + miles
  const zipIn = h("input", { class: "search zip-in", type: "text", inputmode: "numeric", maxlength: "5", placeholder: "Zip code", "aria-label": "Zip code" }) as HTMLInputElement;
  const mileLbl = h("span", { class: "miles-lbl" }, `within ${state.radius} mi`);
  const mileIn = h("input", { type: "range", min: "1", max: "100", step: "1", value: String(state.radius), class: "slider miles-in", "aria-label": "Miles from zip code" }) as HTMLInputElement;
  const zipNote = h("span", { class: "zip-note" }, "");
  const zipWrap = h("div", { class: "filter-group zip-group" }, zipIn, mileIn, mileLbl, zipNote);
  // Zip-code centres are Massachusetts-only for now.
  if (!currentMap.maGeo) zipWrap.style.display = "none";
  zipIn.addEventListener("input", async () => {
    state.zip = zipIn.value.replace(/\D/g, "").slice(0, 5);
    zipIn.value = state.zip;
    center = null;
    zipNote.textContent = "";
    if (state.zip.length === 5) {
      await loadZips();
      const c = zips?.[state.zip];
      if (c) center = c;
      else zipNote.textContent = "not a Massachusetts zip";
    }
    onChange();
  });
  mileIn.addEventListener("input", () => {
    state.radius = Number(mileIn.value);
    mileLbl.textContent = `within ${state.radius} mi`;
    if (center) onChange();
  });
  el.appendChild(zipWrap);

  const check = (label: string, initial: boolean, set: (v: boolean) => void): HTMLElement => {
    const box = h("input", { type: "checkbox" }) as HTMLInputElement;
    box.checked = initial;
    box.addEventListener("change", () => { set(box.checked); onChange(); });
    return h("label", { class: "check" }, box, " " + label);
  };
  if (opts.online) el.appendChild(check("Include online / remote", state.online, (v) => (state.online = v)));
  if (opts.inView) el.appendChild(check("Only what's in view on the Geographic map", state.inView, (v) => (state.inView = v)));
  if (opts.freeFood) el.appendChild(check("Free food only", state.freeFood, (v) => (state.freeFood = v)));
  if (opts.helpWanted) el.appendChild(check("Help wanted only", state.helpWanted, (v) => (state.helpWanted = v)));
  if (opts.publicSwitch) {
    const seg = h("div", { class: "filters public-switch", role: "group", "aria-label": "Who can come" });
    const a = h("button", { class: "chip active", type: "button" }, "Open to the public");
    const b = h("button", { class: "chip", type: "button" }, "Affiliated-only");
    a.addEventListener("click", () => { state.publicOnly = true; state.affiliated = false; a.classList.add("active"); b.classList.remove("active"); onChange(); });
    b.addEventListener("click", () => { state.publicOnly = false; state.affiliated = true; b.classList.add("active"); a.classList.remove("active"); onChange(); });
    seg.append(a, b);
    el.appendChild(seg);
  }
  window.addEventListener("openthink:mapbounds", () => { if (state.inView) onChange(); });

  return {
    el,
    test(f) {
      const located = f.lat !== undefined && f.lng !== undefined && !f.online;
      if (f.online && !state.online) return false;
      if (opts.freeFood && state.freeFood && !f.free_food) return false;
      if (opts.helpWanted && state.helpWanted && f.help_wanted === false) return false;
      if (opts.publicSwitch) {
        if (state.publicOnly && f.affiliated_only) return false;
        if (state.affiliated && !f.affiliated_only) return false;
      }
      if (state.inView && !(located && inBounds(f.lat!, f.lng!))) return false;
      if (center && !f.online) {
        if (!located || miles(center[0], center[1], f.lat!, f.lng!) > state.radius) return false;
      }
      return true;
    },
  };
}
