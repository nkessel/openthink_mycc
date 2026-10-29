// Import the org list, org data, and org logos from the MA Climate Coalition Map
// (github.com/aissatabarry/ma-climate-coalition-map) into public/data.json.
//
//   node scripts/import-orgs.mjs                 # fetch index.html from GitHub
//   node scripts/import-orgs.mjs path/to/index.html
//
// What it does
//  - Organizations: replaced entirely by the source map's list (150 orgs), with
//    abbreviations, locations, coalition ties + weights, profile scores, and logos.
//  - Logos: the base64 PNGs embedded in the source are written to public/logos/<id>.png.
//  - Coalitions: the source's 8 coalitions. Existing coalitions that match keep their
//    description, tags, color, projects, events and actions. Coalitions that are not in
//    the source are dropped, along with their projects, events, and actions.
//  - Projects/events owned by an org that is no longer listed are dropped, and so are
//    coalition projects/events whose host org (host_org_id) is no longer listed.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/aissatabarry/ma-climate-coalition-map/main/index.html";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA = `${ROOT}public/data.json`;
const LOGOS = `${ROOT}public/logos`;

// Source coalition code → id used in this app (existing ids kept so projects/events carry over)
const COALITION_IDS = {
  MPF: "mpf", MYCC: "mycc", EJLT: "ejlt", GJC: "gjc", CRS: "crs", HERO: "hero",
  CCCC: "cccc", SCJC: "scjc",
};

const src = process.argv[2];
const html = src ? readFileSync(src, "utf8") : await (await fetch(SOURCE_URL)).text();

// ---- pull the embedded JSON (window.__MAP_DATA__ = {...}) and coalition colors
const start = html.indexOf("window.__MAP_DATA__");
if (start === -1) throw new Error("Couldn't find window.__MAP_DATA__ in the source HTML");
const raw = parseJsonAt(html, html.indexOf("{", start));
const meta = {};
for (const m of html.matchAll(/(\w+):\s*\{full:"([^"]+)",\s*color:"(#[0-9A-Fa-f]{6})"\}/g)) {
  meta[m[1]] = { full: m[2], color: m[3] };
}

const old = JSON.parse(readFileSync(DATA, "utf8"));
const oldCoalitions = new Map(old.coalitions.map((c) => [c.id, c]));
const sourceDate = process.env.SOURCE_DATE || new Date().toISOString();

// ---- organizations
const slug = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

const orgNodes = raw.nodes.filter((n) => n.type === "org");
const idFor = new Map();
const taken = new Set();
for (const n of orgNodes) {
  let id = slug(n.id.replace(/^O::/, "")), k = 2;
  while (taken.has(id)) id = `${slug(n.id.replace(/^O::/, ""))}_${k++}`;
  taken.add(id);
  idFor.set(n.id, id);
}

// Logos fetched from org websites (scripts/fetch-logos.mjs) live here too, so don't wipe the folder.
mkdirSync(LOGOS, { recursive: true });

const num = (v) => (v === null || v === undefined || v === "" ? undefined : Number(v));
const bool = (v) => (v === null || v === undefined ? undefined : Boolean(v));
const clean = (o) => {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === "") delete o[k];
  return o;
};

function orgType(n) {
  if (n.schoolClub) return "school_club";
  if (/universit|college|campus|\bstudents?\b/i.test(n.fullLabel)) return "university";
  if (n.youthServing) return "youth_org";
  return "unknown"; // groups can set this through the organization form
}

let logoCount = 0;
const organizations = orgNodes.map((n) => {
  const id = idFor.get(n.id);
  const ties = raw.edges.filter((e) => e.source === n.id);
  const coalition_ids = [];
  const coalition_weights = {};
  for (const e of ties) {
    const cid = COALITION_IDS[e.target.replace(/^C::/, "")];
    if (!cid || coalition_ids.includes(cid)) continue;
    coalition_ids.push(cid);
    if (e.weight != null) coalition_weights[cid] = e.weight;
  }
  let logo;
  if (n.logo64) {
    const b64 = n.logo64.replace(/^data:image\/png;base64,/, "");
    writeFileSync(`${LOGOS}/${id}.png`, Buffer.from(b64, "base64"));
    logo = `logos/${id}.png`;
    logoCount++;
  }
  const profile = clean({
    youth_serving: bool(n.youthServing),
    school_club: bool(n.schoolClub),
    hub: bool(n.hub),
    inactive: bool(n.inactive),
    paid_staff: bool(n.paidStaff),
    ej_focus: num(n.ejMembership),
    grassroots: num(n.grassroots),
    policy_expertise: num(n.policyExpertise),
    in_building: num(n.inBuilding),
    membership_size: n.membershipSize || undefined,
    c3_tier: n.c3 || undefined,
    c4_tier: n.c4 || undefined,
    geo_precision: n.geoPrecision || undefined,
  });
  return clean({
    id,
    name: n.fullLabel,
    type: orgType(n),
    geographic_focus: "",
    description: "",
    coalition_ids,
    lat: n.lat,
    lng: n.lng,
    last_activity: sourceDate,
    abbrev: n.abbr || undefined,
    website: n.website || undefined,
    logo,
    profile: Object.keys(profile).length ? profile : undefined,
    coalition_weights: Object.keys(coalition_weights).length ? coalition_weights : undefined,
  });
});
// clean() drops empty strings; the app expects these two keys to exist
for (const o of organizations) {
  o.geographic_focus ??= "";
  o.description ??= "";
}
// Keep org-owned projects/events for orgs that are still listed (matched by id)
const oldOrgs = new Map(old.organizations.map((o) => [o.id, o]));
for (const o of organizations) {
  const prev = oldOrgs.get(o.id);
  if (!o.logo && prev?.logo && (/^https?:/.test(prev.logo) || existsSync(`${ROOT}public/${prev.logo}`))) o.logo = prev.logo;
  if (!o.website && prev?.website) o.website = prev.website;
  if (prev?.projects?.length) o.projects = prev.projects;
  if (prev?.events?.length) o.events = prev.events;
}
const orgIds = new Set(organizations.map((o) => o.id));

// ---- coalitions
const dropped = { coalitions: [], projects: 0, events: 0, actions: 0 };
for (const c of old.coalitions) {
  if (!Object.values(COALITION_IDS).includes(c.id)) {
    dropped.coalitions.push(c.id);
    dropped.projects += c.projects.length;
    dropped.events += c.events.length;
    dropped.actions += c.actions.length;
  }
}
const hostOk = (x) => !x.host_org_id || orgIds.has(x.host_org_id);

const coalitions = raw.nodes.filter((n) => n.type === "coalition").map((n) => {
  const code = n.id.replace(/^C::/, "");
  const id = COALITION_IDS[code] || slug(code);
  const prev = oldCoalitions.get(id);
  const member_ids = organizations.filter((o) => o.coalition_ids.includes(id)).map((o) => o.id);
  const keep = (list = []) => {
    const kept = list.filter(hostOk);
    return kept;
  };
  const projects = keep(prev?.projects);
  const events = keep(prev?.events);
  dropped.projects += (prev?.projects.length || 0) - projects.length;
  dropped.events += (prev?.events.length || 0) - events.length;
  return {
    id,
    name: prev?.name || meta[code]?.full || n.fullLabel,
    abbrev: code,
    description: prev?.description || "",
    focus_tags: prev?.focus_tags || [],
    geographic_scope: prev?.geographic_scope || "statewide",
    color: prev?.color || meta[code]?.color || "#6FA88C",
    lat: n.lat,
    lng: n.lng,
    member_ids,
    member_count: member_ids.length,
    projects,
    events,
    actions: prev?.actions || [],
    last_activity: prev?.last_activity || sourceDate,
  };
});

const edges = [];
for (const c of coalitions) for (const m of c.member_ids) edges.push({ source: c.id, target: m });

// Keep org-to-org links (from the forms) between orgs that are still listed
const org_links = (old.org_links || []).filter((l) => orgIds.has(l.source) && orgIds.has(l.target));

const out = { generated_at: new Date().toISOString(), coalitions, organizations, edges, org_links };
writeFileSync(DATA, JSON.stringify(out, null, 2) + "\n");

console.log(
  `Imported ${organizations.length} orgs (${logoCount} logos), ${coalitions.length} coalitions, ` +
    `${edges.length} memberships.\n` +
    `Dropped coalitions not in the source: ${dropped.coalitions.join(", ") || "none"} ` +
    `(${dropped.projects} projects, ${dropped.events} events, ${dropped.actions} actions).`,
);

function parseJsonAt(s, i) {
  // Walk to the matching close brace, respecting strings, then JSON.parse the slice.
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(s.slice(i, j + 1));
  }
  throw new Error("Unterminated JSON in source HTML");
}
