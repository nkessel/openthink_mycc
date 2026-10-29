// Builds public/money/<map>.json, the "Money & opposition" layer (Oct 28: financial flows and oppositional
// groups on the Oregon map), from the research files in research/money/<map>/:
//   opposition.json                 groups on the public record against climate bills, each stance with a source
//   ogec-lobbying.csv               Oregon Government Ethics Commission lobbying spending by client and quarter
//                                   (scripts/fetch-ogec-lobbying.mjs <year>)
//                                   (public records lookup: apps.oregon.gov/OGEC/EFS/Records; contact names left out)
//   olis-bills.json, olis-bill-positions.csv   organizational testimony on key climate & energy bills
//                                   (scripts/fetch-olis-bills.mjs), matched to groups by olis-org-aliases.json
//   orestar-contributions.csv       optional: an ORESTAR transaction export (contributor, filer, amount, date) —
//                                   ORESTAR blocks automated access, so export it in a browser and drop it here
// Usage: node scripts/build-money.mjs or
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { parseCsvText } from "./csv.mjs";

const map = process.argv[2] || "or";
const dir = `research/money/${map}`;
const src = JSON.parse(readFileSync(`${dir}/opposition.json`, "utf8"));
const lob = parseCsvText(readFileSync(`${dir}/ogec-lobbying.csv`, "utf8"));
const OGEC = "https://apps.oregon.gov/OGEC/EFS/Records";
// Quarters reported in obvious error (ogec-corrections.json) are left out of every total.
const corrections = existsSync(`${dir}/ogec-corrections.json`) ? JSON.parse(readFileSync(`${dir}/ogec-corrections.json`, "utf8")) : [];
for (const c of corrections) {
  const r = lob.find((r) => r.client === c.client && r.year === c.year);
  if (!r) continue;
  const k = `q${c.quarter}`;
  r.total = String(Number(r.total) - Number(r[k] || 0));
  r[k] = "0";
}
// The period covered: first year to the latest quarter anyone has reported spending in.
const years = [...new Set(lob.map((r) => r.year))].sort();
const lastYear = years.at(-1);
const lastQ = [4, 3, 2, 1].find((q) => lob.some((r) => r.year === lastYear && Number(r[`q${q}`]) > 0)) || 4;
const PERIOD = `${years[0]}–${lastYear}`;
const THROUGH = lastQ === 4 ? lastYear : `${lastYear} Q${lastQ}`;
const WHAT = `Registered lobbying spending, ${PERIOD}${lastQ === 4 ? "" : ` (through ${THROUGH})`}`;
const HUB = { id: `${map}_hub_legislature`, name: "Oregon Legislature", abbrev: "Legislature" };

/** Yearly (and quarterly) lobbying totals for a list of OGEC client names (a client listed under several contacts counts once). */
function lobbying(names) {
  const years = {};
  const quarters = {};
  for (const r of lob) {
    if (!names.includes(r.client)) continue;
    years[r.year] = (years[r.year] || 0) + Number(r.total || 0);
    [r.q1, r.q2, r.q3, r.q4].forEach((v, i) => { const k = `${r.year}Q${i + 1}`; quarters[k] = (quarters[k] || 0) + Number(v || 0); });
  }
  for (const y of Object.keys(years)) years[y] = Math.round(years[y]);
  for (const q of Object.keys(quarters)) quarters[q] = Math.round(quarters[q]);
  const total = Object.values(years).reduce((a, b) => a + b, 0);
  return total ? { years, quarters, total } : null;
}

const flows = [];
const opposition = src.organizations.map(({ ogec, town, ...o }) => {
  const l = lobbying(ogec || []);
  if (l) flows.push({ from: o.id, to: HUB.id, kind: "lobbying", amount: l.total, years: l.years, quarters: l.quarters, what: WHAT, source: OGEC });
  return { ...o, geographic_focus: town || "Statewide", lobbying: l };
});
for (const [id, names] of Object.entries(src.climate_lobbying)) {
  if (id.startsWith("_")) continue;
  const l = lobbying(names);
  if (l) flows.push({ from: id, to: HUB.id, kind: "lobbying", amount: l.total, years: l.years, quarters: l.quarters, what: WHAT, source: OGEC });
}

// Bills: who testified for and against, as organizations (individuals are never kept), and what the named groups on
// each side spent lobbying that year (on all issues: Oregon's lobbying reports don't say which bills the money was for).
const bills = [];
if (existsSync(`${dir}/olis-bills.json`)) {
  const meta = JSON.parse(readFileSync(`${dir}/olis-bills.json`, "utf8")).bills;
  const pos = parseCsvText(readFileSync(`${dir}/olis-bill-positions.csv`, "utf8"));
  const al = JSON.parse(readFileSync(`${dir}/olis-org-aliases.json`, "utf8"));
  const side = (p) => (/^support/i.test(p) ? "Support" : /^oppose/i.test(p) ? "Oppose" : /^neutral/i.test(p) ? "Neutral" : null);
  for (const b of meta) {
    const year = b.session.slice(0, 4);
    const named = new Map(); // key → entry (one per group per side; several documents kept)
    const other = { Support: 0, Oppose: 0, Neutral: 0 };
    for (const r of pos.filter((r) => r.bill === b.id)) {
      const s = side(r.position);
      if (!s) continue; // invited testimony (position field holds a legislator's name) or "Unknown"
      const keys = r.organization.split(";").filter(Boolean); // resolved by fetch-olis-bills.mjs: ids or display names
      if (!keys.length) { other[s]++; continue; }
      for (const k of keys) {
        const key = `${s}|${k}`;
        const e = named.get(key) || { side: s, id: k.startsWith(`${map}_`) ? k : undefined, name: k.startsWith(`${map}_`) ? undefined : k, date: r.date, docs: [] };
        if (r.document && !e.docs.includes(r.document)) e.docs.push(r.document);
        named.set(key, e);
      }
    }
    const entries = [...named.values()].map((e) => {
      const clients = al.ogec[e.id || e.name] || [];
      const l = lobbying(clients);
      return { ...e, lobbying_year: l?.years[year] || 0, _clients: clients };
    });
    // Each OGEC client counts once per side (PGE can appear alone and in a joint letter with Pacific Power).
    const sideMoney = (s) => {
      const clients = [...new Set(entries.filter((e) => e.side === s).flatMap((e) => e._clients))];
      return lobbying(clients)?.years[year] || 0;
    };
    bills.push({
      id: b.id, year, short: b.short, catchline: b.catchline, outcome: b.outcome, url: b.url, testimony_url: b.testimony_url,
      positions: entries.sort((x, y) => y.lobbying_year - x.lobbying_year).map(({ _clients, ...e }) => e),
      other: b.other_orgs || other,
      all: b.testimony_by_position,
      money: { Support: sideMoney("Support"), Oppose: sideMoney("Oppose"), Neutral: sideMoney("Neutral") },
    });
  }
}
for (const p of src.political) flows.push({ kind: "political", ...p });

// An ORESTAR export, when one is added: contributions from a group on either list to any committee.
const ores = `${dir}/orestar-contributions.csv`;
if (existsSync(ores)) {
  console.log("ORESTAR export found; add its rows here once its column names are known:", ores);
}

const out = { generated_at: new Date().toISOString().slice(0, 10), map, period: PERIOD, through: THROUGH, hub: HUB, opposition, flows, bills };
mkdirSync("public/money", { recursive: true });
writeFileSync(`public/money/${map}.json`, JSON.stringify(out, null, 1) + "\n");
const sum = (k) => flows.filter((f) => f.kind === k).length;
console.log(`public/money/${map}.json: ${opposition.length} opposing groups, ${sum("lobbying")} lobbying flows, ${sum("political")} political flows, ${bills.length} bills`);
for (const b of bills) {
  const n = (s) => b.positions.filter((p) => p.side === s).length + b.other[s];
  console.log(`  ${b.id.padEnd(12)} ${b.outcome.slice(0, 22).padEnd(22)} for ${String(n("Support")).padStart(3)} ($${b.money.Support.toLocaleString("en-US")})  against ${String(n("Oppose")).padStart(3)} ($${b.money.Oppose.toLocaleString("en-US")})`);
}
for (const f of flows.filter((f) => f.kind === "lobbying").sort((a, b) => b.amount - a.amount)) console.log(`  ${f.from.padEnd(30)} $${f.amount.toLocaleString("en-US")}`);
