// Geography bundled per state in public/geo/<prefix>-*.json(geojson): town and county outlines, town centres,
// zip-code centres and voting districts. A map lists the states it has in `MapDef.geo`.
//   ma: MassGIS (scripts/fetch-districts.sh) + the original MA map's towns and zips.
//   or: US Census Bureau cartographic boundary files 2024 + 2024 Gazetteer (scripts/fetch-or-geo.sh).

export interface DistrictDef {
  /** File stem after the prefix: geo/<prefix>-<id>.geojson */
  id: string;
  label: string;
  kind: string;
  color: string;
  weight: number;
  dash?: string;
  minZoom?: number;
  link: string;
  linkText: string;
}

export interface StateGeo {
  prefix: string;
  code: string;
  name: string;
  districts: DistrictDef[];
  /** Where the district lines come from (shown under the checkboxes). */
  credit: string;
}

const FIND_US_REP = "https://www.house.gov/representatives/find-your-representative";
const MA_FIND = "https://malegislature.gov/Search/FindMyLegislator";
const OR_SENATE = "https://www.oregonlegislature.gov/senate/Pages/SenatorsAll.aspx";
const OR_HOUSE = "https://www.oregonlegislature.gov/house/Pages/RepresentativesAll.aspx";

export const STATE_GEO: Record<string, StateGeo> = {
  ma: {
    prefix: "ma", code: "MA", name: "Massachusetts",
    districts: [
      { id: "congress", label: "US Congress (9)", kind: "US Congressional district", color: "#f59e0b", weight: 2.5, link: FIND_US_REP, linkText: "Find your US Representative" },
      { id: "senate", label: "State Senate (40)", kind: "State Senate district", color: "#a78bfa", weight: 2, link: MA_FIND, linkText: "Find your State Senator" },
      { id: "house", label: "State House (160)", kind: "State House district", color: "#34d399", weight: 1.5, dash: "6 4", link: MA_FIND, linkText: "Find your State Representative" },
      { id: "wards", label: "City wards (285)", kind: "City ward", color: "#f472b6", weight: 1.2, dash: "2 4", link: "https://www.sec.state.ma.us/WhereDoIVoteMA/", linkText: "Where do I vote?" },
      { id: "precincts", label: "Voting precincts (2,256)", kind: "Voting precinct", color: "#94a3b8", weight: 0.8, dash: "1 3", minZoom: 12, link: "https://www.sec.state.ma.us/WhereDoIVoteMA/", linkText: "Where do I vote?" },
    ],
    credit: "MassGIS (State House and Senate 2021, US Congress 2022–, wards and precincts 2022)",
  },
  or: {
    prefix: "or", code: "OR", name: "Oregon",
    districts: [
      { id: "congress", label: "US Congress (6)", kind: "US Congressional district", color: "#f59e0b", weight: 2.5, link: FIND_US_REP, linkText: "Find your US Representative" },
      { id: "senate", label: "State Senate (30)", kind: "Oregon State Senate district", color: "#a78bfa", weight: 2, link: OR_SENATE, linkText: "Oregon senators by district" },
      { id: "house", label: "State House (60)", kind: "Oregon State House district", color: "#34d399", weight: 1.5, dash: "6 4", link: OR_HOUSE, linkText: "Oregon representatives by district" },
    ],
    credit: "US Census Bureau 2024 boundary files (Oregon legislature districts, 119th Congress)",
  },
};

/** State codes and names, to tell "Salem, OR" from Salem, MA when a location names its state. */
export const STATE_NAMES: Record<string, string> = {
  Massachusetts: "MA", Mass: "MA", Oregon: "OR", Vermont: "VT", "New Hampshire": "NH", "New York": "NY", Connecticut: "CT",
  "Rhode Island": "RI", Maine: "ME", Washington: "WA", California: "CA", Idaho: "ID",
};

const US_CODES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
/** The state a location names ("…, OR 97401", "…, Oregon"), or null when it doesn't say. */
export function stateNamedIn(loc: string): string | null {
  // "Eugene, OR 97401" / "Bend, OR" — but not "…, NE Sandy Blvd" (a street direction): the code must end the text or precede a zip.
  for (const m of loc.matchAll(/,\s*([A-Z]{2})(?=\s*(?:\d{5}|,|$|\s*\(|\s+United States))/g)) if (US_CODES.has(m[1])) return m[1];
  for (const [name, c] of Object.entries(STATE_NAMES)) if (new RegExp(`,\\s*${name}\\b`).test(loc)) return c;
  return null;
}
