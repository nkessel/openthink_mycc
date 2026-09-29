// Replace the placeholder events / projects / actions in public/data.json with real, sourced ones
// (gathered 2026-09-29 from the team's inbox newsletters, the MYCC check-in email, the team's notes,
// and public web pages). Every entry names its source below so it can be re-checked.
//
//   node scripts/apply-current-events.mjs            # rewrites public/data.json
//   node scripts/apply-current-events.mjs --csv DIR  # also writes Projects.csv / Events.csv (sheet tab format)
//
// Coalition-owned entries live on the coalition; org-owned ones live on the org (projects/events arrays).
// Only public info: no personal contacts. `lat`/`lng` on in-person events are approximate where noted.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA = `${ROOT}public/data.json`;
const data = JSON.parse(readFileSync(DATA, "utf8"));

// ---------- coalition-owned ----------
const coalitionItems = {
  mpf: {
    projects: [
      {
        id: "mpf_p_dashboard", name: "Utility Influence Dashboard", status: "active",
        description: "Public dashboard quantifying campaign donations from utilities and their senior employees, to show utility influence on Massachusetts climate policy. Debuted Sept 29, 2026.",
        skills_needed: ["data analysis", "policy research", "communications"],
        topic_tags: ["climate_policy", "transparency"],
        link: "https://www.amherstindy.org/2026/09/28/mass-power-forward-to-debut-dashboard-with-press-conference-on-statehouse-steps/",
        location: "Massachusetts State House, Boston", lat: 42.3588, lng: -71.0638, // source: Amherst Indy 2026-09-28
      },
    ],
    events: [
      {
        id: "mpf_e_dashboard_launch", name: "Utility Influence Dashboard launch (press conference)",
        date: "2026-09-29T12:00:00", location: "Massachusetts State House steps, Boston",
        description: "Mass Power Forward debuts its dashboard on utility campaign donations. Speakers: Vick Mohanka (Sierra Club MA) and Scotia Hille (Act On Mass). Live-streamed.",
        topic_tags: ["climate_policy", "transparency"], lat: 42.3588, lng: -71.0638,
        link: "https://www.amherstindy.org/2026/09/28/mass-power-forward-to-debut-dashboard-with-press-conference-on-statehouse-steps/",
      },
    ],
  },
  mycc: {
    projects: [
      {
        id: "mycc_p_map", name: "MA Climate Coalition Map", status: "active",
        description: "This map: an interactive network of Massachusetts climate organizations, events and projects, kept up to date by each organization's point person through simple forms.",
        skills_needed: ["web development", "data visualization", "outreach"], online: true,
        topic_tags: ["community_organizing"], // source: team notes 2026-09-25
      },
      {
        id: "mycc_p_rep_refresh", name: "2026–27 member representative (vote caster) refresh", status: "active",
        description: "Each member organization names its vote-casting representative for the 2026–27 year, and prospective members identify themselves. Organizations facing setbacks are asked to say so.",
        skills_needed: ["coalition organizing"], online: true, topic_tags: ["youth", "community_organizing"], // source: MYCC check-in email 2026-09-16
      },
      {
        id: "mycc_p_cccc_collab", name: "MYCC × Cross Campus Climate Coalition collaboration matching", status: "active",
        description: "MYCC and CCCC are pairing member organizations to collaborate and build stronger bonds. Interested organizations sign up through a form.",
        skills_needed: ["coalition organizing"], online: true, topic_tags: ["youth", "community_organizing"], // source: MYCC check-in email 2026-09-16
      },
      {
        id: "mycc_p_advocacy_day", name: "Annual Advocacy Day preparation", status: "planning",
        description: "Member organizations are encouraged to meet their local legislators and build relationships before next year's Advocacy Day.",
        skills_needed: ["public speaking", "policy research"], topic_tags: ["climate_policy", "youth"], // source: MYCC check-in email 2026-09-16
      },
    ],
    events: [
      {
        id: "mycc_e_call_1004", name: "MYCC full-coalition call", date: "2026-10-04T20:00:00", end: "2026-10-04T21:00:00",
        location: "Zoom", online: true, topic_tags: ["youth", "community_organizing"],
        description: "Full-coalition call, every other Sunday 8–9 pm. Open to member organizations, returning members and prospective members. Agenda and Zoom link come from MYCC.",
      },
    ],
    actions: [],
  },
};

// ---------- org-owned ----------
const orgItems = {
  climate_action_now_western_ma: {
    projects: [
      {
        id: "can_p_create", name: "CREATE farmer mutual aid", status: "active",
        description: "Cultivating Relationships: Education | Action | Tending Earth. Volunteers join local farmers for work shifts through the season; sign-up form required.",
        skills_needed: ["farm labor"], topic_tags: ["agriculture", "community_organizing"], location: "Western Massachusetts",
        link: "https://climateactionnowma.org", // source: CAN newsletter 2026-09-29
      },
      {
        id: "can_p_miyawaki", name: "Miyawaki mini-forest group", status: "active",
        description: "Climate Action Now's working group on Miyawaki-method mini-forests and local biodiversity.",
        skills_needed: ["ecology", "gardening"], topic_tags: ["biodiversity", "reforestation"], location: "Western Massachusetts",
        link: "https://climateactionnowma.org", // source: CAN newsletter 2026-09-29
      },
      {
        id: "can_p_no_clearcut", name: "No Clearcut for Profit (Eversource tree clearing)", status: "active",
        description: "Campaign led by Western Mass Towns for a Responsible Grid, promoted by Climate Action Now: a petition asking the Governor to limit Eversource's tree clearing across 11 towns, ahead of Eversource's Final Environmental Impact Statement (around December).",
        skills_needed: ["advocacy", "community organizing"], topic_tags: ["forests", "energy", "climate_policy"], location: "Northfield to Ludlow, Western Massachusetts",
        link: "http://noclearcutforprofit.org", // source: CAN newsletter 2026-09-29
      },
    ],
    events: [
      {
        id: "can_e_fall_gathering", name: "Fall Gathering: Nurturing biodiversity in a time of ecological chaos",
        date: "2026-09-29T17:30:00", end: "2026-09-29T19:30:00",
        location: "Arcadia Wildlife Sanctuary, Easthampton",
        description: "Potluck and connection at 5:30 pm; interactive program 6–7:30 pm with Owen Wormser and Matt Verson, hosted by the Miyawaki Forest Group. RSVP appreciated.",
        topic_tags: ["biodiversity", "community_organizing"], lat: 42.2668, lng: -72.669, // approx: Easthampton town centre
        link: "https://climateactionnowma.org",
      },
    ],
  },
  sierra_club: {
    projects: [
      {
        id: "sc_p_watersheds", name: "Protect the Quabbin, Ware and Wachusett watershed forests", status: "active",
        description: "Sierra Club MA Forest Protection Team campaign to make these watershed forests, which supply fresh water to nearly half of Massachusetts residents, permanent reserves with minimal human intervention. Petition open; film screenings raise funds.",
        skills_needed: ["advocacy", "fundraising"], topic_tags: ["forests", "water"],
        link: "https://www.sierraclub.org/massachusetts/protect-quabbin-wachusett-and-ware-watersheds", // source: CAN newsletter 2026-09-29
      },
    ],
    events: [
      {
        id: "sc_e_film_cambridge", name: "Forest film screening: Old Growth Forests, Nature's Biotic Pump",
        date: "2026-10-08T19:00:00", location: "Patagonia Cambridge, 39 Brattle St, Cambridge",
        description: "Doors at 7 pm with pizza (vegan options included); film, then a half-hour panel and Q&A. Raises money for the watershed forest campaign. RSVP required.",
        topic_tags: ["forests", "water"], lat: 42.37376, lng: -71.121039,
        link: "https://www.sierraclub.org/massachusetts/protect-quabbin-wachusett-and-ware-watersheds",
      },
      {
        id: "sc_e_film_virtual", name: "Forest film screening (virtual): Old Growth Forests, Nature's Biotic Pump",
        date: "2026-10-24T10:00:00", location: "Online", online: true,
        description: "Film followed by a panel with Susan Masino and Bill Stubblefield. Registration required.",
        topic_tags: ["forests", "water"], link: "http://bit.ly/OGForests",
      },
    ],
  },
  jewish_climate_action_network: {
    projects: [],
    events: [
      {
        id: "jcan_e_chutzpah_calls", name: "Chutzpah 2026: Phone Calls for Our Democracy",
        date: "2026-10-08T18:00:00", location: "Online", online: true,
        description: "Phone-banking evening organized by Dayenu, in partnership with JCAN-MA, the Jewish Alliance for Law and Social Action and others.",
        topic_tags: ["democracy", "climate_policy"],
        link: "https://jewishclimate.org/event/chutzpah-2026-phone-calls-for-our-democracy/",
      },
      {
        id: "jcan_e_frameworks", name: "Jewish Frameworks for Our Challenging Times",
        date: "2026-10-12T19:00:00", location: "Online", online: true,
        description: "Jewish frameworks for meeting interlocking psychological, social, economic and climate challenges.",
        topic_tags: ["community_organizing"], link: "https://jewishclimate.org/event/jewish-frameworks-for-our-challenging-times/",
      },
      {
        id: "jcan_e_plastic", name: "Plastic Pollution: Health, Climate, and Solutions",
        date: "2026-10-20T19:00:00", location: "Online", online: true,
        description: "Why plastics are a systems problem (and a fossil-fuel product), and the scale of solution needed.",
        topic_tags: ["plastics", "health"], link: "https://jewishclimate.org/event/plastic-pollution-health-climate-and-solutions/",
      },
      {
        id: "jcan_e_eco_poets", name: "Two Eco-Poets: A Conversation About Climate",
        date: "2026-11-30T19:00:00", location: "Online", online: true,
        description: "Poets Andy Oram and Deborah Leipziger read and discuss, facilitated by Rabbi Katy Allen.",
        topic_tags: ["arts", "community_organizing"], link: "https://jewishclimate.org/event/7410/",
      },
    ],
  },
};

// ---------- apply ----------
const byId = (list, id) => {
  const x = list.find((i) => i.id === id);
  if (!x) throw new Error(`Unknown id: ${id}`);
  return x;
};
for (const c of data.coalitions) { c.projects = []; c.events = []; c.actions = []; }
for (const o of data.organizations) { delete o.projects; delete o.events; }
for (const [id, items] of Object.entries(coalitionItems)) {
  const c = byId(data.coalitions, id);
  c.projects = items.projects || []; c.events = items.events || []; c.actions = items.actions || [];
}
for (const [id, items] of Object.entries(orgItems)) {
  const o = byId(data.organizations, id);
  if (items.projects.length) o.projects = items.projects;
  if (items.events.length) o.events = items.events;
}
// Researched public activity for the rest of the orgs (events, projects, volunteer opportunities / action
// alerts). Each entry carries the source `link` it came from. Volunteer roles and action alerts are stored as
// projects ("Volunteer: ...", "Take action: ...") because the sheet only has coalition-level Actions.
// Skips anything the hand-written entries above already cover (same link or same name).
const researched = JSON.parse(readFileSync(`${ROOT}scripts/researched-activity.json`, "utf8"));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
for (const [id, items] of Object.entries(researched)) {
  const o = byId(data.organizations, id);
  for (const kind of ["projects", "events"]) {
    const have = o[kind] || [];
    for (const it of items[kind] || []) {
      const dup = have.some((h) => norm(h.name) === norm(it.name) || (h.link && h.link === it.link && kind === "projects"));
      if (!dup) have.push(it);
    }
    if (have.length) o[kind] = have;
  }
}
data.generated_at = new Date().toISOString();
writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");

const n = (f) => data.coalitions.reduce((s, c) => s + f(c).length, 0) + data.organizations.reduce((s, o) => s + f(o).length, 0);
console.log(`Projects: ${n((x) => x.projects || [])}, events: ${n((x) => x.events || [])}, actions: ${n((x) => x.actions || [])}`);

// ---------- optional: sheet-tab CSVs (same columns as apps-script COLS) ----------
const csvDir = process.argv.includes("--csv") ? process.argv[process.argv.indexOf("--csv") + 1] : null;
if (csvDir) {
  mkdirSync(csvDir, { recursive: true });
  const esc = (v) => { v = v ?? ""; v = String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const L = (xs) => (xs || []).join(", ");
  const bool = (x) => (x === undefined ? "" : x ? "TRUE" : "FALSE");
  const P = ["id", "coalition_id", "host_org_id", "name", "description", "status", "skills_needed", "topic_tags", "link", "public_contact", "location", "online", "lat", "lng", "last_activity", "hidden"];
  const E = ["id", "coalition_id", "host_org_id", "name", "description", "date", "location", "online", "lat", "lng", "topic_tags", "link", "public_contact", "last_activity", "hidden", "end"];
  const rowsP = [P], rowsE = [E];
  const addP = (p, cid, oid) => rowsP.push(P.map((k) => ({ coalition_id: cid, host_org_id: oid, skills_needed: L(p.skills_needed), topic_tags: L(p.topic_tags), online: bool(p.online) }[k] ?? p[k])));
  const addE = (e, cid, oid) => rowsE.push(E.map((k) => ({ coalition_id: cid, host_org_id: oid, topic_tags: L(e.topic_tags), online: bool(e.online) }[k] ?? e[k])));
  for (const c of data.coalitions) { c.projects.forEach((p) => addP(p, c.id, "")); c.events.forEach((e) => addE(e, c.id, "")); }
  for (const o of data.organizations) { (o.projects || []).forEach((p) => addP(p, "", o.id)); (o.events || []).forEach((e) => addE(e, "", o.id)); }
  writeFileSync(`${csvDir}/Projects.csv`, rowsP.map((r) => r.map(esc).join(",")).join("\n") + "\n");
  writeFileSync(`${csvDir}/Events.csv`, rowsE.map((r) => r.map(esc).join(",")).join("\n") + "\n");
  console.log(`Wrote ${csvDir}/Projects.csv and Events.csv`);
}
