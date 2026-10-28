// Pulls organizational testimony (Support / Oppose / Neutral) on key Oregon climate & energy bills from OLIS,
// plus each bill's one-line summary and outcome, for the money & opposition layer's bill view.
//   node scripts/fetch-olis-bills.mjs      → research/money/or/olis-bills.json, research/money/or/olis-bill-positions.csv
// The page's columns are Submitter, On Behalf of, Position, City or Organization. Both free-text fields can hold a
// person's name, so a row is kept only when one of them is a known organization (olis-org-aliases.json), and only
// that organization's name is stored. Every other row is only counted, per bill and position: "other_orgs" when
// something was filed on behalf of an organization we can't name, or of a person.
import { readFileSync, writeFileSync } from "node:fs";
const ALIASES = JSON.parse(readFileSync("research/money/or/olis-org-aliases.json", "utf8"));
/** The organization a free-text field names: a map/opposition id (or ids), or a display name; null if none. */
function resolve(s) {
  if (!s) return null;
  const hit = ALIASES.map[s] || ALIASES.other[s] || (ALIASES.prefix || []).find(([re]) => new RegExp(re).test(s))?.[1];
  return hit ? (Array.isArray(hit) ? hit : [hit]) : null;
}
const known = (s) => !!resolve(s);

export const BILLS = [
  ["2021R1", "HB2021", "100% clean electricity by 2040"],
  ["2021R1", "HB2475", "Energy affordability (PUC can consider energy burden)"],
  ["2021R1", "HB2842", "Healthy Homes program"],
  ["2021R1", "HB2062", "Appliance efficiency standards"],
  ["2022R1", "SB1536", "Heat pumps and cooling for renters"],
  ["2023R1", "HB3409", "2023 climate resilience package"],
  ["2023R1", "HB3630", "State energy strategy and energy help for communities"],
  ["2023R1", "SB530", "Natural climate solutions"],
  ["2024R1", "HB4080", "Offshore wind: community engagement and labor standards"],
  ["2025R1", "SB1187", "Climate Superfund (polluters pay for climate damage)"],
  ["2025R1", "HB3546", "POWER Act: large energy users pay their share"],
  ["2025R1", "HB3336", "Electric transmission policy"],
  ["2025R1", "SB688", "Performance-based regulation of electric utilities"],
  ["2026R1", "SB1541", "Climate Resilience Superfund (polluters pay)"],
  ["2026R1", "HB4031", "Faster permits for wind and solar before federal tax credits end"],
  ["2026R1", "HB4076", "Easier land-use approval for energy projects near existing grid"],
  ["2026R1", "SB1582", "Community energy and virtual power plants"],
  ["2026R1", "SB1588", "Healthier, more efficient homes"],
  ["2026R1", "HB4100", "Fuel terminals must show they can pay for spill cleanup"],
];
const BASE = "https://olis.oregonlegislature.gov";
const UA = "Mozilla/5.0 (compatible; research script; public records)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.text(); };
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const csv = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);

const bills = [];
const rows = [];
const unmatched = {};
for (const [session, measure, short] of BILLS) {
  const ov = await get(`${BASE}/liz/${session}/Measures/Overview/${measure}`);
  const catchline = (/"CatchLine":"(.*?)","/.exec(ov)?.[1] || "").replace(/\\"/g, '"');
  const chapter = /"ChapterNumber":"([^"]*)"/.exec(ov)?.[1] || null;
  const vetoed = /"Vetoed":"?Y/.test(ov);
  const where = /"CurrentLocation":"(.*?)"/.exec(ov)?.[1] || "";
  await sleep(600);
  const page = await get(`${BASE}/liz/${session}/Measures/Testimony/${measure}`);
  const id = `${session.slice(0, 4)} ${measure.replace(/^([A-Z]+)/, "$1 ")}`;
  let n = 0;
  const tally = {};
  const otherOrgs = { Support: 0, Oppose: 0, Neutral: 0 };
  for (const tr of page.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const td = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(text);
    if (td.length < 7) continue;
    const [, , behalf, position, cityOrOrg, date, committee] = td;
    n++;
    const pos = /^(Support|Oppose|Neutral)/i.exec(position || "")?.[1] || "Other";
    tally[pos] = (tally[pos] || 0) + 1;
    const org = known(behalf) ? behalf : known(cityOrOrg) ? cityOrOrg : "";
    if (!org) {
      if (behalf && /^(Support|Oppose|Neutral)$/.test(pos)) otherOrgs[pos] = (otherOrgs[pos] || 0) + 1;
      if (!behalf && cityOrOrg) unmatched[cityOrOrg] = (unmatched[cityOrOrg] || 0) + 1;
      if (behalf && process.env.UNMATCHED_OUT) unmatched[`[behalf] ${behalf}`] = (unmatched[`[behalf] ${behalf}`] || 0) + 1;
      continue; // counted above; names never stored
    }
    const href = /href="([^"]*PublicTestimonyDocument[^"]*)"/.exec(tr)?.[1];
    // Only the resolved organization is written (ids for groups on the map, else the display name), never the raw text.
    rows.push({ bill: id, date, committee, organization: resolve(org).join(";"), position: position || "", document: href ? BASE + href : "" });
  }
  bills.push({
    id, session, measure, short, catchline,
    outcome: chapter ? (vetoed ? "Vetoed" : "Passed") : `Did not pass (${where.toLowerCase()})`,
    chapter, url: `${BASE}/liz/${session}/Measures/Overview/${measure}`, testimony_url: `${BASE}/liz/${session}/Measures/Testimony/${measure}`,
    testimony_total: n, testimony_by_position: tally, other_orgs: otherOrgs,
  });
  console.log(id, chapter ? "passed" : "did not pass", n, "testimonies,", rows.filter((r) => r.bill === id).length, "from organizations");
  await sleep(600);
}
writeFileSync("research/money/or/olis-bills.json", JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), bills }, null, 1) + "\n");
writeFileSync("research/money/or/olis-bill-positions.csv",
  "bill,date,committee,organization,position,document\n" + rows.map((r) => [r.bill, r.date, r.committee, r.organization, r.position, r.document].map(csv).join(",")).join("\n") + "\n");
// UNMATCHED_OUT=file: also list "City or Organization" values that matched nothing (cities, or organizations to add
// to olis-org-aliases.json). Only those values and their counts are written, never names.
if (process.env.UNMATCHED_OUT) writeFileSync(process.env.UNMATCHED_OUT, JSON.stringify(Object.entries(unmatched).sort((a, b) => b[1] - a[1]), null, 0));
