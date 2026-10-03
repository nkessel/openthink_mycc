// Tag every record with child topics from the draft topic list, without re-reading anything with AI:
// each extracted phrase (research/topics/extracted.json) is looked up in research/topics/draft-taxonomy.json,
// which holds exactly the phrase → child mapping cluster.mjs made. Bills are matched with the same patterns
// as cluster.mjs (BILLS below; keep the two in step). Records whose phrases map to no topic stay untagged.
// Writes public/topics.json for the Topics page.
// Usage: node scripts/topic-tags.mjs  (from the repo root; re-run after cluster.mjs or the data change)
import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const taxonomy = read("research/topics/draft-taxonomy.json");
const extracted = read("research/topics/extracted.json");
const records = read("research/topics/records.json");
const recById = new Map(records.map((r) => [r.id, r]));

// phrase → child topic id (the draft list's own assignment)
const childOf = new Map();
for (const p of taxonomy.parents) for (const c of p.children) for (const ph of c.phrases) childOf.set(ph, c.id);

// Same bill patterns as research/topics/cluster.mjs.
const BILLS = [
  ["ma_superfund", "ma", /superfund|make polluters|polluter pays/],
  ["vt_superfund", "vt", /superfund/],
  ["ma_senate_energy", "ma", /senate energy bill/],
  ["clean_energy_equity", "ma", /clean energy equity/],
  ["embodied_carbon", "ma", /embodied carbon/],
  ["h3501", "ma", /h\.?3501|offshore wind/],
  ["h3726", "ma", /h\.?3726|transportation-climate/],
  ["s2294", "ma", /s\.?2294|building decarbonization/],
  ["forest_bills", "ma", /h\.?953|forest/],
  ["chapter503", "ma", /chapter 503/],
  ["ldc_fund", "ma", /least developed/],
  ["fair_share", "ma", /fair share/],
  ["q6", "ma", /question 6/],
  ["q3", "ma", /question 3/],
  ["clean_slate", "ma", /clean slate/],
  ["educator_pay", "ma", /educator pay/],
  ["gwsa", "ma", /global warming solutions/],
  ["vt_gwsa", "vt", /global warming solutions/],
  ["clean_water_act", "", /clean water act/],
  ["boston_diesel", "ma", /diesel/],
  ["berdo", "ma", /berdo|building emissions reduction/],
  ["vt_ej_law", "vt", /environmental justice law/],
];
function billId(b, map) {
  const s = `${b.number || ""} ${b.name}`.toLowerCase();
  for (const [id, m, re] of BILLS) if ((!m || m === map) && re.test(s)) return id;
  return null;
}

// Item links and group names come from the map data, so the page can link to them.
const items = new Map();
const groups = new Map();
for (const [map, path] of Object.entries({ ma: "public/data.json", vt: "public/maps/vt.json" })) {
  const d = read(path);
  for (const g of [...d.coalitions, ...d.organizations]) {
    groups.set(`${map}:${g.id}`, g.name);
    for (const kind of ["events", "projects", "actions"]) for (const it of g[kind] || []) items.set(`${map}:${it.id}`, it);
  }
}

const ITEM = new Set(["event", "project", "action"]);
const out = [];
let untagged = 0;
for (const e of extracted) {
  const r = recById.get(e.id);
  if (!r) continue;
  const topics = [...new Set(e.topics.map((t) => childOf.get(t.phrase)).filter(Boolean))];
  const bills = [...new Set(e.bills.map((b) => billId(b, e.map)).filter(Boolean))];
  if (!topics.length && !bills.length) untagged++;
  const it = items.get(e.id);
  const rec = {
    id: e.id,
    map: e.map,
    kind: e.kind,
    name: r.name,
    host: r.host,
    host_name: r.host_name,
    topics,
    bills,
    strategies: e.strategies,
    recurring: !!e.recurring,
    climate_relevance: e.climate_relevance,
  };
  if (r.date) rec.date = r.date.slice(0, 10);
  if (r.status) rec.status = r.status;
  if (it?.link) rec.link = it.link;
  out.push(rec);
}

const result = {
  generated_at: new Date().toISOString().slice(0, 10),
  status: taxonomy.status,
  parents: taxonomy.parents.map((p) => ({ id: p.id, label: p.label, children: p.children.map((c) => ({ id: c.id, label: c.label })) })),
  bills: taxonomy.bills.map((b) => ({ id: b.id, name: b.name, map: b.map })),
  records: out,
};
writeFileSync("public/topics.json", JSON.stringify(result) + "\n");
console.log(`${out.length} records, ${out.length - untagged} tagged, ${untagged} untagged → public/topics.json`);
