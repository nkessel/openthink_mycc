// Tag every record on the Topics page with Turibius's Wikipedia-based topics, grouped under his 13 seed topics.
// Reads research/topics/wiki/topics-merged.csv (scripts/merge-wiki-topics.mjs), the topic phrases already pulled
// from each record (research/topics/extracted.json) and public/topics.json (the group-based list, for the
// records' strategies, bills, links and dates). Writes public/topics-wiki.json in the same shape as topics.json,
// so the Topics page can switch between the two, plus research/topics/wiki/coverage.md (what is lost).
// Usage: node scripts/wiki-topics.mjs [--min-lift 8]  (Turibius suggested 10 for the form list; 10 tags only ~22% of items)   (from the repo root)
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsvText } from "./csv.mjs";

const args = process.argv.slice(2);
const flag = args.indexOf("--min-lift");
const minLift = flag >= 0 ? Number(args[flag + 1]) : 8;

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const wiki = parseCsvText(readFileSync("research/topics/wiki/topics-merged.csv", "utf8"));
const extracted = read("research/topics/extracted.json");
const groupBased = read("public/topics.json");

// ---- the topic list ----
const seeds = wiki.filter((t) => t.hop_distance === "0");
const seedOf = new Map(seeds.map((s) => [s.qid, s]));
const topics = wiki.filter((t) => t.hop_distance === "0" || Number(t.lift_lcb_max) >= minLift);
const byQid = new Map(topics.map((t) => [t.qid, t]));

const norm = (s) => {
  const w = s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  if (w.length) w[w.length - 1] = singular(w[w.length - 1]);
  return w.join(" ");
};
function singular(x) {
  if (x.length < 5 || /(ss|us|is|ics)$/.test(x)) return x;
  if (x.endsWith("ies")) return x.slice(0, -3) + "y";
  if (/(ches|shes|xes|sses)$/.test(x)) return x.slice(0, -2);
  return x.endsWith("s") ? x.slice(0, -1) : x;
}
// name/alias → topic. A name beats an alias; a seed or a closer, better-scored topic wins a tie.
const rank = (t) => (t.hop_distance === "0" ? 1e6 : 0) - Number(t.hop_distance) * 1000 + Number(t.lift_lcb_max || 0);
const exact = new Map();
const names = new Map();
function put(map, key, t) {
  if (!key) return;
  const cur = map.get(key);
  if (!cur || rank(t) > rank(cur)) map.set(key, t);
}
for (const t of topics) put(names, norm(t.topic), t);
// Single-word names for matching inside longer phrases: plain titles only ("Biomass (ecology)" is not "biomass").
const plainNames = new Map();
for (const t of topics) if (!/[()]/.test(t.topic) && !/\s/.test(t.topic.trim())) put(plainNames, norm(t.topic), t);
for (const t of topics) for (const a of t.aliases ? t.aliases.split(" | ") : []) put(exact, norm(a), t);
for (const [k, t] of names) exact.set(k, t);

// Single words too vague to tag on their own when they are only part of a longer phrase.
const VAGUE = new Set(["community", "climate", "energy", "policy", "action", "justice", "environment", "health", "water", "power", "change", "education", "service", "food", "public", "green", "local", "youth", "school", "network", "planning", "development", "support", "program", "project", "campaign", "event", "meeting", "group", "work", "people", "state", "city", "town", "law", "bill", "rights", "land", "nature", "art", "culture", "research", "science", "transport", "transportation", "infrastructure", "housing", "waste", "economy", "democracy", "safety", "equity", "plant", "regulation", "government", "hazard", "certification", "awareness", "efficiency", "incentive", "scrap", "turbine"]);
// Partial matches that read wrong ("ev road trip planning" is not a Journey planner).
const NOT_PART = new Set(["Journey planner", "Decision-making"]);

function match(phrase) {
  const n = norm(phrase);
  if (exact.has(n)) return { t: exact.get(n), how: "exact" };
  // Longest run of words inside the phrase that names a topic ("invasive species removal" → Invasive species).
  const w = n.split(" ");
  for (let len = w.length - 1; len >= 1; len--) {
    for (let i = 0; i + len <= w.length; i++) {
      const sub = w.slice(i, i + len);
      sub[sub.length - 1] = singular(sub[sub.length - 1]);
      const k = sub.join(" ");
      if (len === 1 && (VAGUE.has(k) || k.length < 5 || !plainNames.has(k))) continue;
      const t = len === 1 ? plainNames.get(k) : exact.get(k);
      if (t && !NOT_PART.has(t.topic)) return { t, how: "part" };
    }
  }
  return null;
}

// ---- tag the records ----
const recById = new Map(groupBased.records.map((r) => [r.id, r]));
const used = new Map(); // qid → number of records
const phraseMiss = new Map();
const how = { exact: 0, part: 0 };
const out = [];
for (const e of extracted) {
  const r = recById.get(e.id);
  if (!r) continue;
  const qids = new Set();
  for (const { phrase } of e.topics) {
    const m = match(phrase);
    if (m) { qids.add(m.t.qid); how[m.how]++; if (process.env.DEBUG) console.error(`${m.how}\t${phrase}\t→ ${m.t.topic}`); }
    else phraseMiss.set(phrase, (phraseMiss.get(phrase) || 0) + 1);
  }
  for (const q of qids) used.set(q, (used.get(q) || 0) + 1);
  out.push({ ...r, topics: [...qids] });
}

// Main topics = the seeds, in the order Turibius lists them; sub-topics = topics at least one record uses.
const parents = seeds.map((s) => ({
  id: "wiki_" + s.qid,
  label: s.topic,
  qid: s.qid,
  children: [],
}));
const parentBySeed = new Map(parents.map((p) => [p.qid, p]));
for (const [qid, n] of [...used].sort((a, b) => b[1] - a[1])) {
  const t = byQid.get(qid);
  // A topic reached from several seeds sits under the first one listed.
  const p = parentBySeed.get(t.seeds.split(",")[0]);
  if (!p) continue;
  p.children.push({ id: qid, label: t.hop_distance === "0" ? `${t.topic} (general)` : t.topic, qid, hop: Number(t.hop_distance) });
}
// Seeds' own "general" child first, then by use.
for (const p of parents) p.children.sort((a, b) => (b.hop === 0) - (a.hop === 0) || (used.get(b.id) || 0) - (used.get(a.id) || 0));

const result = {
  generated_at: new Date().toISOString().slice(0, 10),
  status: `Wikipedia-based topics (Turibius Rozario, v9, Oct 7 2026; lift ≥ ${minLift})`,
  source: "wikipedia",
  parents: parents.filter((p) => p.children.length).map(({ qid, ...p }) => ({ ...p, children: p.children.map(({ hop, ...c }) => c) })),
  bills: groupBased.bills,
  records: out,
};
writeFileSync("public/topics-wiki.json", JSON.stringify(result) + "\n");

// ---- catalog for tags typed or ticked on the forms ----
// The sheet's forms save topics as slugs of their names (apps-script slug_). The Topics page reads this to place a
// live item's tag that no research record uses yet: slug → [qid, name, seed qid].
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const catalog = {};
for (const t of [...topics].sort((a, b) => rank(b) - rank(a))) {
  const k = slug(t.topic);
  if (k && !catalog[k]) catalog[k] = [t.qid, t.topic, t.hop_distance === "0" ? t.qid : t.seeds.split(",")[0]];
}
writeFileSync("public/topics-wiki-catalog.json", JSON.stringify(catalog) + "\n");

// ---- coverage report: what the group-based list holds that this one loses ----
const tagged = out.filter((r) => r.topics.length).length;
const groupTagged = groupBased.records.filter((r) => r.topics.length).length;
const childLabel = new Map(groupBased.parents.flatMap((p) => p.children.map((c) => [c.id, `${p.label} › ${c.label}`])));
const lostBySub = new Map();
for (const r of out) {
  const g = recById.get(r.id);
  if (r.topics.length) continue;
  for (const c of g.topics) lostBySub.set(c, (lostBySub.get(c) || 0) + 1);
}
const subTotal = new Map();
for (const r of groupBased.records) for (const c of r.topics) subTotal.set(c, (subTotal.get(c) || 0) + 1);
const lostRows = [...subTotal].map(([c, n]) => [c, n, lostBySub.get(c) || 0]).sort((a, b) => b[2] / b[1] - a[2] / a[1] || b[2] - a[2]);
const pct = (a, b) => `${Math.round((100 * a) / b)}%`;
const md = [
  `# Wikipedia-based topics: coverage and what is lost`,
  ``,
  `Generated ${result.generated_at} by scripts/wiki-topics.mjs (lift ≥ ${minLift}: ${topics.length} topics incl. the 13 seeds).`,
  ``,
  `- Items with a topic: **${tagged} of ${out.length} (${pct(tagged, out.length)})** — group-based list: ${groupTagged} (${pct(groupTagged, out.length)}).`,
  `- Topic phrases matched: ${how.exact} exactly, ${how.part} by a topic name inside a longer phrase; ${[...phraseMiss.values()].reduce((a, b) => a + b, 0)} not matched.`,
  `- Sub-topics in use: ${used.size}, under ${result.parents.length} seed topics.`,
  ``,
  `## Group-based sub-topics whose items lose all topics`,
  ``,
  `| Group-based sub-topic | Items | Items left with no Wikipedia topic |`,
  `| --- | --- | --- |`,
  ...lostRows.map(([c, n, l]) => `| ${childLabel.get(c) || c} | ${n} | ${l} (${pct(l, n)}) |`),
  ``,
  `## Topic phrases with no Wikipedia match (most used first)`,
  ``,
  ...[...phraseMiss].sort((a, b) => b[1] - a[1]).map(([p, n]) => `- ${p}${n > 1 ? ` (${n})` : ""}`),
  ``,
];
writeFileSync("research/topics/wiki/coverage.md", md.join("\n"));
console.log(`${tagged}/${out.length} items tagged (group-based: ${groupTagged}); ${used.size} sub-topics; phrases exact ${how.exact}, part ${how.part}, missed ${phraseMiss.size} distinct`);
