// Builds public/money/<map>.json, the "Money & opposition" layer (Oct 28: financial flows and oppositional
// groups on the Oregon map), from the research files in research/money/<map>/:
//   opposition.json                 groups on the public record against climate bills, each stance with a source
//   ogec-lobbying-2021-2025.csv     Oregon Government Ethics Commission lobbying spending by client and year
//                                   (public records lookup: apps.oregon.gov/OGEC/EFS/Records; contact names left out)
//   orestar-contributions.csv       optional: an ORESTAR transaction export (contributor, filer, amount, date) —
//                                   ORESTAR blocks automated access, so export it in a browser and drop it here
// Usage: node scripts/build-money.mjs or
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { parseCsvText } from "./csv.mjs";

const map = process.argv[2] || "or";
const dir = `research/money/${map}`;
const src = JSON.parse(readFileSync(`${dir}/opposition.json`, "utf8"));
const lob = parseCsvText(readFileSync(`${dir}/ogec-lobbying-2021-2025.csv`, "utf8"));
const OGEC = "https://apps.oregon.gov/OGEC/EFS/Records";
const HUB = { id: `${map}_hub_legislature`, name: "Oregon Legislature", abbrev: "Legislature" };

/** Yearly lobbying totals for a list of OGEC client names (a client listed under several contacts counts once). */
function lobbying(names) {
  const years = {};
  for (const r of lob) if (names.includes(r.client)) years[r.year] = (years[r.year] || 0) + Number(r.total || 0);
  for (const y of Object.keys(years)) years[y] = Math.round(years[y]);
  const total = Object.values(years).reduce((a, b) => a + b, 0);
  return total ? { years, total } : null;
}

const flows = [];
const opposition = src.organizations.map(({ ogec, town, ...o }) => {
  const l = lobbying(ogec || []);
  if (l) flows.push({ from: o.id, to: HUB.id, kind: "lobbying", amount: l.total, years: l.years, what: "Registered lobbying spending, 2021–2025", source: OGEC });
  return { ...o, geographic_focus: town || "Statewide", lobbying: l };
});
for (const [id, names] of Object.entries(src.climate_lobbying)) {
  if (id.startsWith("_")) continue;
  const l = lobbying(names);
  if (l) flows.push({ from: id, to: HUB.id, kind: "lobbying", amount: l.total, years: l.years, what: "Registered lobbying spending, 2021–2025", source: OGEC });
}
for (const p of src.political) flows.push({ kind: "political", ...p });

// An ORESTAR export, when one is added: contributions from a group on either list to any committee.
const ores = `${dir}/orestar-contributions.csv`;
if (existsSync(ores)) {
  console.log("ORESTAR export found; add its rows here once its column names are known:", ores);
}

const out = { generated_at: new Date().toISOString().slice(0, 10), map, hub: HUB, opposition, flows };
mkdirSync("public/money", { recursive: true });
writeFileSync(`public/money/${map}.json`, JSON.stringify(out, null, 1) + "\n");
const sum = (k) => flows.filter((f) => f.kind === k).length;
console.log(`public/money/${map}.json: ${opposition.length} opposing groups, ${sum("lobbying")} lobbying flows, ${sum("political")} political flows`);
for (const f of flows.filter((f) => f.kind === "lobbying").sort((a, b) => b.amount - a.amount)) console.log(`  ${f.from.padEnd(30)} $${f.amount.toLocaleString("en-US")}`);
